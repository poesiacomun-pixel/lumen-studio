import { writeToOPFS, readFromOPFS } from "../storage/opfs";

/**
 * Genera y cachea la "waveform" (envolvente de picos) de un asset de audio.
 *
 * Reduce la señal a `buckets` muestras, cada una con el valor absoluto máximo
 * de ese tramo (0..1). Con eso la timeline dibuja barras verticales sin tener
 * que cargar todo el audio. Los picos se guardan en OPFS como JSON para no
 * recomputarlos en cada sesión.
 */

const DEFAULT_BUCKETS = 1200; // resolución de la waveform completa del asset

export interface Peaks {
  buckets: number; // nº de muestras
  data: number[]; // valores 0..1, longitud = buckets
}

const memCache = new Map<string, Peaks>();

function peaksPathFor(opfsPath: string): string {
  return `peaks/${opfsPath.replace(/[^\w.-]+/g, "_")}.json`;
}

/** Computa los picos de un AudioBuffer ya decodificado. */
function computePeaks(channelData: Float32Array, buckets: number): Peaks {
  const data = new Array<number>(buckets).fill(0);
  const block = Math.max(1, Math.floor(channelData.length / buckets));
  for (let b = 0; b < buckets; b++) {
    const start = b * block;
    const end = Math.min(channelData.length, start + block);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(channelData[i]);
      if (v > peak) peak = v;
    }
    data[b] = peak;
  }
  // normaliza para que el pico global sea 1 (waveforms más legibles)
  const max = data.reduce((m, v) => Math.max(m, v), 0) || 1;
  for (let i = 0; i < buckets; i++) data[i] = data[i] / max;
  return { buckets, data };
}

/**
 * Obtiene los picos de un asset: primero de memoria, luego de OPFS, y si no
 * existen los calcula decodificando el audio y los persiste.
 */
export async function getPeaks(
  assetId: string,
  opfsPath: string,
  buckets = DEFAULT_BUCKETS,
): Promise<Peaks | null> {
  const cached = memCache.get(assetId);
  if (cached) return cached;

  const peaksPath = peaksPathFor(opfsPath);
  // intenta leer de OPFS
  try {
    const file = await readFromOPFS(peaksPath);
    const text = await file.text();
    const peaks = JSON.parse(text) as Peaks;
    memCache.set(assetId, peaks);
    return peaks;
  } catch {
    /* no existe aún → calcular */
  }

  try {
    const file = await readFromOPFS(opfsPath);
    const buf = await file.arrayBuffer();
    const ctx = new AudioContext();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(buf);
    } finally {
      await ctx.close();
    }
    // mezcla a mono promediando canales
    const len = audioBuffer.length;
    const mono = new Float32Array(len);
    const chs = audioBuffer.numberOfChannels;
    for (let c = 0; c < chs; c++) {
      const d = audioBuffer.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / chs;
    }
    const peaks = computePeaks(mono, buckets);
    memCache.set(assetId, peaks);
    // persiste en segundo plano (no bloquea)
    void writeToOPFS(peaksPath, new Blob([JSON.stringify(peaks)], { type: "application/json" }));
    return peaks;
  } catch {
    return null;
  }
}

/**
 * Devuelve un fragmento de los picos correspondiente a un rango del asset
 * (en fracción 0..1 de su duración), remuestreado a `outBuckets`. Se usa para
 * dibujar solo la parte recortada (in→out) de un clip.
 */
export function slicePeaks(peaks: Peaks, from01: number, to01: number, outBuckets: number): number[] {
  const a = Math.max(0, Math.floor(from01 * peaks.buckets));
  const b = Math.min(peaks.buckets, Math.ceil(to01 * peaks.buckets));
  const span = Math.max(1, b - a);
  const out = new Array<number>(outBuckets).fill(0);
  for (let i = 0; i < outBuckets; i++) {
    const start = a + Math.floor((i / outBuckets) * span);
    const end = a + Math.floor(((i + 1) / outBuckets) * span);
    let peak = 0;
    for (let j = start; j < Math.max(start + 1, end); j++) {
      const v = peaks.data[j] ?? 0;
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}
