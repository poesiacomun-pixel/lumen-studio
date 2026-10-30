import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { TICKS_PER_SECOND } from "../model/time";
import { drawSubtitle } from "../captions/renderSubtitle";
import { drawTextClip } from "../captions/renderText";
import { drawComposedFrame, evaluateCompose } from "../media/compositor";
import { ExportLayerDecoder } from "./exportLayerDecoder";
import { loadAllFonts } from "../media/fontLoader";
import { readFromOPFS } from "../storage/opfs";
import type { ExportRequest, ExportLayer, ExportTextLayer, FromExport } from "./exportMessages";
import type { TransitionMsg, ComposeMsg } from "../media/playbackMessages";

const sw = self as unknown as {
  postMessage(msg: FromExport, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ExportRequest>) => void) | null;
};

function post(msg: FromExport, transfer?: Transferable[]): void {
  sw.postMessage(msg, transfer);
}

/** Aplica el compose (transform/opacidad) de una capa de texto y la dibuja. */
function drawTextLayer(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: ExportTextLayer,
  c: ComposeMsg,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, c.opacity));
  ctx.translate(w / 2 + c.x, h / 2 + c.y);
  ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.scale(c.scaleX, c.scaleY);
  ctx.translate(-w / 2, -h / 2);
  drawTextClip(ctx, layer.content, w, h);
  ctx.restore();
}

/** Calcula la transición activa para un clip en un tick (o undefined). */
function transitionFor(req: ExportRequest, clipId: string, tick: number): TransitionMsg | undefined {
  for (const tr of req.transitions) {
    const startWin = tr.boundaryTick - tr.durationTick;
    if (tick < startWin || tick >= tr.boundaryTick) continue;
    const progress = (tick - startWin) / tr.durationTick;
    if (tr.fromClipId === clipId) return { type: tr.type, progress, role: "from" };
    if (tr.toClipId === clipId) return { type: tr.type, progress, role: "to" };
  }
  return undefined;
}

/**
 * Exportación multicapa, dirigida por tiempo (determinista). Recorre la timeline
 * frame a frame (cada 1/fps); en cada instante pide a cada capa de video su frame
 * exacto, las compone por z-index con su transform/opacidad/fusión, quema los
 * subtítulos y codifica. El resultado es idéntico a lo que se ve en el visor.
 */
