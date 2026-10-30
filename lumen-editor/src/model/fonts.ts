/**
 * Catálogo de tipografías disponibles para títulos y subtítulos. Todas son de
 * Google Fonts, publicadas bajo licencias libres (SIL Open Font License 1.1 o
 * Apache 2.0), por lo que se pueden usar y redistribuir sin coste ni problemas
 * de copyright. Se cargan en tiempo de ejecución desde Google Fonts (en el
 * documento para la UI/preview y en el worker para el render del canvas).
 *
 * `family` es el nombre exacto de la familia en Google Fonts (sirve tanto para
 * construir la URL como para `ctx.font`). `category` agrupa la fuente para la UI.
 */
export interface FontDef {
  family: string;
  category: "display" | "generic";
  /** Etiqueta corta para mostrar en la UI (por defecto, la propia familia). */
  label?: string;
  /** true si la familia tiene peso 700 (bold); false/omitido = un solo peso. */
  bold?: boolean;
}

/* ──────────────────────────────────────────────────────────────────────────
 * 40 fuentes DISPLAY: llamativas, espectaculares, estilo redes sociales/CapCut.
 * Pensadas para títulos grandes, hooks, carteles, miniaturas de YouTube, etc.
 * ────────────────────────────────────────────────────────────────────────── */
const DISPLAY_FONTS: FontDef[] = [
  // — Condensadas de alto impacto (títulos, hooks, estilo cartel) —
  { family: "Anton", category: "display" },
  { family: "Bebas Neue", category: "display" },
  { family: "Oswald", category: "display" , bold: true },
  { family: "Archivo Black", category: "display" },
  { family: "Fjalla One", category: "display" , bold: true },
  { family: "Teko", category: "display" , bold: true },
  { family: "Saira Condensed", category: "display" , bold: true },
  { family: "Khand", category: "display" , bold: true },
  { family: "Barlow Condensed", category: "display" , bold: true },
  { family: "Staatliches", category: "display" },
  // — Sans pesadas, modernas (estilo subtítulo "Hormozi", redes) —
  { family: "Montserrat", category: "display", label: "Montserrat (Bold)" , bold: true },
  { family: "Poppins", category: "display", label: "Poppins (Bold)" , bold: true },
  { family: "Archivo", category: "display" , bold: true },
  { family: "Sora", category: "display" , bold: true },
  { family: "Outfit", category: "display" , bold: true },
  { family: "Familjen Grotesk", category: "display" , bold: true },
  { family: "Bricolage Grotesque", category: "display" , bold: true },
  { family: "Unbounded", category: "display" , bold: true },
  // — Serif editoriales / elegantes (hooks emotivos, "premium") —
  { family: "Playfair Display", category: "display" , bold: true },
  { family: "Fraunces", category: "display" , bold: true },
  { family: "DM Serif Display", category: "display" },
  { family: "Cormorant Garamond", category: "display" , bold: true },
  { family: "Bodoni Moda", category: "display" , bold: true },
  { family: "Marcellus", category: "display" },
  { family: "Spectral", category: "display" , bold: true },
  // — Display con carácter pero usables (redondeadas/fat, con mesura) —
  { family: "Fredoka", category: "display" },
  { family: "Lilita One", category: "display" },
  { family: "Paytone One", category: "display" },
  { family: "Alfa Slab One", category: "display" },
  { family: "Abril Fatface", category: "display" },
  { family: "Bangers", category: "display" },
  // — Scripts/manuscritas elegantes (para combos bold + cursiva) —
  { family: "Pacifico", category: "display" },
  { family: "Dancing Script", category: "display" },
  { family: "Caveat", category: "display" },
  { family: "Satisfy", category: "display" },
  { family: "Sacramento", category: "display" },
  { family: "Great Vibes", category: "display" },
  { family: "Yellowtail", category: "display" },
  { family: "Kaushan Script", category: "display" },
  { family: "Allura", category: "display" },
];

/* ──────────────────────────────────────────────────────────────────────────
 * 40 fuentes GENÉRICAS: variadas pero versátiles (sans, serif, mono, script,
 * redondeadas, condensadas). Para subtítulos legibles y títulos sobrios.
 * ────────────────────────────────────────────────────────────────────────── */
const GENERIC_FONTS: FontDef[] = [
  // — Sans neutras y legibles (subtítulos, cuerpo, UI) —
  { family: "Inter", category: "generic" },
  { family: "Roboto", category: "generic" },
  { family: "Open Sans", category: "generic" },
  { family: "Lato", category: "generic" },
  { family: "Source Sans 3", category: "generic" },
  { family: "Noto Sans", category: "generic" },
  { family: "Raleway", category: "generic" },
  { family: "Nunito", category: "generic" },
  { family: "Nunito Sans", category: "generic" },
  { family: "Work Sans", category: "generic" },
  { family: "DM Sans", category: "generic" },
  { family: "Plus Jakarta Sans", category: "generic" },
  { family: "Manrope", category: "generic" },
  { family: "Rubik", category: "generic" },
  { family: "Mulish", category: "generic" },
  { family: "Karla", category: "generic" },
  { family: "Quicksand", category: "generic" },
  { family: "Josefin Sans", category: "generic" },
  { family: "Barlow", category: "generic" },
  { family: "Cabin", category: "generic" },
  { family: "PT Sans", category: "generic" },
  { family: "Fira Sans", category: "generic" },
  { family: "Hind", category: "generic" },
  { family: "Figtree", category: "generic" },
  { family: "Onest", category: "generic" },
  { family: "Schibsted Grotesk", category: "generic" },
  // — Serif clásicas y legibles (cuerpo editorial, títulos sobrios) —
  { family: "Merriweather", category: "generic" },
  { family: "Lora", category: "generic" },
  { family: "Roboto Slab", category: "generic" },
  { family: "PT Serif", category: "generic" },
  { family: "Bitter", category: "generic" },
  { family: "Crimson Text", category: "generic" },
  { family: "EB Garamond", category: "generic" },
  { family: "Source Serif 4", category: "generic" },
  { family: "Libre Baskerville", category: "generic" },
  // — Monoespaciadas (técnico, código, etiquetas) —
  { family: "Roboto Mono", category: "generic" },
  { family: "JetBrains Mono", category: "generic" },
  { family: "Space Mono", category: "generic" },
  { family: "IBM Plex Mono", category: "generic" },
  { family: "Fira Code", category: "generic" },
];

export const ALL_FONTS: FontDef[] = [...DISPLAY_FONTS, ...GENERIC_FONTS];

/** Devuelve el valor para `font-family` / `ctx.font` (con fallback genérico). */
export function fontStack(family: string): string {
  // las display llevan fallback sans-serif; las serif/mono mantienen su familia
  return `"${family}", system-ui, sans-serif`;
}

/**
 * Construye la URL de la hoja de estilos de Google Fonts que carga TODAS las
 * familias del catálogo de una vez. Se inyecta en el documento (UI/preview).
 * Para cada familia se piden los pesos 400 y 700 cuando existen; Google ignora
 * los pesos no disponibles.
 */
export function googleFontsHref(): string {
  const families = ALL_FONTS.map((f) => {
    const name = f.family.replace(/ /g, "+");
    // pide 400;700 si la familia tiene bold; si es de un solo peso, sin sufijo
    // (pedir un peso inexistente invalida toda la URL de Google Fonts).
    const multi = f.category === "generic" || f.bold;
    return multi ? `family=${name}:wght@400;700` : `family=${name}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}
