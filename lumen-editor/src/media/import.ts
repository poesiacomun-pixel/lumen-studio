import { writeToOPFS } from "../storage/opfs";
import { probe } from "./mp4";
import { secondsToTicks } from "../model/time";
import type { Asset } from "../model/types";

function sanitize(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

/**
 * Decodifica un archivo con Web Audio para conocer duración, canales y tasa.
 * Devuelve null si el archivo no tiene audio decodificable (p.ej. un video mudo).
 */
async function probeAudio(
  file: File,
): Promise<{ durationSec: number; channels: number; sampleRate: number } | null> {
  try {
    const buf = await file.arrayBuffer();
    const ctx = new AudioContext();
    let ab: AudioBuffer;
    try {
      ab = await ctx.decodeAudioData(buf);
    } finally {
      await ctx.close();
    }
    if (ab.numberOfChannels === 0 || ab.length === 0) return null;
    return {
      durationSec: ab.duration,
      channels: ab.numberOfChannels,
      sampleRate: ab.sampleRate,
    };
  } catch {
    return null;
  }
}

/**
 * Importa un archivo de video: lo persiste en OPFS, lo sondea y construye el
 * Asset del modelo. La decodificación y la reproducción las hace el worker.
 */
export async function importVideoFile(file: File): Promise<Asset> {
  const opfsPath = `media/${crypto.randomUUID()}-${sanitize(file.name)}`;
  await writeToOPFS(opfsPath, file);

  const info = await probe(file);
  // ¿el video trae pista de audio? lo sabemos intentando decodificarla.
  const audio = await probeAudio(file);

  return {
    id: crypto.randomUUID(),
    kind: "video",
    name: file.name,
    opfsPath,
    durationTick: info.durationTick,
    width: info.codedWidth,
    height: info.codedHeight,
    codec: info.codec,
    hasAudio: audio !== null,
    sampleRate: audio?.sampleRate,
    channels: audio?.channels,
  };
}

/**
 * Importa una imagen fija (png, jpg, webp, gif…). La guarda en OPFS y obtiene
 * sus dimensiones con createImageBitmap. Su duración es 0 (al añadirla a la
 * timeline se le da una duración por defecto, como a un título).
 */
export async function importImageFile(file: File): Promise<Asset> {
  const opfsPath = `media/${crypto.randomUUID()}-${sanitize(file.name)}`;
  await writeToOPFS(opfsPath, file);

  let width: number | undefined;
  let height: number | undefined;
  try {
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
    bmp.close();
  } catch {
    /* si no se puede decodificar, se importa sin dimensiones (se usará el lienzo) */
  }

  return {
    id: crypto.randomUUID(),
    kind: "image",
    name: file.name,
    opfsPath,
    durationTick: 0,
    width,
    height,
  };
}

/**
 * Importa un archivo de solo-audio (mp3, m4a, wav, ogg…). Lo guarda en OPFS y
 * construye un Asset de tipo "audio" con su duración real.
 */
export async function importAudioFile(file: File): Promise<Asset> {
  const opfsPath = `media/${crypto.randomUUID()}-${sanitize(file.name)}`;
  await writeToOPFS(opfsPath, file);

  const audio = await probeAudio(file);
  if (!audio) {
    throw new Error("No se pudo leer el audio de este archivo.");
  }

  return {
    id: crypto.randomUUID(),
    kind: "audio",
    name: file.name,
    opfsPath,
    durationTick: secondsToTicks(audio.durationSec),
    sampleRate: audio.sampleRate,
    channels: audio.channels,
    hasAudio: true,
  };
}
