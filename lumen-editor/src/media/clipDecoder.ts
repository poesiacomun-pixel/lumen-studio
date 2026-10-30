import { demux } from "./mp4";
import { readFromOPFS } from "../storage/opfs";
import { TICKS_PER_SECOND } from "../model/time";

/*
 * Decodificador de UN clip de video (patrón pipeline WebCodecs).
 *
 * Reglas del VideoDecoder que dictan este diseño:
 *  - Trabaja por lotes y asincrónico: se alimentan chunks y los frames salen
 *    "cuando salen" (a veces hacen falta varios chunks para el primer frame).
 *  - Tras configure() o flush(), el PRIMER chunk debe ser un keyframe.
 *  - Los VideoFrame ocupan memoria GPU: hay que close() los que no se usan.
 *
 * Estrategia: mantener un buffer de frames por delante del playhead. En cada
 * prepare(tick) se rellena el buffer (decodifica más si hace falta) y se descartan
 * los frames ya consumidos. Si se salta lejos o hacia atrás, se reposiciona en el
 * keyframe anterior. Si el decoder falla, se recrea (ensureDecoder).
 */

const DECODE_QUEUE_LIMIT = 8; // chunks "en vuelo" máx dentro del decoder
const TARGET_AHEAD = 8; // frames que intentamos tener por delante del playhead
const MAX_BUFFER = 20; // tope de frames en memoria (holgura sobre TARGET_AHEAD)
const RESYNC_GAP_US = 500_000; // si el buffer va >0.5s por detrás del playhead, re-seek
// si al regresar el mejor frame disponible queda >0.25s por detrás del target (y
// hay un keyframe más cercano), re-seek para no mostrar un frame viejo congelado.
const STALE_GAP_US = 250_000;

// Pon en true para volcar el estado del decoder por consola (diagnóstico).
const DEBUG = false;
function dlog(...args: unknown[]): void {
  if (DEBUG) console.log("[ClipDecoder]", ...args);
}

interface ChunkRef {
  chunk: EncodedVideoChunk;
  ts: number; // microsegundos (presentación)
  isKey: boolean;
}

export interface ClipDecoderInit {
  opfsPath: string;
  codec: string;
  width: number;
  height: number;
  clipStartTick: number;
  clipInTick: number;
  outTick: number;
  speed: number;
  preRollTick: number;
}

export class ClipDecoder {
  readonly init: ClipDecoderInit;
  readonly width: number;
  readonly height: number;

  private chunks: ChunkRef[] = [];
  private config: VideoDecoderConfig | null = null;
  private decoder: VideoDecoder | null = null;
  private buffer: VideoFrame[] = []; // frames decodificados, orden ascendente por ts
  private decodeCursor = 0; // próximo chunk a enviar
  private currentKeyIdx = -1; // índice del keyframe desde el que arranca la decodificación actual
  private playheadTs = 0; // último ts pedido (en origen)
  private ready = false;
  private seeking = false; // hay un seek en curso
  private pendingSeek: number | null = null; // seek pedido mientras otro estaba en curso
  private needsKeyframe = true; // tras configure()/flush(), el 1er decode debe ser key
  private decoderGen = 0; // identifica el decoder actual; frames de uno viejo se descartan
  private disposed = false; // tras dispose, ignorar cualquier frame tardío

  private onError: (msg: string) => void;
  private onFrameReady: () => void;

  constructor(
    init: ClipDecoderInit,
    onError: (msg: string) => void,
    onFrameReady: () => void,
  ) {
    this.init = init;
    this.width = init.width;
    this.height = init.height;
    this.onError = onError;
    this.onFrameReady = onFrameReady;
  }

  get durationTimelineTick(): number {
    return Math.round((this.init.outTick - this.init.clipInTick) / this.init.speed);
  }

