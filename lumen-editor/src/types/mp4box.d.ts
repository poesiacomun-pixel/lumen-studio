// Tipos mínimos para la parte de mp4box que usamos. El paquete no publica
// tipos completos; declaramos solo lo necesario para demuxear y extraer la
// descripción del códec (avcC/hvcC/…).

declare module "mp4box" {
  export interface MP4VideoData {
    width: number;
    height: number;
  }

  export interface MP4MediaTrack {
    id: number;
    codec: string;
    video: MP4VideoData;
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    videoTracks: MP4MediaTrack[];
  }

  export interface MP4Sample {
    is_sync: boolean;
    cts: number;
    dts: number;
    duration: number;
    timescale: number;
    data: Uint8Array;
  }

  export interface MP4File {
    onReady: (info: MP4Info) => void;
    onError: (e: string) => void;
    onSamples: (id: number, user: unknown, samples: MP4Sample[]) => void;
    appendBuffer(data: ArrayBuffer): void;
    start(): void;
    stop(): void;
    flush(): void;
    setExtractionOptions(
      id: number,
      user: unknown,
      options: { nbSamples?: number },
    ): void;
    // El árbol de cajas no está tipado; lo recorremos con cuidado en runtime.
    getTrackById(id: number): unknown;
  }

  export class DataStream {
    static BIG_ENDIAN: number;
    constructor(buffer?: ArrayBuffer, byteOffset?: number, endianness?: number);
    buffer: ArrayBuffer;
  }

  export function createFile(): MP4File;

  const MP4Box: {
    createFile: typeof createFile;
    DataStream: typeof DataStream;
  };
  export default MP4Box;
}
