/// <reference lib="webworker" />
import { drawSubtitle } from "../captions/renderSubtitle";
import { drawTextClip } from "../captions/renderText";
import { drawComposedFrame, defaultCompose } from "./compositor";
import { ClipDecoder } from "./clipDecoder";
import { loadAllFonts } from "./fontLoader";
import { readFromOPFS } from "../storage/opfs";
import type { SubtitleStyle } from "../model/types";
import type {
  ToWorker,
  FromWorker,
  SubtitleCueMsg,
  ComposeMsg,
  TransitionMsg,
  VideoLayerMsg,
  TextLayerMsg,
} from "./playbackMessages";

// Diagnóstico temporal: vuelca el estado de las capas en cada present.
const DEBUG_WORKER = false;

/**
 * Crea un reportador de errores que silencia repeticiones del MISMO mensaje:
 * solo emite el primero y luego, como mucho, uno cada 2s. Evita inundar la
 * consola con miles de errores idénticos (p.ej. fallos de decode en cadena).
 */
function makeThrottledErrorReporter(): (msg: string) => void {
  let lastMsg = "";
  let lastAt = 0;
  return (msg: string) => {
    const now = Date.now();
    if (msg === lastMsg && now - lastAt < 2000) return;
    lastMsg = msg;
    lastAt = now;
    post({ type: "error", message: msg });
  };
}


const sw = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

function post(msg: FromWorker, transfer?: Transferable[]): void {
  sw.postMessage(msg, transfer);
}

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

// resolución del proyecto (lienzo fijo, independiente del tamaño de cada clip)
let canvasW = 1920;
let canvasH = 1080;

// un decodificador por capa de video, indexado por clipId
const decoders = new Map<string, ClipDecoder>();
// un ImageBitmap por capa de imagen, indexado por clipId (las imágenes no usan
// el decodificador de video: se cargan una vez y se dibujan en cada frame)
const imageBitmaps = new Map<string, ImageBitmap>();
// último frame dibujado por clip de video (respaldo para no quedar en negro
// mientras el decoder repuebla el buffer tras un seek/scrub).
const lastFrameBitmaps = new Map<string, ImageBitmap>();
let layerOrder: VideoLayerMsg[] = []; // capas ordenadas por zIndex ascendente
let textLayers: TextLayerMsg[] = []; // capas de texto (títulos)

// composición por clip (transform/opacidad/fusión), llega en cada present
let composes: Record<string, ComposeMsg> = {};
// transición activa por clip (si la hay), llega en cada present
let transitions: Record<string, TransitionMsg> = {};

// subtítulos
let cues: SubtitleCueMsg[] = [];
let subStyle: SubtitleStyle | null = null;
let currentTimelineTick = 0;
// Cada present() incrementa esta marca. Durante un arrastre llegan muchos present
// casi a la vez; sus await pueden resolver fuera de orden. Solo el más reciente
// debe pintar, para no dejar pegado el frame de un tick obsoleto al cruzar clips.
let presentGen = 0;

function applyCanvasSize(): void {
  if (!canvas) return;
  canvas.width = canvasW;
  canvas.height = canvasH;
}

