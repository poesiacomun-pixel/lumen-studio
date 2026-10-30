import MP4Box, {
  type DataStream,
  type MP4File,
  type MP4Info,
  type MP4Sample,
} from "mp4box";
import { secondsToTicks, type Ticks } from "../model/time";

export interface ProbeResult {
  trackId: number;
  codec: string; // p.ej. "avc1.640028"
  codedWidth: number;
  codedHeight: number;
  description?: Uint8Array; // payload avcC/hvcC, requerido por VideoDecoder
  durationTick: Ticks;
}

/**
 * Extrae la "description" del códec (la caja avcC/hvcC/…) del árbol de cajas
 * del MP4. VideoDecoder.configure la necesita para H.264/H.265 en MP4.
 */
function extractDescription(mp4: MP4File, trackId: number): Uint8Array | undefined {
  const trak = mp4.getTrackById(trackId) as {
    mdia?: { minf?: { stbl?: { stsd?: { entries?: Array<Record<string, unknown>> } } } };
  };
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? [];
  for (const entry of entries) {
    const box = (entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C) as
      | { write(s: DataStream): void }
      | undefined;
    if (box) {
      const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // quita el header de 8 bytes
    }
  }
  return undefined;
}

function infoFrom(mp4: MP4File, movie: MP4Info): ProbeResult | null {
  const track = movie.videoTracks?.[0];
  if (!track) return null;
  return {
    trackId: track.id,
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    description: extractDescription(mp4, track.id),
    durationTick: secondsToTicks(movie.duration / movie.timescale),
  };
}

function appendFile(mp4: MP4File, file: File, reject: (e: Error) => void): void {
  file
    .arrayBuffer()
    .then((raw) => {
      const buffer = raw as ArrayBuffer & { fileStart?: number };
      buffer.fileStart = 0;
      mp4.appendBuffer(buffer);
      mp4.flush();
    })
    .catch((e) => reject(e as Error));
}

/** Sondeo ligero: solo lee la cabecera (moov) y devuelve la info de la pista. */
export function probe(file: File): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const mp4 = MP4Box.createFile();
    let settled = false;
    mp4.onError = (e) => {
      if (!settled) reject(new Error(`mp4box: ${e}`));
    };
    mp4.onReady = (movie) => {
      const info = infoFrom(mp4, movie);
      if (!info) {
        reject(new Error("El archivo no contiene pista de video."));
        return;
      }
      settled = true;
      resolve(info);
    };
    appendFile(mp4, file, reject);
  });
}

/** Demux completo: devuelve la info y TODOS los chunks codificados del video. */
export function demux(file: File): Promise<{ info: ProbeResult; chunks: EncodedVideoChunk[] }> {
  return new Promise((resolve, reject) => {
    const mp4 = MP4Box.createFile();
    const chunks: EncodedVideoChunk[] = [];
    let info: ProbeResult | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      if (!info) {
        reject(new Error("El archivo no contiene pista de video."));
        return;
      }
      settled = true;
      resolve({ info, chunks });
    };

    mp4.onError = (e) => {
      if (!settled) reject(new Error(`mp4box: ${e}`));
    };

    mp4.onReady = (movie) => {
      info = infoFrom(mp4, movie);
      if (!info) {
        reject(new Error("El archivo no contiene pista de video."));
        return;
      }
      mp4.setExtractionOptions(info.trackId, null, {});
      mp4.start();
    };

    mp4.onSamples = (_id: number, _user: unknown, samples: MP4Sample[]) => {
      for (const s of samples) {
        chunks.push(
          new EncodedVideoChunk({
            type: s.is_sync ? "key" : "delta",
            timestamp: (s.cts / s.timescale) * 1_000_000,
            duration: (s.duration / s.timescale) * 1_000_000,
            data: s.data,
          }),
        );
      }
    };

    file
      .arrayBuffer()
      .then((raw) => {
        const buffer = raw as ArrayBuffer & { fileStart?: number };
        buffer.fileStart = 0;
        mp4.appendBuffer(buffer);
        mp4.flush();
        // tras flush, mp4box ya entregó todas las muestras de forma síncrona
        finish();
      })
      .catch((e) => reject(e as Error));
  });
}
