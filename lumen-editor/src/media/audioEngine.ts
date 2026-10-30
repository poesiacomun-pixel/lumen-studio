import { TICKS_PER_SECOND, ticksToSeconds } from "../model/time";
import { evaluate } from "../model/animated";
import { clipDuration } from "../model/types";
import type { Clip, Track, ProjectState } from "../model/types";
import { readFromOPFS } from "../storage/opfs";

/**
 * Motor de audio basado en Web Audio API.
 *
 * Responsabilidades:
 *  - Decodifica y cachea el AudioBuffer de cada asset (una vez por asset).
 *  - Al reproducir, programa un AudioBufferSourceNode por cada clip de audio
 *    activo, con su ganancia (volumen de clip × volumen de pista × fades) y su
 *    recorte/velocidad. Los clips que empiezan más adelante se programan con
 *    `start(when)` en el futuro, así el navegador los dispara con precisión.
 *  - Provee el RELOJ MAESTRO: `currentTick` se deriva de AudioContext.currentTime,
 *    que es mucho más estable que performance.now(). El video se sincroniza a él.
 *
 * El motor no decide *qué* clips existen: recibe el ProjectState y lee de él.
 */

interface ScheduledSource {
  clipId: string;
  trackId: string;
  src: AudioBufferSourceNode;
  clipGain: GainNode; // envolvente del clip (volumen animado + fades + mute clip)
  trackGain: GainNode; // volumen de la pista, ajustable en vivo
}

export class AudioEngine {
  private ctx: AudioContext;
  private master: GainNode;
  private buffers = new Map<string, AudioBuffer>(); // assetId → buffer decodificado
  private decoding = new Map<string, Promise<AudioBuffer | null>>();
  private sources: ScheduledSource[] = [];

  private state: ProjectState | null = null;
  private playing = false;