/** Reconstruye el conjunto de decodificadores a partir de las capas recibidas. */
async function onSetLayers(layers: VideoLayerMsg[], texts: TextLayerMsg[]): Promise<void> {
  // descarta decodificadores que ya no existen
  const keep = new Set(layers.map((l) => l.clipId));
  for (const [id, dec] of decoders) {
    if (!keep.has(id)) {
      dec.dispose();
      decoders.delete(id);
      const last = lastFrameBitmaps.get(id);
      if (last) { last.close(); lastFrameBitmaps.delete(id); }
    }
  }
  // descarta bitmaps de imagen que ya no existen
  for (const [id, bmp] of imageBitmaps) {
    if (!keep.has(id)) {
      bmp.close();
      imageBitmaps.delete(id);
    }
  }

  // crea o actualiza los decodificadores de cada capa
  for (const layer of layers) {
    // capa de imagen: carga el ImageBitmap desde OPFS una sola vez
    if (layer.isImage) {
      if (!imageBitmaps.has(layer.clipId)) {
        try {
          const blob = await readFromOPFS(layer.opfsPath);
          const bmp = await createImageBitmap(blob);
          imageBitmaps.set(layer.clipId, bmp);
          paint(currentTimelineTick); // repinta ahora que la imagen está disponible
        } catch (e) {
          post({ type: "error", message: "No se pudo cargar la imagen: " + (e as Error).message });
        }
      }
      continue; // las imágenes no usan ClipDecoder
    }

    const existing = decoders.get(layer.clipId);
    // si cambió el recorte/asset, recrea; si no, conserva (evita recargar)
    const sameSource =
      existing &&
      existing.init.opfsPath === layer.opfsPath &&
      existing.init.clipInTick === layer.clipInTick &&
      existing.init.outTick === layer.outTick &&
      existing.init.clipStartTick === layer.clipStartTick &&
      existing.init.speed === layer.speed &&
      existing.init.preRollTick === layer.preRollTick;
    if (sameSource) continue;
    existing?.dispose();

    const dec = new ClipDecoder(
      {
        opfsPath: layer.opfsPath,
        codec: layer.codec,
        width: layer.width,
        height: layer.height,
        clipStartTick: layer.clipStartTick,
        clipInTick: layer.clipInTick,
        outTick: layer.outTick,
        speed: layer.speed,
        preRollTick: layer.preRollTick,
      },
      makeThrottledErrorReporter(),
      () => paint(currentTimelineTick),
    );
    decoders.set(layer.clipId, dec);
    try {
      await dec.load();
    } catch (e) {
      // un asset corrupto o un códec no soportado no debe tumbar las demás capas
      // ni dejar al controller esperando "layersReady" para siempre.
      post({ type: "error", message: `No se pudo cargar una capa: ${(e as Error).message}` });
      dec.dispose();
      decoders.delete(layer.clipId);
    }
  }

  layerOrder = [...layers]
    // conserva las capas que tienen decodificador (video) y las de imagen (que
    // usan ImageBitmap, no decoder); si no, las imágenes quedarían fuera del pintado
    .filter((l) => l.isImage || decoders.has(l.clipId))
    .sort((a, b) => a.zIndex - b.zIndex);
  textLayers = texts;
  post({ type: "layersReady" });
  paint(currentTimelineTick);
}

/** Aplica el transform/opacidad de un compose y dibuja texto centrado. */
function paintTextLayer(
  context: OffscreenCanvasRenderingContext2D,
  layer: TextLayerMsg,
  compose: ComposeMsg,
): void {
  if (!canvas) return;
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, compose.opacity));
  const cx = canvas.width / 2 + compose.x;
  const cy = canvas.height / 2 + compose.y;
  context.translate(cx, cy);
  context.rotate((compose.rotation * Math.PI) / 180);
  context.scale(compose.scaleX, compose.scaleY);
  context.translate(-canvas.width / 2, -canvas.height / 2);
  drawTextClip(context, layer.content, canvas.width, canvas.height);
  context.restore();
}

