import type { TextContent } from "../model/types";

/**
 * Plantillas de estilo de título. Cada preset define solo los campos de aspecto
 * (no el texto), de modo que aplicarlo conserva el contenido escrito por el
 * usuario y solo cambia su apariencia.
 */
export interface TitlePreset {
  id: string;
  name: string;
  /** Campos de estilo que aplica (nunca incluye `text`). */
  style: Partial<Omit<TextContent, "text">>;
}

export const TITLE_PRESETS: TitlePreset[] = [
  {
    id: "plain",
    name: "Simple",
    style: {
      fontSizePx: 96, color: "#FFFFFF", bold: true, italic: false,
      align: "center", background: false, outlineColor: "#000000", outlineWidthPx: 0,
    },
  },
  {
    id: "headline",
    name: "Titular",
    style: {
      fontSizePx: 140, color: "#FFFFFF", bold: true, italic: false,
      align: "center", background: false, outlineColor: "#000000", outlineWidthPx: 6,
    },
  },
  {
    id: "boxed",
    name: "Con caja",
    style: {
      fontSizePx: 84, color: "#FFFFFF", bold: true, italic: false,
      align: "center", background: true, backgroundColor: "rgba(0,0,0,0.62)",
      outlineColor: "#000000", outlineWidthPx: 0,
    },
  },
  {
    id: "accent",
    name: "Acento",
    style: {
      fontSizePx: 104, color: "#7FC6BA", bold: true, italic: false,
      align: "center", background: false, outlineColor: "#10221F", outlineWidthPx: 4,
    },
  },
  {
    id: "subtle",
    name: "Sutil",
    style: {
      fontSizePx: 72, color: "#EDEBE4", bold: false, italic: true,
      align: "center", background: false, outlineColor: "#000000", outlineWidthPx: 2,
    },
  },
  {
    id: "pop",
    name: "Llamativo",
    style: {
      fontSizePx: 128, color: "#FFE16B", bold: true, italic: false,
      align: "center", background: false, outlineColor: "#3A2E00", outlineWidthPx: 8,
    },
  },
];
