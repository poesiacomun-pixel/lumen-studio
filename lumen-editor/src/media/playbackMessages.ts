// Protocolo de mensajes entre el hilo principal y el worker de reproducción.
// El worker posee el OffscreenCanvas y el decoder; el hilo principal solo
// lleva el reloj y le manda el tiempo a presentar.

import type { SubtitleStyle, BlendMode, TextContent } from "../model/types";

export interface SubtitleCueMsg {
  startTick: number;
  endTick: number;
  text: string;
  style?: Partial<SubtitleStyle>; // override por subtítulo (opcional)
}

/**
 * Instantánea de la composición de un clip, ya evaluada (sin keyframes). El
 * worker la usa para dibujar el frame con su transform, opacidad y fusión. El
 * hilo principal la recalcula y la reenvía cuando cambia el playhead o el clip.
 */
export interface ComposeMsg {
  x: number; // px respecto al centro
  y: number;
  scaleX: number; // 1 = original
  scaleY: number;
  rotation: number; // grados
  anchorX: number; // 0..1
  anchorY: number;
  opacity: number; // 0..1
  blendMode: BlendMode;
  effectId?: string; // efecto de look del catálogo (videoEffects); undefined = ninguno
}

/**
 * Efecto de transición aplicado a una capa durante su ventana de transición.
 * `progress` va 0→1 a lo largo de la transición. `role` indica si esta capa es
 * el clip saliente ("from") o el entrante ("to"). El compositor combina ambos.
 */
export interface TransitionMsg {
  type: string; // "crossfade" | "fade" | "wipeLeft" | "wipeRight" | "slideLeft" | ...
  progress: number; // 0..1
  role: "from" | "to";
}

/**
 * Una capa de video del compositor: un clip con su asset y recorte. El worker
 * mantiene un decodificador por cada capa y las compone por z-index.
 */
export interface VideoLayerMsg {
  clipId: string;
  opfsPath: string;
  codec: string;
  width: number;
  height: number;
  zIndex: number; // orden de capa: mayor = encima
  clipStartTick: number;
  clipInTick: number;
  outTick: number; // recorte final dentro del asset (ticks de asset)
  speed: number;
  preRollTick: number; // cuánto antes se activa (para una transición entrante)
  isImage?: boolean; // si true, la fuente es una imagen fija (ImageBitmap), no video
  imgStartTick?: number; // ticks de timeline en que la imagen aparece (inicio)
  imgEndTick?: number; // ticks de timeline en que la imagen desaparece (fin)
}

/** Capa de texto (título): contenido y estilo; se posiciona con su compose. */
export interface TextLayerMsg {
  clipId: string;
  zIndex: number;
  startTick: number;
  endTick: number; // fin en la timeline
  content: TextContent;
}

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "canvasSize"; width: number; height: number } // resolución del proyecto
  | { type: "setLayers"; layers: VideoLayerMsg[]; textLayers: TextLayerMsg[]; fps: number }
  | { type: "setTextLayers"; textLayers: TextLayerMsg[] } // actualiza solo el texto (edición en vivo)
  | { type: "present"; tick: number; composes: Record<string, ComposeMsg>; transitions: Record<string, TransitionMsg> }
  | { type: "subtitles"; cues: SubtitleCueMsg[]; style: SubtitleStyle }
  | { type: "loadFonts" }; // carga el catálogo de fuentes en el worker

export type FromWorker =
  | { type: "ready" }
  | { type: "layersReady" }
  | { type: "error"; message: string };
