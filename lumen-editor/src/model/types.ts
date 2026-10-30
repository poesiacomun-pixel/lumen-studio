import type { Ticks, Fps } from "./time";

export type Id = string;

/* ───────────────────────── Animación / keyframes ───────────────────────── */

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";

export interface Keyframe {
  id: Id;
  tick: Ticks; // posición relativa al inicio del clip
  value: number;
  easing: Easing; // cómo interpola HACIA el siguiente keyframe
}

/**
 * Una propiedad que es o bien constante, o bien animada por keyframes.
 * Toda propiedad animable del modelo usa esta misma forma, de modo que el
 * compositor solo necesita saber evaluar `evaluate(prop, t)` (ver animated.ts).
 */
export type Animated =
  | { kind: "static"; value: number }
  | { kind: "animated"; keyframes: Keyframe[] };

/* ──────────────────────── Transform y composición ──────────────────────── */

export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "add";

export interface Transform {
  x: Animated; // desplazamiento en px respecto al centro
  y: Animated;
  scaleX: Animated; // 1 = tamaño original
  scaleY: Animated;
  rotation: Animated; // grados
  anchorX: Animated; // 0..1
  anchorY: Animated;
}

/* ──────────────────────── Assets (medios importados) ───────────────────── */

export type AssetKind = "video" | "audio" | "image";

export interface Asset {
  id: Id;
  kind: AssetKind;
  name: string;
  opfsPath: string; // ruta dentro del Origin Private File System
  durationTick: Ticks; // 0 para imágenes
  width?: number;
  height?: number;
  sampleRate?: number; // audio
  channels?: number; // nº de canales de audio (1 mono, 2 estéreo…)
  codec?: string; // p.ej. "avc1.640028", "opus"
  hasAudio?: boolean; // un video puede traer o no pista de audio
  peaksPath?: string; // ruta OPFS del archivo de picos precalculado (waveform)
}

/* ───────────────────────────────  Efectos  ─────────────────────────────── */

export interface EffectInstance {
  id: Id;
  type: string; // clave en el registro de efectos (cada uno = un shader WGSL)
  enabled: boolean;
  params: Record<string, Animated>; // parámetros animables por nombre
}

/* ─────────────────────────────────  Clips  ─────────────────────────────── */

/* ────────────────────────────────  Texto  ──────────────────────────────── */

/**
 * Contenido de un clip de texto (título libre). Cuando un Clip tiene `text`, es
 * una capa de texto: no usa asset de video; el compositor dibuja el texto con su
 * estilo, posicionado por el `transform` del clip (igual que cualquier capa).
 */
export interface TextContent {
  text: string;
  fontFamily: string;
  fontSizePx: number; // en el espacio de píxeles del proyecto
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  background: boolean;
  backgroundColor: string; // con alfa
  outlineColor: string;
  outlineWidthPx: number;
}

export function defaultTextContent(): TextContent {
  return {
    text: "Texto",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizePx: 96,
    color: "#FFFFFF",
    bold: true,
    italic: false,
    align: "center",
    background: false,
    backgroundColor: "rgba(0,0,0,0.55)",
    outlineColor: "#000000",
    outlineWidthPx: 0,
  };
}

export interface Clip {
  id: Id;
  assetId: Id;
  trackId: Id;
  startTick: Ticks; // posición en la línea de tiempo
  inTick: Ticks; // recorte: inicio dentro del asset
  outTick: Ticks; // recorte: fin dentro del asset
  speed: number; // 1 = normal
  opacity: Animated;
  blendMode: BlendMode;
  transform: Transform;
  effects: EffectInstance[];
  // ── efecto de look por clip (id del catálogo de videoEffects); undefined = ninguno ──
  effectId?: string;
  // ── texto (si está presente, es una capa de texto y no usa asset de video) ──
  text?: TextContent;
  // ── audio ──
  // Ganancia del clip (1 = original). Animable, así que de aquí salen los fades.
  volume: Animated;
  muted: boolean; // silencia este clip concreto (independiente del mute de pista)
  fadeInTick: Ticks; // rampa de subida desde el inicio del clip (0 = sin fade)
  fadeOutTick: Ticks; // rampa de bajada hacia el final del clip (0 = sin fade)
}