  // Anclaje del reloj: en t0 (AudioContext.currentTime) el playhead estaba en tick0.
  private anchorCtxTime = 0;
  private anchorTick = 0;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
  }

  /** ¿Hay al menos un clip de audio reproducible? Define si el audio es el reloj. */
  hasAudio(): boolean {
    if (!this.state) return false;
    return Object.values(this.state.clips).some((c) => this.isAudioClip(c));
  }

  private isAudioClip(clip: Clip): boolean {
    const asset = this.state?.assets[clip.assetId];
    if (!asset) return false;
    // suena el audio de los clips de pista de audio, y el de los clips de video
    // que conservan su audio (no separado/mudo).
    const track = this.state?.tracks[clip.trackId];
    if (!track) return false;
    if (track.kind === "audio") return asset.hasAudio !== false;
    return asset.kind === "video" && asset.hasAudio === true;
  }

  setState(state: ProjectState): void {
    this.state = state;
    // si estamos sonando, reprograma desde la posición actual para reflejar cambios
    if (this.playing) {
      const at = this.currentTick;
      this.stopAllSources();
      this.scheduleFrom(at);
    }
  }

  /** Asegura que el AudioContext esté activo (requiere gesto del usuario). */
  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** Decodifica (y cachea) el AudioBuffer de un asset desde OPFS. */
  private async getBuffer(assetId: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(assetId);
    if (cached) return cached;
    const inflight = this.decoding.get(assetId);
    if (inflight) return inflight;

    const asset = this.state?.assets[assetId];
    if (!asset) return null;

    const p = (async () => {
      try {
        const file = await readFromOPFS(asset.opfsPath);
        const raw = await file.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(raw);
        this.buffers.set(assetId, buf);
        return buf;
      } catch {
        return null; // sin audio decodificable
      } finally {
        this.decoding.delete(assetId);
      }
    })();
    this.decoding.set(assetId, p);
    return p;
  }

  /**
   * Pre-decodifica los assets de audio que se usarán, para que al pulsar Play no
   * haya un hueco mientras se decodifica. Conviene llamarlo tras setState.
   */
  async preload(): Promise<void> {
    if (!this.state) return;
    const ids = new Set<string>();
    for (const c of Object.values(this.state.clips)) {
      if (this.isAudioClip(c)) ids.add(c.assetId);
    }
    await Promise.all([...ids].map((id) => this.getBuffer(id)));
  }

  /** ¿Alguna pista en solo? Si la hay, las no-solo se silencian. */
  private soloActive(): boolean {
    if (!this.state) return false;
    return Object.values(this.state.tracks).some(
      (t) => t.kind === "audio" && t.solo,
    );
  }

  /**
   * Ganancia del CLIP en un tick dado (volumen animado + fades + mute de clip),
   * SIN el volumen de pista (ese va en un nodo aparte, ajustable en vivo).
   */
  private clipGainAt(clip: Clip, track: Track, timelineTick: number): number {
    if (clip.muted || track.muted) return 0;
    if (this.soloActive() && track.kind === "audio" && !track.solo) return 0;

    const local = timelineTick - clip.startTick; // ticks desde el inicio del clip
    const dur = clipDuration(clip);
    if (local < 0 || local > dur) return 0;

    let g = evaluate(clip.volume, local);

    // fade in
    if (clip.fadeInTick > 0 && local < clip.fadeInTick) {
      g *= local / clip.fadeInTick;
    }
    // fade out
    if (clip.fadeOutTick > 0 && local > dur - clip.fadeOutTick) {
      g *= Math.max(0, (dur - local) / clip.fadeOutTick);
    }
    return Math.max(0, g);
  }

  /**
   * Programa todos los clips de audio cuya reproducción cae en/after `fromTick`.
   * Cada fuente arranca en el instante de AudioContext que le corresponde.
   */
  private scheduleFrom(fromTick: number): void {
    if (!this.state) return;
    const now = this.ctx.currentTime;
    this.anchorCtxTime = now;
    this.anchorTick = fromTick;

    for (const clip of Object.values(this.state.clips)) {
      if (!this.isAudioClip(clip)) continue;
      const track = this.state.tracks[clip.trackId];
      const buffer = this.buffers.get(clip.assetId);
      if (!track || !buffer) continue;

      const dur = clipDuration(clip);
      const clipEnd = clip.startTick + dur;
      if (clipEnd <= fromTick) continue; // ya pasó

      // ¿dónde empieza a sonar? si el playhead está dentro del clip, desde ahí.
      const playFromTick = Math.max(clip.startTick, fromTick);
      const whenCtx = now + ticksToSeconds(playFromTick - fromTick);

      // offset dentro del asset (segundos), respetando recorte y velocidad
      const offsetTick =
        clip.inTick + (playFromTick - clip.startTick) * clip.speed;
      const offsetSec = ticksToSeconds(offsetTick);
      const remainTimelineTicks = clipEnd - playFromTick;
      const remainSec = ticksToSeconds(remainTimelineTicks);

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = clip.speed;

      const clipGain = this.ctx.createGain();
      this.applyGainAutomation(clipGain, clip, track, playFromTick, whenCtx);

      const trackGain = this.ctx.createGain();
      trackGain.gain.value = track.volume;

      src.connect(clipGain).connect(trackGain).connect(this.master);
      try {
        src.start(whenCtx, offsetSec, remainSec / clip.speed);
      } catch {
        // offset fuera de rango → ignora este clip
        continue;
      }
      this.sources.push({ clipId: clip.id, trackId: track.id, src, clipGain, trackGain });
    }
  }

  /**
   * Escribe la curva de ganancia del clip en el GainNode usando automatización
   * del propio AudioContext (suave y sin coste de CPU por frame). Sampleamos la
   * envolvente de volumen+fades a intervalos cortos.
   */
  private applyGainAutomation(
    gain: GainNode,
    clip: Clip,
    track: Track,
    playFromTick: number,
    whenCtx: number,
  ): void {
    const dur = clipDuration(clip);
    const clipEnd = clip.startTick + dur;
    const STEP = TICKS_PER_SECOND / 20; // muestrea ~20 veces por segundo
    gain.gain.cancelScheduledValues(whenCtx);

    let t = playFromTick;
    let first = true;
    while (t <= clipEnd) {
      const g = this.clipGainAt(clip, track, t);
      const when = whenCtx + ticksToSeconds(t - playFromTick) / clip.speed;
      if (first) {
        gain.gain.setValueAtTime(g, when);
        first = false;
      } else {
        gain.gain.linearRampToValueAtTime(g, when);
      }
      t += STEP;
    }
  }

  play(fromTick: number): void {
    void this.resume();
    this.stopAllSources();
    this.playing = true;
    this.scheduleFrom(fromTick);
  }

  pause(): void {
    if (!this.playing) return;
    // congela el reloj en la posición actual ANTES de marcar como detenido,
    // para que currentTick siga devolviendo dónde se pausó (no el ancla vieja).
    this.anchorTick = this.currentTick;
    this.anchorCtxTime = this.ctx.currentTime;
    this.playing = false;
    this.stopAllSources();
  }

  /** Reposiciona el reloj; si está sonando, reprograma desde ahí. */
  seek(tick: number): void {
    if (this.playing) {
      this.stopAllSources();
      this.scheduleFrom(tick);
    } else {
      this.anchorCtxTime = this.ctx.currentTime;
      this.anchorTick = tick;
    }
  }

  private stopAllSources(): void {
    for (const s of this.sources) {
      try {
        s.src.stop();
      } catch {
        /* ya detenida */
      }
      s.src.disconnect();
      s.clipGain.disconnect();
      s.trackGain.disconnect();
    }
    this.sources = [];
  }

  /**
   * Ajusta el volumen de una pista EN VIVO, sin reprogramar el audio (evita
   * cortes al arrastrar el slider). El valor persistente lo guarda el store; esto
   * solo refleja el cambio en las fuentes que ya están sonando.
   */
  setTrackVolumeLive(trackId: string, volume: number): void {
    const v = Math.max(0, volume);
    for (const s of this.sources) {
      if (s.trackId === trackId) {
        s.trackGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
      }
    }
  }

  /** Posición actual del reloj maestro, en ticks de la timeline. */
  get currentTick(): number {
    if (!this.playing) return this.anchorTick;
    const elapsed = this.ctx.currentTime - this.anchorCtxTime;
    return this.anchorTick + elapsed * TICKS_PER_SECOND;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Volumen general de salida (0..1+). */
  setMasterVolume(v: number): void {
    this.master.gain.value = Math.max(0, v);
  }

  /** Libera el buffer cacheado de un asset (al borrarlo, por ejemplo). */
  evictAsset(assetId: string): void {
    this.buffers.delete(assetId);
  }
}
