import { TICKS_PER_SECOND } from "../model/time";
import type { SubtitleStyle, ProjectState, Clip, TextContent } from "../model/types";
import { clipDuration } from "../model/types";
import { evaluateCompose } from "./compositor";
import { AudioEngine } from "./audioEngine";
import type { ToWorker, FromWorker, SubtitleCueMsg, ComposeMsg, TransitionMsg, VideoLayerMsg, TextLayerMsg } from "./playbackMessages";

export interface TimelineClipInfo {
  id: string;
  assetId: string;
  startTick: number;
  inTick: number;
  outTick: number;
  speed: number;
  zIndex: number; // orden de capa de su pista
  preRollTick: number; // activación anticipada por transición entrante
  text?: TextContent; // si está presente, es una capa de texto (sin video)
}

export interface AssetInfo {
  opfsPath: string;
  codec: string;
  width: number;
  height: number;
  kind?: "video" | "audio" | "image";
}

function clipDur(c: TimelineClipInfo): number {
  return Math.round((c.outTick - c.inTick) / c.speed);
}

/**
 * Lleva el reloj de reproducción y le indica al worker qué clip presentar.
 * Maneja una secuencia: al cruzar de un clip a otro, recarga la fuente activa.
 * Cuando llegue el audio (Fase 4), el reloj maestro pasará a ser el del audio.
 */
export class PlaybackController {
  private worker: Worker;
  private durationTick = 0; // duración total de la timeline
  private currentTick = 0;
  private playing = false;
  private rafId = 0;
  private playStartPerf = 0;
  private playStartTick = 0;
  private inited = false;

  private clips: TimelineClipInfo[] = [];
  private assets: Record<string, AssetInfo> = {};

  // Estado del proyecto (para componer transform/opacidad del clip activo).
  private project: ProjectState | null = null;

  // Motor de audio. Cuando hay audio, ES el reloj maestro: el video se ancla a él.
  private audio = new AudioEngine();
  private useAudioClock = false;

  onTick: (tick: number, duration: number, playing: boolean) => void = () => {};

