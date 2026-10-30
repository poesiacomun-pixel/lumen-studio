import { demux } from "../media/mp4";
import { readFromOPFS } from "../storage/opfs";
import { TICKS_PER_SECOND } from "../model/time";
import type { ExportLayer } from "./exportMessages";

/**
 * Decodificador de UNA capa para la exportación. A diferencia del reproductor
 * (tiempo real, salta frames), aquí el avance es determinista y monótono: el
 * export recorre la timeline frame a frame y pide a cada capa su frame exacto.
 *
 * Estrategia: decodificación bajo demanda hacia adelante con una pequeña ventana
 * de frames en memoria. Como el playhead solo avanza, se descartan los frames ya
 * pasados. Esto acota la memoria aunque la capa dure minutos.
 */

interface ChunkRef {
  chunk: EncodedVideoChunk;
  ts: number; // microsegundos
  isKey: boolean;
}

const WINDOW = 16; // frames decodificados que conservamos como mucho

export class ExportLayerDecoder {
  readonly layer: ExportLayer;
  private chunks: ChunkRef[] = [];
  private decoder: VideoDecoder | null = null;
  private queue: VideoFrame[] = []; // orden ascendente por timestamp
  private cursor = 0; // próximo chunk a alimentar
  private error: unknown = null;

  constructor(layer: ExportLayer) {
    this.layer = layer;
  }

  get durationTimelineTick(): number {
    return Math.round((this.layer.clipOutTick - this.layer.clipInTick) / this.layer.speed);
  }

  coversTick(tick: number): boolean {
    const s = this.layer.clipStartTick - (this.layer.preRollTick || 0);
    return tick >= s && tick < this.layer.clipStartTick + this.durationTimelineTick;
  }

  private sourceTs(tick: number): number {
    const clamped = Math.max(tick, this.layer.clipStartTick);
    const srcTick = this.layer.clipInTick + (clamped - this.layer.clipStartTick) * this.layer.speed;
    return Math.max(0, (srcTick / TICKS_PER_SECOND) * 1_000_000);
  }

  async load(): Promise<void> {
    const file = await readFromOPFS(this.layer.opfsPath);
    const { info, chunks } = await demux(file);
    this.chunks = chunks.map((c) => ({ chunk: c, ts: c.timestamp, isKey: c.type === "key" }));

    this.decoder = new VideoDecoder({
      output: (frame) => this.insert(frame),
      error: (e) => { this.error = e; },
    });
    this.decoder.configure({
      codec: this.layer.codec,
      codedWidth: this.layer.width,
      codedHeight: this.layer.height,
      description: info.description,
    });
  }

  private insert(frame: VideoFrame): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].timestamp > frame.timestamp) i--;
    this.queue.splice(i, 0, frame);
  }

  /**
   * Devuelve el frame de esta capa para el tick dado (o null si la capa no está
   * activa). Decodifica hacia adelante hasta cubrir el timestamp y descarta los
   * frames anteriores para acotar la memoria.
   */
  async frameAt(tick: number): Promise<VideoFrame | null> {
    if (!this.decoder || !this.coversTick(tick)) return null;
    const target = this.sourceTs(tick);

    // alimenta el decodificador hasta tener un frame con ts >= target (o EOF)
    while (
      this.cursor < this.chunks.length &&
      (this.queue.length === 0 || this.queue[this.queue.length - 1].timestamp < target) &&
      this.queue.length < WINDOW
    ) {
      this.decoder.decode(this.chunks[this.cursor].chunk);
      this.cursor++;
      // deja que el decodificador emita; flush parcial cuando la cola crece
      if (this.decoder.decodeQueueSize > 8) {
        await this.decoder.flush().catch((e) => { this.error = e; });
      }
    }
    if (this.cursor >= this.chunks.length && this.queue.length === 0) {
      await this.decoder.flush().catch((e) => { this.error = e; });
    }
    if (this.error) throw this.error;

    // descarta frames ya pasados (timestamp <= target), guardando el último previo
    let best: VideoFrame | null = null;
    while (this.queue.length > 0 && this.queue[0].timestamp <= target) {
      if (best) best.close();
      best = this.queue.shift()!;
    }
    if (!best && this.queue.length > 0) {
      best = this.queue[0]; // aún no llegamos: usa el primero disponible
    }
    // re-inserta el elegido al frente para poder reutilizarlo si el siguiente
    // tick cae en el mismo frame (frames de salida más densos que los de origen)
    if (best) this.queue.unshift(best);
    return best;
  }

  dispose(): void {
    try { this.decoder?.close(); } catch { /* ya cerrada */ }
    for (const f of this.queue) f.close();
    this.queue = [];
    this.decoder = null;
  }
}