async function run(req: ExportRequest): Promise<void> {
  const decoders: ExportLayerDecoder[] = [];
  try {
    // carga el catálogo de fuentes en este worker para que los títulos y
    // subtítulos se quemen con la tipografía elegida (no con el fallback).
    await loadAllFonts(self as unknown as { fonts: FontFaceSet });

    const canvas = new OffscreenCanvas(req.width, req.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo crear el contexto 2D de exportación.");

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: req.width, height: req.height },
      audio: req.audio
        ? { codec: "aac", numberOfChannels: req.audio.channels.length, sampleRate: req.audio.sampleRate }
        : undefined,
      fastStart: "in-memory",
    });

    // ---------- preparar capas ----------
    // ordena por z-index y, a igualdad, por inicio (el entrante de una transición
    // empieza después, así queda encima en wipe/slide).
    const layers = [...req.layers].sort(
      (a, b) => a.zIndex - b.zIndex || a.clipStartTick - b.clipStartTick,
    );
    // las capas de imagen se cargan como ImageBitmap (no usan VideoDecoder)
    const imageLayers: { layer: ExportLayer; bitmap: ImageBitmap }[] = [];
    for (const layer of layers) {
      if (layer.isImage) {
        try {
          const blob = await readFromOPFS(layer.opfsPath);
          const bitmap = await createImageBitmap(blob);
          imageLayers.push({ layer, bitmap });
        } catch (e) {
          post({ type: "error", message: "No se pudo cargar la imagen para exportar: " + (e as Error).message });
        }
        continue;
      }
      const dec = new ExportLayerDecoder(layer);
      await dec.load();
      decoders.push(dec);
    }

    // ---------- VIDEO (dirigido por tiempo) ----------
    let encodeError: unknown = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta ?? undefined),
      error: (e) => { encodeError = e; },
    });
    const encConfig: VideoEncoderConfig = {
      codec: "avc1.42001f", // H.264 Baseline, amplia compatibilidad
      width: req.width,
      height: req.height,
      bitrate: req.bitrate,
      framerate: req.fps,
      // El contenedor MP4 necesita H.264 en formato AVCC (con longitudes), no
      // Annex-B (start codes). Sin esto el archivo resulta ilegible en cualquier
      // reproductor. `avc.format` es parte de WebCodecs; el cast evita problemas si
      // lib.dom de TS no lo declara todavía.
      ...( { avc: { format: "avc" } } as Partial<VideoEncoderConfig> ),
    };
    const encSupport = await VideoEncoder.isConfigSupported(encConfig);
    if (!encSupport.supported) throw new Error("El equipo no puede codificar H.264.");
    videoEncoder.configure(encConfig);

    const totalTick = Math.max(1, req.durationTick);
    const tickPerFrame = TICKS_PER_SECOND / req.fps;
    const totalFrames = Math.max(1, Math.ceil(totalTick / tickPerFrame));

    // lista unificada de capas (video + texto) ordenada por z-index. Dentro del
    // mismo z, desempata por inicio (entrante de transición / texto encima).
    type Item =
      | { kind: "video"; dec: ExportLayerDecoder; zIndex: number; startTick: number }
      | { kind: "image"; layer: ExportLayer; bitmap: ImageBitmap; zIndex: number; startTick: number }
      | { kind: "text"; layer: typeof req.textLayers[number]; zIndex: number; startTick: number };
    const composeItems: Item[] = [
      ...decoders.map((dec) => ({ kind: "video" as const, dec, zIndex: dec.layer.zIndex, startTick: dec.layer.clipStartTick })),
      ...imageLayers.map((il) => ({ kind: "image" as const, layer: il.layer, bitmap: il.bitmap, zIndex: il.layer.zIndex, startTick: il.layer.clipStartTick })),
      ...req.textLayers.map((layer) => ({ kind: "text" as const, layer, zIndex: layer.zIndex, startTick: layer.startTick })),
    ];
    composeItems.sort((a, b) => a.zIndex - b.zIndex || a.startTick - b.startTick);

    for (let f = 0; f < totalFrames; f++) {
      const timelineTick = f * tickPerFrame;
      const tsUs = Math.round((timelineTick / TICKS_PER_SECOND) * 1_000_000);

      // fondo negro
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, req.width, req.height);
      ctx.restore();

      // compone cada capa activa de abajo (menor z) hacia arriba
      for (const item of composeItems) {
        if (item.kind === "video") {
          const dec = item.dec;
          if (!dec.coversTick(timelineTick)) continue;
          const frame = await dec.frameAt(timelineTick);
          if (!frame) continue;
          const fw = frame.displayWidth || frame.codedWidth || req.width;
          const fh = frame.displayHeight || frame.codedHeight || req.height;
          const transition = transitionFor(req, dec.layer.clipId, timelineTick);
          // evalúa el transform en el tick LOCAL del clip (sigue keyframes)
          const local = timelineTick - dec.layer.clipStartTick;
          const compose = evaluateCompose(dec.layer.transform, dec.layer.opacity, dec.layer.blendMode, local, dec.layer.effectId);
          drawComposedFrame(ctx, frame as unknown as CanvasImageSource, fw, fh, req.width, req.height, compose, transition);
        } else if (item.kind === "image") {
          const layer = item.layer;
          // fin del clip en la timeline = inicio + duración (out - in)
          const endTick = layer.clipStartTick + (layer.clipOutTick - layer.clipInTick);
          if (timelineTick < layer.clipStartTick || timelineTick >= endTick) continue;
          const transition = transitionFor(req, layer.clipId, timelineTick);
          const local = timelineTick - layer.clipStartTick;
          const compose = evaluateCompose(layer.transform, layer.opacity, layer.blendMode, local, layer.effectId);
          drawComposedFrame(ctx, item.bitmap, item.bitmap.width, item.bitmap.height, req.width, req.height, compose, transition);
        } else {
          const layer = item.layer;
          if (timelineTick < layer.startTick || timelineTick >= layer.endTick) continue;
          const local = timelineTick - layer.startTick;
          const compose = evaluateCompose(layer.transform, layer.opacity, layer.blendMode, local);
          drawTextLayer(ctx, layer, compose, req.width, req.height);
        }
      }

      drawSubtitle(ctx, req.width, req.height, req.cues, req.style, timelineTick);

      const composited = new VideoFrame(canvas, { timestamp: tsUs });
      videoEncoder.encode(composited, { keyFrame: f % 60 === 0 });
      composited.close();

      if (f % 5 === 0) {
        post({ type: "progress", phase: "video", progress: Math.min(99, Math.round((f / totalFrames) * 100)) });
      }
    }

    await videoEncoder.flush();
    videoEncoder.close();
    for (const d of decoders) d.dispose();
    decoders.length = 0;
    if (encodeError) throw encodeError;

    // ---------- AUDIO (opcional, aislado: si falla, el video igual sale) ----------
    if (req.audio) {
      try {
        const { channels, sampleRate } = req.audio;
        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta ?? undefined),
          error: (e) => { throw e as Error; },
        });
        audioEncoder.configure({
          codec: "mp4a.40.2", // AAC-LC
          sampleRate,
          numberOfChannels: channels.length,
          bitrate: 128_000,
        });

        const numFrames = channels[0]?.length ?? 0;
        const BLOCK = Math.round(sampleRate * 0.2); // ~0.2 s por bloque
        for (let off = 0; off < numFrames; off += BLOCK) {
          const len = Math.min(BLOCK, numFrames - off);
          const planar = new Float32Array(len * channels.length);
          for (let ch = 0; ch < channels.length; ch++) {
            planar.set(channels[ch].subarray(off, off + len), ch * len);
          }
          const audioData = new AudioData({
            format: "f32-planar",
            sampleRate,
            numberOfFrames: len,
            numberOfChannels: channels.length,
            timestamp: (off / sampleRate) * 1_000_000,
            data: planar,
          });
          audioEncoder.encode(audioData);
          audioData.close();
          post({ type: "progress", phase: "audio", progress: Math.round((off / numFrames) * 100) });
        }
        await audioEncoder.flush();
        audioEncoder.close();
      } catch (audioErr) {
        console.warn("Exportación sin audio:", (audioErr as Error).message);
      }
    }

    // ---------- MUX ----------
    post({ type: "progress", phase: "muxing", progress: 100 });
    muxer.finalize();
    const { buffer } = muxer.target as ArrayBufferTarget;
    post({ type: "done", buffer }, [buffer]);
  } catch (e) {
    for (const d of decoders) d.dispose();
    post({ type: "error", message: (e as Error).message });
  }
}

sw.onmessage = (e: MessageEvent<ExportRequest>) => {
  if (e.data.type === "export") void run(e.data);
};
