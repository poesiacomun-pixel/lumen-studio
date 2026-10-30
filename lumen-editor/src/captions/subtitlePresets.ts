import type { SubtitleStyle } from "../model/types";

/**
 * Plantillas de formato para subtítulos. Cada preset define solo campos de
 * aspecto del SubtitleStyle GLOBAL del proyecto, así que aplicarlo cambia el
 * formato de TODOS los subtítulos de una vez (los que no tengan un override
 * propio). No incluye texto ni tiempos.
 */
export interface SubtitlePreset {
  id: string;
  name: string;
  style: Partial<SubtitleStyle>;
}

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  {
    id: "clean",
    name: "Limpio",
    style: {
      fontFamily: "system-ui, sans-serif", fontSizePx: 48, color: "#ffffff",
      bold: true, italic: false, background: false,
      outlineColor: "#000000", outlineWidthPx: 0, position: "bottom",
    },
  },
  {
    id: "boxed",
    name: "Con caja",
    style: {
      fontFamily: "system-ui, sans-serif", fontSizePx: 46, color: "#ffffff",
      bold: true, italic: false, background: true,
      backgroundColor: "rgba(0,0,0,0.62)",
      outlineColor: "#000000", outlineWidthPx: 0, position: "bottom",
    },
  },
  {
    id: "outline",
    name: "Contorno",
    style: {
      fontFamily: "system-ui, sans-serif", fontSizePx: 50, color: "#ffffff",
      bold: true, italic: false, background: false,
      outlineColor: "#000000", outlineWidthPx: 6, position: "bottom",
    },
  },
  {
    id: "pop",
    name: "Llamativo",
    style: {
      fontFamily: "system-ui, sans-serif", fontSizePx: 54, color: "#ffe16b",
      bold: true, italic: false, background: false,
      outlineColor: "#3a2e00", outlineWidthPx: 7, position: "bottom",
    },
  },
  {
    id: "accent",
    name: "Acento",
    style: {
      fontFamily: "system-ui, sans-serif", fontSizePx: 50, color: "#7fc6ba",
      bold: true, italic: false, background: false,
      outlineColor: "#10221f", outlineWidthPx: 4, position: "bottom",
    },
  },
  {
    id: "subtle",
    name: "Sutil",
    style: {
      fontFamily: "system-ui, sans-serif", fontSizePx: 42, color: "#edebe4",
      bold: false, italic: true, background: false,
      outlineColor: "#000000", outlineWidthPx: 2, position: "bottom",
    },
  },
];