/** Dibuja el fondo negro, todas las capas activas (video + texto) y subtítulos. */
function paint(tick: number): void {
  if (!ctx || !canvas) return;
  currentTimelineTick = tick;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // lista unificada de capas (video + texto) ordenada por z-index. Dentro del
  // mismo z, el entrante ("to") de una transición va después (encima).
  type Item = { kind: "video"; layer: VideoLayerMsg } | { kind: "text"; layer: TextLayerMsg };
  const items: Item[] = [
    ...layerOrder.map((layer) => ({ kind: "video" as const, layer })),
    ...textLayers.map((layer) => ({ kind: "text" as const, layer })),
  ];
  items.sort((a, b) => {
    if (a.layer.zIndex !== b.layer.zIndex) return a.layer.zIndex - b.layer.zIndex;
    const ra = transitions[a.layer.clipId]?.role === "to" ? 1 : 0;
    const rb = transitions[b.layer.clipId]?.role === "to" ? 1 : 0;
    return ra - rb;
  });

  for (const item of items) {
    if (item.kind === "video") {
      const layer = item.layer;
      const compose = composes[layer.clipId] ?? defaultCompose();
      const transition = transitions[layer.clipId];
      // capa de imagen: dibuja el bitmap si el clip cubre este tick
      if (layer.isImage) {
        // fin del clip en la timeline = inicio + duración (out - in)
        const endTick = layer.clipStartTick + (layer.outTick - layer.clipInTick);
        if (tick < layer.clipStartTick || tick >= endTick) continue;
        const bmp = imageBitmaps.get(layer.clipId);
        if (!bmp) continue;
        drawComposedFrame(ctx, bmp, bmp.width, bmp.height, canvas.width, canvas.height, compose, transition);
        continue;
      }
      const dec = decoders.get(layer.clipId);
      if (!dec || !dec.coversTick(tick)) continue;
      const frame = dec.frameAt(tick);
      if (!frame) {
        // sin frame (el decoder está repoblando tras un seek): redibuja el último
        // frame conocido de este clip para no quedar en negro / congelado.
        const last = lastFrameBitmaps.get(layer.clipId);
        if (last) {
          drawComposedFrame(ctx, last, last.width, last.height, canvas.width, canvas.height, compose, transition);
        }
        continue;
      }
      const fw = frame.displayWidth || frame.codedWidth || canvas.width;
      const fh = frame.displayHeight || frame.codedHeight || canvas.height;
      drawComposedFrame(ctx, frame as unknown as CanvasImageSource, fw, fh, canvas.width, canvas.height, compose, transition);
      // guarda un respaldo del frame actual (asíncrono, barato) para el caso null
      createImageBitmap(frame as unknown as CanvasImageSource).then((bmp) => {
        const prev = lastFrameBitmaps.get(layer.clipId);
        if (prev) prev.close();
        lastFrameBitmaps.set(layer.clipId, bmp);
      }).catch(() => { /* frame ya cerrado: ignora */ });
    } else {
      const layer = item.layer;
      if (tick < layer.startTick || tick >= layer.endTick) continue;
      const compose = composes[layer.clipId] ?? defaultCompose();
      paintTextLayer(ctx, layer, compose);
    }
  }

  drawSubtitle(ctx, canvas.width, canvas.height, cues, subStyle, currentTimelineTick);
}

/** Prepara las capas activas (decodifica/seekea) y pinta el frame compuesto. */
async function onPresent(
  tick: number,
  comps: Record<string, ComposeMsg>,
  trans: Record<string, TransitionMsg>,
): Promise<void> {
  currentTimelineTick = tick;
  composes = comps;
  transitions = trans;
  const myGen = ++presentGen; // marca de esta petición
  // prepara en paralelo solo las capas que cubren este tick
  const active = layerOrder.filter((l) => {
    const d = decoders.get(l.clipId);
    return d && d.coversTick(tick);
  });
  await Promise.all(active.map((l) => decoders.get(l.clipId)!.prepare(tick)));
  // si mientras preparábamos llegó un present más reciente, este quedó obsoleto:
  // no pintamos (el más nuevo pintará su propio frame). Evita dejar pegado un
  // frame viejo al arrastrar rápido cruzando de un clip a otro.
  if (myGen !== presentGen) return;
  if (DEBUG_WORKER) {
    const info = layerOrder.map((l) => {
      const d = decoders.get(l.clipId);
      const f = d ? d.frameAt(tick) : null;
      return {
        clip: l.clipId.slice(0, 6),
        isImage: !!l.isImage,
        covers: d ? d.coversTick(tick) : "noDec",
        frameTs: f ? Math.round(f.timestamp / 1000) : (d ? "null" : "noDec"),
      };
    });
    console.log("[worker present] tick=" + Math.round(tick), JSON.stringify(info));
  }
  paint(tick);
}

sw.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
      applyCanvasSize();
      post({ type: "ready" });
      break;
    case "canvasSize":
      canvasW = msg.width;
      canvasH = msg.height;
      applyCanvasSize();
      paint(currentTimelineTick);
      break;
    case "setLayers":
      void onSetLayers(msg.layers, msg.textLayers);
      break;
    case "setTextLayers":
      textLayers = msg.textLayers;
      paint(currentTimelineTick);
      break;
    case "present":
      void onPresent(msg.tick, msg.composes, msg.transitions);
      break;
    case "subtitles":
      cues = [...msg.cues].sort((a, b) => a.startTick - b.startTick);
      subStyle = msg.style;
      paint(currentTimelineTick);
      break;
    case "loadFonts":
      // carga el catálogo de fuentes en este worker y repinta al terminar para
      // que el texto se muestre con la tipografía elegida.
      void loadAllFonts(self as unknown as { fonts: FontFaceSet }).then(() => paint(currentTimelineTick));
      break;
  }
};