  constructor() {
    this.worker = new Worker(
      new URL("./playbackWorker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.addEventListener("message", (e: MessageEvent<FromWorker>) => {
      if (e.data.type === "error") console.error("Worker:", e.data.message);
    });
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.inited) return;
    const offscreen = canvas.transferControlToOffscreen();
    await this.call({ type: "init", canvas: offscreen }, [offscreen], "ready");
    this.inited = true;
    // pide al worker que cargue el catálogo de fuentes (para el render del texto)
    this.worker.postMessage({ type: "loadFonts" } satisfies ToWorker);
  }

  /** Fija la resolución del lienzo del proyecto (independiente del tamaño de clip). */
  setCanvasSize(width: number, height: number): void {
    this.worker.postMessage({ type: "canvasSize", width, height } satisfies ToWorker);
  }

  /**
   * Define todas las capas de video del proyecto. El worker mantiene un
   * decodificador por capa y las compone por z-index. Es idempotente: si una
   * capa no cambió de fuente, el worker conserva su decodificador.
   */
  async setTimeline(
    clips: TimelineClipInfo[],
    assets: Record<string, AssetInfo>,
    fps: number,
  ): Promise<void> {
    this.clips = [...clips].sort((a, b) => a.startTick - b.startTick);
    this.assets = assets;
    this.durationTick = this.clips.reduce(
      (m, c) => Math.max(m, c.startTick + clipDur(c)),
      0,
    );
    this.currentTick = Math.min(this.currentTick, this.durationTick);

    const layers: VideoLayerMsg[] = [];
    const textLayers: TextLayerMsg[] = [];
    for (const c of this.clips) {
      if (c.text) {
        textLayers.push({
          clipId: c.id,
          zIndex: c.zIndex,
          startTick: c.startTick,
          endTick: c.startTick + clipDur(c),
          content: c.text,
        });
        continue;
      }
      const a = this.assets[c.assetId];
      if (!a) continue;
      layers.push({
        clipId: c.id,
        opfsPath: a.opfsPath,
        codec: a.codec,
        width: a.width,
        height: a.height,
        zIndex: c.zIndex,
        clipStartTick: c.startTick,
        clipInTick: c.inTick,
        outTick: c.outTick,
        speed: c.speed,
        preRollTick: c.preRollTick,
        isImage: a.kind === "image",
      });
    }
    await this.call({ type: "setLayers", layers, textLayers, fps }, undefined, "layersReady");
    this.present(this.currentTick);
    this.emit();
  }

  /**
   * Entrega el estado del proyecto. Alimenta el motor de audio (reloj maestro)
   * y guarda el estado para componer transform/opacidad del clip de video activo.
   * Reenvía la composición al worker para reflejar ediciones del inspector en vivo.
   */
  async setProject(state: ProjectState): Promise<void> {
    this.project = state;
    // La duración del proyecto debe cubrir TODOS los clips, no solo los visuales
    // que pasan por setTimeline. Si solo hay audio, sin esto durationTick quedaría
    // en 0 y la reproducción no avanzaría. Tomamos el máximo entre lo ya calculado
    // (capas de video) y el final del clip más tardío de cualquier pista.
    const allClipsEnd = Object.values(state.clips).reduce(
      (m, c) => Math.max(m, c.startTick + clipDuration(c)),
      0,
    );
    this.durationTick = Math.max(this.durationTick, allClipsEnd);
    this.audio.setState(state);
    this.useAudioClock = this.audio.hasAudio();
    await this.audio.preload();
    this.present(this.currentTick);
  }

  /** Ajusta el volumen de una pista en vivo (sin reprogramar el audio). */
  setTrackVolumeLive(trackId: string, volume: number): void {
    this.audio.setTrackVolumeLive(trackId, volume);
  }

  /** Evalúa la composición de un clip en un instante de la timeline. */
  private composeFor(clip: Clip, timelineTick: number): ComposeMsg {
    const local = timelineTick - clip.startTick;
    return evaluateCompose(clip.transform, clip.opacity, clip.blendMode, local, clip.effectId);
  }

  /** Fuerza el reenvío de las composiciones (tras editar transform en el inspector). */
  refreshCompose(state?: ProjectState): void {
    if (state) this.project = state;
    this.present(this.currentTick);
  }

  /**
   * Actualiza en vivo el contenido/estilo de las capas de texto (al editar un
   * título en el inspector) sin reconstruir toda la timeline. Reconstruye las
   * `textLayers` desde el estado, las manda al worker y re-presenta, de modo que
   * el cambio se ve de inmediato en el visor.
   */
  refreshText(state?: ProjectState): void {
    if (state) this.project = state;
    if (this.project) {
      // refleja el texto editado en la lista de clips que usa composesAt/present
      for (const c of this.clips) {
        const updated = this.project.clips[c.id];
        if (updated?.text) c.text = updated.text;
      }
    }
    const textLayers: TextLayerMsg[] = this.clips
      .filter((c) => c.text)
      .map((c) => ({
        clipId: c.id,
        zIndex: c.zIndex,
        startTick: c.startTick,
        endTick: c.startTick + clipDur(c),
        content: c.text!,
      }));
    this.worker.postMessage({ type: "setTextLayers", textLayers } satisfies ToWorker);
    this.present(this.currentTick);
  }

  /** Composiciones de todas las capas de video activas en un tick. */
  private composesAt(tick: number): Record<string, ComposeMsg> {
    const out: Record<string, ComposeMsg> = {};
    if (!this.project) return out;
    for (const c of this.clips) {
      const dur = clipDur(c);
      const start = c.startTick - (c.preRollTick || 0);
      if (tick < start || tick >= c.startTick + dur) continue;
      const clip = this.project.clips[c.id];
      if (clip) out[c.id] = this.composeFor(clip, tick);
    }
    return out;
  }

  /**
   * Calcula las transiciones activas en este tick. Para cada transición cuya
   * ventana [boundary - dur, boundary] contiene el tick, marca el clip saliente
   * (from) y el entrante (to) con el progreso 0→1.
   */
  private transitionsAt(tick: number): Record<string, TransitionMsg> {
    const out: Record<string, TransitionMsg> = {};
    if (!this.project) return out;
    for (const tr of Object.values(this.project.transitions)) {
      const from = this.project.clips[tr.fromClipId];
      const to = this.project.clips[tr.toClipId];
      if (!from || !to) continue;
      const boundary = to.startTick; // A termina donde B empieza
      const startWin = boundary - tr.durationTick;
      if (tick < startWin || tick >= boundary) continue;
      const progress = (tick - startWin) / tr.durationTick;
      out[tr.fromClipId] = { type: tr.type, progress, role: "from" };
      out[tr.toClipId] = { type: tr.type, progress, role: "to" };
    }
    return out;
  }

  play(): void {
    if (this.playing || this.durationTick === 0) return;
    // si está (o casi) al final, reinicia desde el principio
    if (this.currentTick >= this.durationTick - 1) {
      this.currentTick = 0;
      this.present(this.currentTick);
    }
    this.playing = true;
    this.playStartPerf = performance.now();
    this.playStartTick = this.currentTick;

    // Si hay audio, arráncalo: será el reloj maestro.
    if (this.useAudioClock) {
      void this.audio.resume().then(() => this.audio.play(this.currentTick));
    }

    const loop = () => {
      if (!this.playing) return;
      if (this.useAudioClock && this.audio.isPlaying) {
        // reloj maestro = audio. Reancla el reloj de respaldo por si el audio se
        // detiene (fin de pista) y hay que continuar con performance.now().
        this.currentTick = this.audio.currentTick;
        this.playStartPerf = performance.now();
        this.playStartTick = this.currentTick;
      } else {
        const elapsed = (performance.now() - this.playStartPerf) / 1000;
        this.currentTick = this.playStartTick + elapsed * TICKS_PER_SECOND;
      }

      if (this.currentTick >= this.durationTick) {
        this.currentTick = this.durationTick;
        this.present(this.currentTick);
        this.pause();
        return;
      }

      // El worker mantiene un decodificador por capa y compone las activas;
      // aquí solo le mandamos el tick y las composiciones de cada capa.
      this.present(this.currentTick);
      this.emit();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.audio.pause();
    // congela el tick mostrado en su valor actual y refréscalo una vez
    this.present(this.currentTick);
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  async seek(tick: number): Promise<void> {
    this.currentTick = Math.max(0, Math.min(tick, this.durationTick));
    if (this.playing) {
      this.playStartPerf = performance.now();
      this.playStartTick = this.currentTick;
    }
    this.audio.seek(this.currentTick);
    this.emit();
    this.present(this.currentTick); // el worker prepara/seekea las capas activas
  }

  setSubtitles(cues: SubtitleCueMsg[], style: SubtitleStyle): void {
    this.worker.postMessage({ type: "subtitles", cues, style } satisfies ToWorker);
  }

  get tick(): number {
    return this.currentTick;
  }
  get duration(): number {
    return this.durationTick;
  }
  get isPlaying(): boolean {
    return this.playing;
  }

  private present(tick: number): void {
    const composes = this.composesAt(tick);
    const transitions = this.transitionsAt(tick);
    this.worker.postMessage({ type: "present", tick, composes, transitions } satisfies ToWorker);
  }

  private emit(): void {
    this.onTick(this.currentTick, this.durationTick, this.playing);
  }

  private call(
    msg: ToWorker,
    transfer: Transferable[] | undefined,
    expect: FromWorker["type"],
  ): Promise<FromWorker> {
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent<FromWorker>) => {
        if (e.data.type === expect) {
          cleanup();
          resolve(e.data);
        } else if (e.data.type === "error") {
          cleanup();
          reject(new Error(e.data.message));
        }
      };
      const cleanup = () => this.worker.removeEventListener("message", onMsg);
      this.worker.addEventListener("message", onMsg);
      this.worker.postMessage(msg, transfer ?? []);
    });
  }
}
