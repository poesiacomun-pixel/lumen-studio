import { readFromOPFS } from "../storage/opfs";
import { evaluate } from "../model/animated";
import { clipDuration } from "../model/types";
import { ticksToSeconds, TICKS_PER_SECOND } from "../model/time";
import type { ProjectState, Clip, Track } from "../model/types";

/**
 * Mezcla offline de TODO el audio del proyecto para la exportación.
 *
 * Recorre cada clip que suena (clips de pista de audio, y clips de video cuyo
 * audio no fue separado/mudo), decodifica su asset una sola vez, y lo suma en un
 * buffer maestro estéreo respetando: posición en la timeline, recorte in→out,
 * velocidad, volumen de clip × volumen de pista, fades y mute/solo.
 *
 * Usa la MISMA semántica de ganancia que el AudioEngine de reproducción, de modo
 * que el archivo exportado suena igual que la edición.
 */

const OUT_RATE = 48000; // tasa de salida del mix (estándar para AAC)
const OUT_CH = 2; // estéreo

function isAudibleClip(state: ProjectState, clip: Clip): boolean {
  const asset = state.assets[clip.assetId];
  const track = state.tracks[clip.trackId];
  if (!asset || !track) return false;
  if (track.kind === "audio") return asset.hasAudio !== false;
  return asset.kind === "video" && asset.hasAudio === true;
}

function soloActive(state: ProjectState): boolean {
  return Object.values(state.tracks).some((t) => t.kind === "audio" && t.solo);
}

/** Ganancia efectiva del clip en un tick de la timeline (volumen+fades+pista). */
function gainAt(state: ProjectState, clip: Clip, track: Track, timelineTick: number): number {
  if (clip.muted || track.muted) return 0;
  if (soloActive(state) && track.kind === "audio" && !track.solo) return 0;

  const local = timelineTick - clip.startTick;
  const dur = clipDuration(clip);
  if (local < 0 || local > dur) return 0;

  let g = evaluate(clip.volume, local) * track.volume;
  if (clip.fadeInTick > 0 && local < clip.fadeInTick) g *= local / clip.fadeInTick;
  if (clip.fadeOutTick > 0 && local > dur - clip.fadeOutTick) {
    g *= Math.max(0, (dur - local) / clip.fadeOutTick);
  }
  return Math.max(0, g);
}

export interface MixResult {
  channels: Float32Array[]; // OUT_CH canales
  sampleRate: number;
}

/**
 * Produce la mezcla estéreo final del proyecto. `durationTick` define la
 * longitud del buffer de salida (normalmente la duración total de la timeline).
 * Devuelve null si no hay nada de audio.
 */
export async function mixProjectAudio(
  state: ProjectState,
  durationTick: number,
): Promise<MixResult | null> {
  const clips = Object.values(state.clips).filter((c) => isAudibleClip(state, c));
  if (clips.length === 0) return null;

  const totalSec = ticksToSeconds(durationTick);
  const outLen = Math.max(1, Math.ceil(totalSec * OUT_RATE));
  const out: Float32Array[] = [new Float32Array(outLen), new Float32Array(outLen)];

  // decodifica cada asset una sola vez (cacheado por assetId)
  const decoded = new Map<string, AudioBuffer>();
  const ctx = new AudioContext();

  async function bufferFor(assetId: string): Promise<AudioBuffer | null> {
    const cached = decoded.get(assetId);
    if (cached) return cached;
    const asset = state.assets[assetId];
    if (!asset) return null;
    try {
      const file = await readFromOPFS(asset.opfsPath);
      const raw = await file.arrayBuffer();
      const buf = await ctx.decodeAudioData(raw);
      decoded.set(assetId, buf);
      return buf;
    } catch {
      return null;
    }
  }

  // procesa en bloques: la ganancia se evalúa una vez por bloque (~10ms),
  // lo que evita llamar evaluate() por cada muestra individual.
  const BLOCK = Math.round(OUT_RATE * 0.01); // ~10ms por bloque

  for (const clip of clips) {
    const track = state.tracks[clip.trackId];
    const buffer = await bufferFor(clip.assetId);
    if (!track || !buffer) continue;

    const dur = clipDuration(clip);
    const srcRate = buffer.sampleRate;
    const srcCh = buffer.numberOfChannels;
    const chanData: Float32Array[] = [];
    for (let ch = 0; ch < srcCh; ch++) chanData.push(buffer.getChannelData(ch));

    const startSample = Math.max(0, Math.floor(ticksToSeconds(clip.startTick) * OUT_RATE));
    const endSample = Math.min(outLen, Math.ceil(ticksToSeconds(clip.startTick + dur) * OUT_RATE));

    for (let blk = startSample; blk < endSample; blk += BLOCK) {
      const blkEnd = Math.min(endSample, blk + BLOCK);
      // ganancia al centro del bloque
      const midSec = ((blk + blkEnd) / 2) / OUT_RATE;
      const g = gainAt(state, clip, track, midSec * TICKS_PER_SECOND);
      if (g === 0) continue;

      for (let i = blk; i < blkEnd; i++) {
        const tSec = i / OUT_RATE;
        const timelineTick = tSec * TICKS_PER_SECOND;
        const localTick = (timelineTick - clip.startTick) * clip.speed;
        const srcSec = ticksToSeconds(clip.inTick + localTick);
        const srcIndex = srcSec * srcRate;
        if (srcIndex < 0 || srcIndex >= buffer.length - 1) continue;

        const i0 = Math.floor(srcIndex);
        const frac = srcIndex - i0;
        for (let ch = 0; ch < OUT_CH; ch++) {
          const srcChIdx = srcCh === 1 ? 0 : Math.min(ch, srcCh - 1);
          const data = chanData[srcChIdx];
          const s = data[i0] + (data[i0 + 1] - data[i0]) * frac;
          out[ch][i] += s * g;
        }
      }
    }
  }

  // protección suave contra recorte (clipping): normaliza si excede 1
  let peak = 0;
  for (const chan of out) {
    for (let i = 0; i < chan.length; i++) {
      const a = Math.abs(chan[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak > 1) {
    const k = 1 / peak;
    for (const chan of out) for (let i = 0; i < chan.length; i++) chan[i] *= k;
  }

  await ctx.close().catch(() => {});
  return { channels: out, sampleRate: OUT_RATE };
}
