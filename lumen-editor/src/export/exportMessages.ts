import type { SubtitleStyle, TextContent, Transform, Animated, BlendMode } from "../model/types";
import type { SubtitleCueMsg } from "../media/playbackMessages";

/**
 * Una capa de video a exportar: su asset, recorte y transform ANIMABLE. El worker
 * decodifica cada capa y, en cada frame, evalúa el transform en el tick local del
 * clip y compone las capas activas, igual que la vista previa. Así las
 * animaciones de transform/opacidad se quedan en el archivo final.
 */
export interface ExportLayer {
  clipId: string;
  opfsPath: string;
  codec: string;
  width: number;
  height: number;
  zIndex: number;
  clipStartTick: number;
  clipInTick: number;
  clipOutTick: number;
  speed: number;
  preRollTick: number;
  transform: Transform; // crudo (con keyframes), se evalúa por frame
  opacity: Animated;
  blendMode: BlendMode;
  effectId?: string; // efecto de look del catálogo (videoEffects)
  isImage?: boolean; // si true, la fuente es una imagen fija (no video)
}

/** Transición a quemar en el export: entre dos clips, con su tipo y duración. */
export interface ExportTransition {
  type: string;
  fromClipId: string;
  toClipId: string;
  boundaryTick: number; // tick donde A termina y B empieza
  durationTick: number;
}

/** Capa de texto a quemar en el export: contenido, estilo y transform animable. */
export interface ExportTextLayer {
  clipId: string;
  zIndex: number;
  startTick: number;
  endTick: number;
  content: TextContent;
  transform: Transform;
  opacity: Animated;
  blendMode: BlendMode;
}

export interface ExportRequest {
  type: "export";
  width: number; // resolución del proyecto (lienzo)
  height: number;
  fps: number;
  durationTick: number; // duración total de la timeline a exportar
  layers: ExportLayer[]; // capas de video, cualquier orden (se ordena por zIndex)
  textLayers: ExportTextLayer[]; // capas de texto (títulos)
  transitions: ExportTransition[];
  cues: SubtitleCueMsg[];
  style: SubtitleStyle;
  bitrate: number;
  audio?: { channels: Float32Array[]; sampleRate: number };
}

export type FromExport =
  | { type: "progress"; phase: "video" | "audio" | "muxing"; progress: number }
  | { type: "done"; buffer: ArrayBuffer }
  | { type: "error"; message: string };