  coversTick(tick: number): boolean {
    const start = this.init.clipStartTick - (this.init.preRollTick || 0);
    return tick >= start && tick < this.init.clipStartTick + this.durationTimelineTick;
  }

  private sourceTs(tick: number): number {
    const clamped = Math.max(tick, this.init.clipStartTick);
    const srcTick = this.init.clipInTick + (clamped - this.init.clipStartTick) * this.init.speed;
    return Math.max(0, (srcTick / TICKS_PER_SECOND) * 1_000_000);
  }

  async load(): Promise<number> {
    const file = await readFromOPFS(this.init.opfsPath);
    const demuxed = await demux(file);
    this.chunks = demuxed.chunks.map((c) => ({
      chunk: c, ts: c.timestamp, isKey: c.type === "key",
    }));
    this.config = {
      codec: this.init.codec,
      codedWidth: this.init.width,
      codedHeight: this.init.height,
      description: demuxed.info.description,
    };
    const sup = await VideoDecoder.isConfigSupported(this.config);
    if (!sup.supported) {
      this.onError(`Códec no soportado: ${this.init.codec}`);
      return 0;
    }
    this.setupDecoder();
    this.ready = true;
    this.decodeCursor = 0;
    this.currentKeyIdx = 0;
    this.playheadTs = 0;
    this.fill();
    return demuxed.info.durationTick;
  }