/** Duración del clip en la línea de tiempo, considerando recorte y velocidad. */
export function clipDuration(clip: Clip): Ticks {
  const speed = clip.speed > 0 ? clip.speed : 1; // evita /0 o velocidades inválidas
  return Math.round((clip.outTick - clip.inTick) / speed);
}

/**
 * Valores de audio por defecto para un clip nuevo. Centralizado aquí para que
 * la creación, el split y la migración de proyectos viejos coincidan.
 */
export function defaultClipAudio(): Pick<
  Clip,
  "volume" | "muted" | "fadeInTick" | "fadeOutTick"
> {
  return {
    volume: { kind: "static", value: 1 },
    muted: false,
    fadeInTick: 0,
    fadeOutTick: 0,
  };
}

/* ──────────────────────────────  Transiciones  ─────────────────────────── */

export interface TransitionInstance {
  id: Id;
  type: string; // "crossfade", "wipe", ...
  fromClipId: Id;
  toClipId: Id;
  durationTick: Ticks;
  params: Record<string, Animated>;
}

/* ────────────────────────────────  Pistas  ─────────────────────────────── */

export type TrackKind = "video" | "audio" | "text" | "image";

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  zIndex: number; // orden de capa; mayor = encima
  muted: boolean;
  locked: boolean;
  hidden: boolean;
  volume: number; // ganancia de toda la pista (1 = original); solo aplica a audio
  solo: boolean; // si alguna pista está en solo, las no-solo se silencian
  clipIds: Id[]; // ordenados por startTick
}

/* ──────────────────────────────  Subtítulos  ──────────────────────────── */

export type SubtitlePosition = "top" | "middle" | "bottom";

export interface SubtitleStyle {
  fontFamily: string;
  fontSizePx: number; // en el espacio de píxeles del video (escala con él)
  color: string;
  bold: boolean;
  italic: boolean;
  background: boolean;
  backgroundColor: string; // con alfa, p.ej. "rgba(0,0,0,0.55)"
  outlineColor: string;
  outlineWidthPx: number;
  position: SubtitlePosition;
}

export interface CaptionCue {
  id: Id;
  startTick: Ticks;
  endTick: Ticks;
  text: string;
  /** Sobrescribe campos del estilo global solo para este subtítulo (opcional). */
  style?: Partial<SubtitleStyle>;
}

export function defaultSubtitleStyle(): SubtitleStyle {
  return {
    fontFamily: "system-ui, sans-serif",
    fontSizePx: 48,
    color: "#ffffff",
    bold: true,
    italic: false,
    background: true,
    backgroundColor: "rgba(0,0,0,0.55)",
    outlineColor: "#000000",
    outlineWidthPx: 0,
    position: "bottom",
  };
}

/* ───────────────────────────────  Proyecto  ───────────────────────────── */

export interface Project {
  id: Id;
  name: string;
  width: number;
  height: number;
  fps: Fps;
  durationTick: Ticks;
  trackIds: Id[]; // orden de pistas (de arriba abajo en la UI)
  subtitleStyle: SubtitleStyle;
}

/**
 * Estado completo y serializable del documento. Normalizado por id: cada
 * mutación toca una entidad a la vez, lo que hace baratos los comandos y el
 * undo/redo. Los medios NO viven aquí (están en OPFS); aquí solo van referencias.
 */
export interface ProjectState {
  project: Project;
  assets: Record<Id, Asset>;
  tracks: Record<Id, Track>;
  clips: Record<Id, Clip>;
  transitions: Record<Id, TransitionInstance>;
  captions: Record<Id, CaptionCue>;
}