  private setupDecoder(): void {
    try {
      this.decoder?.close();
    } catch { /* ya cerrada */ }
    // CRÍTICO: cerrar los frames del buffer antes de perder la referencia, o se
    // fugan en memoria GPU (causa de que el navegador se quede en negro).
    for (const f of this.buffer) {
      try { f.close(); } catch { /* ya cerrado */ }
    }
    this.buffer = [];
    const gen = ++this.decoderGen;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        // descarta frames de un decoder ya reemplazado o tras dispose (evita fuga)
        if (gen !== this.decoderGen || this.disposed) {
          try { frame.close(); } catch { /* ya cerrado */ }
          return;
        }
        this.onFrame(frame);
      },
      error: (e) => {
        // el decoder queda inutilizable; marca que hay que recolocar en keyframe.
        // ensureDecoder() lo recreará en el próximo fill().
        this.needsKeyframe = true;
        this.onError((e as Error).message);
      },
    });
    if (this.config) this.decoder.configure(this.config);
    this.needsKeyframe = true; // tras configure(), el primer decode debe ser keyframe
  }

  /** Recrea el decoder si quedó inutilizable y lo recoloca en un keyframe. */
  private ensureDecoder(): boolean {
    if (this.decoder && this.decoder.state === "configured") return true;
    this.setupDecoder();
    const k = this.keyframeIndexFor(this.playheadTs);
    this.decodeCursor = k;
    this.currentKeyIdx = k;
    for (const f of this.buffer) f.close();
    this.buffer = [];
    return this.decoder?.state === "configured";
  }

  /**
   * Índice del keyframe en/antes del timestamp dado. Garantiza que el índice
   * devuelto ES un keyframe (si no hay ninguno antes, usa el primer keyframe del
   * video hacia adelante). Esto evita enviar un no-keyframe como primer chunk.
   */
  private keyframeIndexFor(ts: number): number {
    let k = -1;
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].ts > ts) break;
      if (this.chunks[i].isKey) k = i;
    }
    if (k >= 0) return k;
    // no hay keyframe en/antes del target: busca el primero hacia adelante
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].isKey) return i;
    }
    return 0; // sin keyframes (no debería ocurrir en un MP4 válido)
  }

  /** Frame decodificado: lo guarda ordenado (o lo descarta si quedó muy atrás). */
  private onFrame(frame: VideoFrame): void {
    // descarta frames claramente pasados, pero conserva el más reciente <= playhead
    // como "frame actual" (necesario para que frameAt tenga algo que mostrar).
    const keepFloor = this.playheadTs - 1;
    if (frame.timestamp < keepFloor) {
      // ¿hay ya en el buffer un frame igual o más nuevo pero aún <= playhead? si no,
      // este es el mejor "frame actual": reemplaza el que hubiera.
      const haveCurrent = this.buffer.some((f) => f.timestamp <= this.playheadTs && f.timestamp >= frame.timestamp);
      if (haveCurrent) {
        frame.close();
      } else {
        this.insert(frame);
      }
    } else {
      this.insert(frame);
    }
    this.onFrameReady();
  }

  private insert(frame: VideoFrame): void {
    let i = this.buffer.length;
    while (i > 0 && this.buffer[i - 1].timestamp > frame.timestamp) i--;
    if (i > 0 && this.buffer[i - 1].timestamp === frame.timestamp) {
      frame.close(); // duplicado
      return;
    }
    this.buffer.splice(i, 0, frame);
    // si excede el tope, tira el frame más ANTIGUO que esté detrás del playhead
    // (nunca el más futuro, que es el que vamos a necesitar). Si todos están por
    // delante, tira el primero igualmente para acotar memoria.
    while (this.buffer.length > MAX_BUFFER) {
      if (this.buffer[0].timestamp <= this.playheadTs || this.buffer.length > MAX_BUFFER) {
        this.buffer.shift()!.close();
      } else {
        break;
      }
    }
  }

  /** Descarta del buffer los frames pasados, dejando solo el frame actual. */
  private dropPast(): void {
    // índice del último frame en/antes del playhead (el "frame actual")
    let current = -1;
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i].timestamp <= this.playheadTs) current = i;
      else break;
    }
    // borra todos los anteriores al actual (libera espacio para decodificar más)
    while (current > 0) {
      this.buffer.shift()!.close();
      current--;
    }
  }

  /** Cuántos frames hay en el buffer por delante del playhead. */
  private framesAhead(): number {
    let n = 0;
    for (const f of this.buffer) if (f.timestamp >= this.playheadTs) n++;
    return n;
  }

  /**
   * Alimenta el decoder con chunks ESTRICTAMENTE CONTIGUOS desde el keyframe
   * actual. La regla de oro de WebCodecs: tras un keyframe hay que enviar todos
   * los chunks en orden sin saltarse ninguno, o el decoder lanza "DataError: chunk
   * relies on other frames". Por eso nunca se salta un chunk: si needsKeyframe y el
   * cursor no está en un keyframe, se REPOSICIONA el cursor al keyframe (no se
   * avanza saltando), y a partir de ahí se envía todo contiguo.
   */
  private fill(): void {
    if (!this.ensureDecoder()) return;
    const dec = this.decoder!;
    // si hace falta arrancar en keyframe, coloca el cursor EXACTAMENTE en uno.
    // IMPORTANTE: el keyframe se elige según el PLAYHEAD actual (a dónde hay que
    // llegar), no según donde quedó el cursor. Si el decoder estuvo inactivo (p.ej.
    // mientras se reproducía otro clip) su cursor quedó al final del clip; al volver
    // a un punto anterior había que rebobinar al keyframe del playhead, no seguir
    // desde el final (causaba que el 1er clip se congelara al regresar del 2º).
    if (this.needsKeyframe) {
      const atCursorKey = this.chunks[this.decodeCursor]?.isKey
        && (this.chunks[this.decodeCursor]?.ts ?? 0) <= this.playheadTs;
      const k = atCursorKey
        ? this.decodeCursor
        : this.keyframeIndexFor(this.playheadTs);
      this.decodeCursor = k;
      this.currentKeyIdx = k;
    }
    // libera primero los frames ya consumidos, para hacer sitio a los futuros
    this.dropPast();
    let guard = 0;
    while (
      this.decodeCursor < this.chunks.length &&
      this.framesAhead() < TARGET_AHEAD &&
      dec.decodeQueueSize < DECODE_QUEUE_LIMIT &&
      guard < 64
    ) {
      // si el primer chunk a enviar tras un reset debe ser key y no lo es, NO
      // lo saltamos (eso crea huecos): reposicionamos al keyframe anterior.
      if (this.needsKeyframe && !this.chunks[this.decodeCursor].isKey) {
        this.decodeCursor = this.keyframeIndexFor(this.chunks[this.decodeCursor].ts);
        this.currentKeyIdx = this.decodeCursor;
      }
      try {
        const chunk = this.chunks[this.decodeCursor];
        dec.decode(chunk.chunk);
        this.needsKeyframe = false; // ya enviamos el keyframe inicial
        this.decodeCursor++;
        guard++;
      } catch (e) {
        // error de envío (estado inválido): resetea y reposiciona en keyframe.
        this.onError((e as Error).message);
        this.recoverDecoder();
        break;
      }
    }
  }

  /**
   * Recupera el decoder tras un error usando reset() (no close): vacía la cola y
   * reconfigura, dejando needsKeyframe para arrancar limpio en un keyframe.
   */
  private recoverDecoder(): void {
    const dec = this.decoder;
    try {
      if (dec && dec.state !== "closed") {
        dec.reset();
        if (this.config) dec.configure(this.config);
      } else {
        this.setupDecoder();
      }
    } catch {
      this.setupDecoder();
    }
    this.needsKeyframe = true;
    for (const f of this.buffer) {
      try { f.close(); } catch { /* ya cerrado */ }
    }
    this.buffer = [];
    // recoloca el cursor en el keyframe que cubre el playhead
    const k = this.keyframeIndexFor(this.playheadTs);
    this.decodeCursor = k;
    this.currentKeyIdx = k;
  }

  private async seekTo(targetTs: number): Promise<void> {
    if (this.seeking) { this.pendingSeek = targetTs; return; }
    this.seeking = true;
    try {
      for (;;) {
        if (!this.ensureDecoder()) return;
        const dec = this.decoder!;
        // marca ANTES del flush: así, si entra otro fill mientras flusheamos, no
        // intentará decodificar un no-keyframe (causaba el error residual).
        this.needsKeyframe = true;
        // invalida los frames que el flush pueda emitir: usamos reset() en vez de
        // flush() para DESCARTAR la cola en vez de esperar a que termine. reset()
        // es síncrono y vacía todo, evitando la carrera flush/buffer.
        try {
          if (dec.state === "configured") {
            dec.reset();
            if (this.config) dec.configure(this.config);
          }
        } catch { /* estado inválido: se recreará en ensureDecoder */ }
        for (const f of this.buffer) f.close();
        this.buffer = [];
        const k = this.keyframeIndexFor(targetTs);
        this.decodeCursor = k;
        this.currentKeyIdx = k;
        this.fill();
        this.onFrameReady();
        // ¿llegó otra petición de seek mientras procesábamos? atiéndela
        if (this.pendingSeek === null) break;
        targetTs = this.pendingSeek;
        this.pendingSeek = null;
      }
    } finally {
      this.seeking = false;
    }
  }

  private needSeek(target: number): boolean {
    // sin buffer: normalmente fill() arranca desde el keyframe correcto. PERO si el
    // decoder estuvo inactivo (se reprodujo otro clip) su decodeCursor quedó
    // adelantado; al volver a un punto anterior por clic, fill() seguiría desde el
    // cursor viejo y nunca alcanzaría el target -> frame congelado. Si el cursor ya
    // pasó el target, forzamos seek para rebobinar al keyframe correcto.
    if (this.buffer.length === 0) {
      // cursor al final de los chunks: no hay nada que decodificar hacia adelante,
      // hay que rebobinar al keyframe del target.
      if (this.decodeCursor >= this.chunks.length) return true;
      // el chunk en el cursor ya está MÁS ADELANTE que el target (el decoder estuvo
      // inactivo y su cursor quedó adelantado): seguir hacia adelante nunca
      // alcanzaría el target -> seek para rebobinar.
      const cursorTs = this.chunks[this.decodeCursor]?.ts ?? 0;
      if (cursorTs > target + 1) return true;
      return false;
    }

    const oldest = this.buffer[0].timestamp;
    const newest = this.buffer[this.buffer.length - 1].timestamp;

    // 1) retroceso: el target queda ANTES del primer frame del buffer. El frame
    //    pedido ya no está y no se puede alcanzar hacia adelante -> re-seek.
    if (target < oldest - 1) return true;

    // 1b) retroceso DENTRO del rango del buffer pero a un punto que ya no tiene un
    //    frame cercano por delante: el mejor frame <= target queda muy por detrás
    //    (más de STALE_GAP_US) y existe un keyframe entre ese frame y el target.
    //    Sin esto, al regresar a un punto intermedio se servía un frame viejo y la
    //    imagen se "congelaba" aunque el tiempo siguiera avanzando.
    if (target >= oldest && target <= newest) {
      let bestTs = -1;
      for (const f of this.buffer) {
        if (f.timestamp <= target) bestTs = f.timestamp;
        else break;
      }
      if (bestTs >= 0 && target - bestTs > STALE_GAP_US) {
        const kIdx = this.keyframeIndexFor(target);
        const kTs = this.chunks[kIdx]?.ts ?? 0;
        if (kTs > bestTs) return true; // hay un keyframe más cercano al target
      }
    }

    // 2) el decode se quedó muy por DETRÁS del playhead (el buffer no llega al
    //    target por un margen grande) y existe un keyframe entre el buffer y el
    //    target: salta a él en vez de perseguir el playhead frame a frame.
    if (newest < target - RESYNC_GAP_US) {
      const kIdx = this.keyframeIndexFor(target);
      const kTs = this.chunks[kIdx]?.ts ?? 0;
      if (kTs > newest) return true;
    }
    return false;
  }

  /** Prepara el clip para el tick dado: rellena o salta según haga falta. */
  async prepare(tick: number): Promise<void> {
    if (!this.ready) return;
    this.playheadTs = this.sourceTs(tick);
    // si hay un seek en curso, no toques el decoder: el seek ya rellenará al
    // terminar. Solo registra el destino más reciente para que lo atienda.
    if (this.seeking) {
      if (this.needSeek(this.playheadTs)) this.pendingSeek = this.playheadTs;
      return;
    }
    if (this.needSeek(this.playheadTs)) {
      dlog("seek", { playheadTs: this.playheadTs, kIdx: this.keyframeIndexFor(this.playheadTs), curKeyIdx: this.currentKeyIdx, buffer: this.buffer.length, seeking: this.seeking });
      await this.seekTo(this.playheadTs);
    } else {
      this.dropPast();
      this.fill();
      dlog("prepare", { playheadTs: this.playheadTs, buffer: this.buffer.length, ahead: this.framesAhead(), cursor: this.decodeCursor, qsize: this.decoder?.decodeQueueSize, state: this.decoder?.state });
    }
  }

  /** Mejor frame para el tick dado. Registra el último servido (diagnóstico). */
  frameAt(tick: number): VideoFrame | null {
    if (this.buffer.length === 0) return null;
    const target = this.sourceTs(tick);
    let best: VideoFrame | null = null;
    for (const f of this.buffer) {
      if (f.timestamp <= target) best = f;
      else break;
    }
    const chosen = best ?? this.buffer[0];
    return chosen;
  }

  dispose(): void {
    this.disposed = true;
    this.decoderGen++; // invalida frames en vuelo del decoder actual
    try {
      this.decoder?.close();
    } catch { /* ya cerrada */ }
    for (const f of this.buffer) f.close();
    this.buffer = [];
    this.decoder = null;
    this.ready = false;
  }
}
