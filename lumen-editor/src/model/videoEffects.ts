/*
 * Catálogo de efectos de video (filtros de color/look) aplicables por clip.
 *
 * Cada efecto se define como una combinación de:
 *  - `filter`: cadena CSS para ctx.filter (grayscale, sepia, contrast, saturate,
 *    brightness, hue-rotate, blur, invert...). Es lo que da el look base.
 *  - `overlay` (opcional): un velo de color con modo de fusión y opacidad, para
 *    tintes (cálido, frío, teal&orange, viñeta de color, etc.).
 *  - `vignette` (opcional): oscurecimiento de bordes para look cinematográfico.
 *
 * Todo se renderiza con Canvas 2D (sin shaders), así que funciona igual en el
 * visor (worker) y en la exportación, y es barato.
 */

export type BlendCss =
  | "source-over" | "multiply" | "screen" | "overlay"
  | "soft-light" | "color" | "lighter" | "hue";

export interface EffectOverlay {
  color: string; // color CSS del velo
  blend: BlendCss; // modo de fusión del velo sobre el frame
  alpha: number; // 0..1 opacidad del velo
}

export interface VideoEffectDef {
  id: string; // identificador estable (se guarda en el clip)
  label: string; // nombre visible
  section: string; // sección a la que pertenece
  filter: string; // cadena para ctx.filter ("none" si no usa)
  overlay?: EffectOverlay; // velo de color opcional
  vignette?: number; // intensidad de viñeta 0..1 (opcional)
}

/* Helpers para construir definiciones de forma compacta. */
const fx = (
  id: string, label: string, filter: string,
  overlay?: EffectOverlay, vignette?: number,
): Omit<VideoEffectDef, "section"> => ({ id, label, filter, overlay, vignette });

/* ─────────────────  1. Blanco y negro / Monocromo  ───────────────── */
const BW: Omit<VideoEffectDef, "section">[] = [
  fx("bw_classic", "B&N Clásico", "grayscale(1)"),
  fx("bw_contrast", "B&N Contraste", "grayscale(1) contrast(1.4)"),
  fx("bw_soft", "B&N Suave", "grayscale(1) contrast(0.9) brightness(1.08)"),
  fx("bw_noir", "Noir", "grayscale(1) contrast(1.6) brightness(0.9)", undefined, 0.45),
  fx("bw_silver", "Plata", "grayscale(1) contrast(1.15) brightness(1.05)"),
  fx("bw_highkey", "High Key", "grayscale(1) brightness(1.3) contrast(0.85)"),
  fx("bw_lowkey", "Low Key", "grayscale(1) brightness(0.75) contrast(1.5)", undefined, 0.5),
  fx("bw_selenium", "Selenio", "grayscale(1) sepia(0.15) contrast(1.2)"),
  fx("bw_platinum", "Platino", "grayscale(1) brightness(1.1) contrast(1.05)"),
  fx("bw_charcoal", "Carbón", "grayscale(1) contrast(1.7) brightness(0.85)"),
  fx("bw_ivory", "Marfil", "grayscale(1) sepia(0.08) brightness(1.15) contrast(0.95)"),
  fx("bw_steel", "Acero", "grayscale(1) contrast(1.3)", { color: "#3a4a66", blend: "soft-light", alpha: 0.25 }),
  fx("bw_warmtone", "Tono Cálido", "grayscale(1) sepia(0.2)", { color: "#7a5a32", blend: "soft-light", alpha: 0.2 }),
  fx("bw_cooltone", "Tono Frío", "grayscale(1)", { color: "#324a66", blend: "soft-light", alpha: 0.22 }),
  fx("bw_dramatic", "Dramático", "grayscale(1) contrast(1.8) brightness(0.95)", undefined, 0.55),
  fx("bw_faded", "Desvaído", "grayscale(1) contrast(0.8) brightness(1.12)"),
  fx("bw_punch", "Punch", "grayscale(1) contrast(1.5) brightness(1.05)"),
  fx("bw_matte", "Mate", "grayscale(1) contrast(0.92) brightness(1.05)"),
  fx("bw_infrared", "Infrarrojo", "grayscale(1) contrast(1.4) brightness(1.2)"),
  fx("bw_ink", "Tinta", "grayscale(1) contrast(2) brightness(0.9)", undefined, 0.4),
];

/* ─────────────────  2. Vintage / Retro  ───────────────── */
const VINTAGE: Omit<VideoEffectDef, "section">[] = [
  fx("vin_sepia", "Sepia", "sepia(0.8) contrast(1.05)"),
  fx("vin_70s", "Años 70", "sepia(0.45) saturate(1.3) contrast(0.95) brightness(1.05)", { color: "#d8a04a", blend: "soft-light", alpha: 0.25 }),
  fx("vin_80s", "Años 80", "saturate(1.5) contrast(1.1) hue-rotate(-8deg)", { color: "#ff2e88", blend: "soft-light", alpha: 0.18 }),
  fx("vin_polaroid", "Polaroid", "sepia(0.3) contrast(0.9) brightness(1.12) saturate(1.1)", { color: "#e8d8a0", blend: "soft-light", alpha: 0.2 }),
  fx("vin_kodak", "Kodak Gold", "sepia(0.25) saturate(1.35) contrast(1.05) brightness(1.04)", { color: "#e0a830", blend: "soft-light", alpha: 0.2 }),
  fx("vin_faded", "Desteñido", "saturate(0.7) contrast(0.85) brightness(1.1) sepia(0.15)"),
  fx("vin_washed", "Lavado", "saturate(0.6) contrast(0.8) brightness(1.15)"),
  fx("vin_warm", "Cálido Retro", "sepia(0.3) saturate(1.2) brightness(1.05)", { color: "#cc7a33", blend: "soft-light", alpha: 0.22 }),
  fx("vin_nostalgia", "Nostalgia", "sepia(0.4) saturate(1.1) contrast(0.95)", { color: "#c89858", blend: "soft-light", alpha: 0.28 }, 0.3),
  fx("vin_vhs", "VHS", "saturate(1.4) contrast(1.1) brightness(1.05)", { color: "#2e6cff", blend: "soft-light", alpha: 0.12 }),
  fx("vin_super8", "Super 8", "sepia(0.5) saturate(1.25) contrast(1.05) brightness(1.05)", { color: "#d89030", blend: "soft-light", alpha: 0.3 }, 0.35),
  fx("vin_technicolor", "Technicolor", "saturate(1.8) contrast(1.2)", { color: "#ff3a2e", blend: "soft-light", alpha: 0.12 }),
  fx("vin_oldfilm", "Cinta Vieja", "sepia(0.55) contrast(1.15) brightness(0.98) saturate(0.9)", { color: "#b5832e", blend: "soft-light", alpha: 0.3 }, 0.45),
  fx("vin_crossprocess", "Cross Process", "saturate(1.5) contrast(1.25) hue-rotate(-12deg)", { color: "#00b894", blend: "soft-light", alpha: 0.18 }),
  fx("vin_lomo", "Lomo", "saturate(1.6) contrast(1.3) brightness(0.98)", undefined, 0.5),
  fx("vin_retrowarm", "Retro Cálido", "sepia(0.35) saturate(1.3) brightness(1.06)", { color: "#e89030", blend: "overlay", alpha: 0.15 }),
  fx("vin_sundae", "Sundae", "saturate(0.8) contrast(0.9) brightness(1.1) sepia(0.2)", { color: "#ff9a8c", blend: "soft-light", alpha: 0.2 }),
  fx("vin_disposable", "Cámara Desechable", "saturate(1.3) contrast(1.15) brightness(1.05) sepia(0.12)", { color: "#ffd166", blend: "soft-light", alpha: 0.15 }, 0.25),
  fx("vin_aged", "Envejecido", "sepia(0.6) contrast(1.1) brightness(0.95) saturate(0.85)", { color: "#9c7530", blend: "multiply", alpha: 0.15 }, 0.4),
  fx("vin_dreamy", "Soñador", "saturate(1.1) contrast(0.85) brightness(1.15) sepia(0.18) blur(0.4px)", { color: "#ffc0cb", blend: "soft-light", alpha: 0.2 }),
];

/* ─────────────────  3. Cinematográfico  ───────────────── */
const CINEMATIC: Omit<VideoEffectDef, "section">[] = [
  fx("cin_tealorange", "Teal & Orange", "contrast(1.15) saturate(1.2)", { color: "#ff7a18", blend: "soft-light", alpha: 0.2 }, 0.35),
  fx("cin_blockbuster", "Blockbuster", "contrast(1.25) saturate(1.15) brightness(0.98)", { color: "#1a4a6e", blend: "soft-light", alpha: 0.22 }, 0.4),
  fx("cin_moody", "Moody", "contrast(1.2) saturate(0.9) brightness(0.92)", { color: "#16213e", blend: "soft-light", alpha: 0.3 }, 0.45),
  fx("cin_dune", "Dune", "sepia(0.3) contrast(1.15) saturate(0.85) brightness(1.02)", { color: "#c8772e", blend: "soft-light", alpha: 0.3 }, 0.35),
  fx("cin_matrix", "Matrix", "contrast(1.2) saturate(1.1) hue-rotate(60deg) brightness(0.95)", { color: "#1a3a1a", blend: "soft-light", alpha: 0.3 }, 0.4),
  fx("cin_oppenheimer", "Oppenheimer", "contrast(1.3) saturate(0.6) brightness(1.02)", { color: "#9c6a2e", blend: "soft-light", alpha: 0.18 }, 0.4),
  fx("cin_batman", "Noche", "contrast(1.35) saturate(0.85) brightness(0.85)", { color: "#0a1428", blend: "soft-light", alpha: 0.35 }, 0.55),
  fx("cin_thriller", "Thriller", "contrast(1.25) saturate(0.95) brightness(0.95)", { color: "#142a3a", blend: "soft-light", alpha: 0.28 }, 0.45),
  fx("cin_scifi", "Sci-Fi", "contrast(1.2) saturate(1.2)", { color: "#0aa6c8", blend: "soft-light", alpha: 0.25 }, 0.4),
  fx("cin_western", "Western", "sepia(0.35) contrast(1.2) saturate(1.05)", { color: "#b5762e", blend: "soft-light", alpha: 0.3 }, 0.4),
  fx("cin_horror", "Horror", "contrast(1.3) saturate(0.7) brightness(0.85)", { color: "#2a0a0a", blend: "soft-light", alpha: 0.3 }, 0.6),
  fx("cin_romance", "Romance", "contrast(1.05) saturate(1.1) brightness(1.08)", { color: "#ff9ec4", blend: "soft-light", alpha: 0.2 }, 0.25),
  fx("cin_epic", "Épico", "contrast(1.3) saturate(1.25) brightness(0.98)", { color: "#c89030", blend: "soft-light", alpha: 0.22 }, 0.45),
  fx("cin_noir2", "Neo-Noir", "contrast(1.4) saturate(0.8) brightness(0.9)", { color: "#1a2a4a", blend: "soft-light", alpha: 0.3 }, 0.5),
  fx("cin_sunset", "Atardecer Cine", "contrast(1.15) saturate(1.3) brightness(1.02)", { color: "#ff6a3a", blend: "soft-light", alpha: 0.28 }, 0.3),
  fx("cin_bleach", "Bleach Bypass", "contrast(1.4) saturate(0.5) brightness(1.05)", undefined, 0.4),
  fx("cin_indie", "Indie", "contrast(1.1) saturate(0.95) brightness(1.05) sepia(0.12)", { color: "#5a7a6e", blend: "soft-light", alpha: 0.2 }, 0.3),
  fx("cin_drama", "Drama", "contrast(1.25) saturate(1.0) brightness(0.95)", { color: "#3a3a52", blend: "soft-light", alpha: 0.25 }, 0.4),
  fx("cin_goldhour", "Hora Dorada", "contrast(1.1) saturate(1.25) brightness(1.05)", { color: "#ffb04a", blend: "soft-light", alpha: 0.28 }, 0.3),
  fx("cin_steel", "Acero Frío", "contrast(1.25) saturate(0.85)", { color: "#4a6a8a", blend: "soft-light", alpha: 0.3 }, 0.4),
];

/* ─────────────────  4. Tonos de color (cálido/frío/grading)  ───────────────── */
const COLOR: Omit<VideoEffectDef, "section">[] = [
  fx("col_warm", "Cálido", "saturate(1.15) brightness(1.03)", { color: "#ff8a2e", blend: "soft-light", alpha: 0.22 }),
  fx("col_cool", "Frío", "saturate(1.1)", { color: "#2e8aff", blend: "soft-light", alpha: 0.22 }),
  fx("col_vibrant", "Vibrante", "saturate(1.6) contrast(1.1)"),
  fx("col_muted", "Apagado", "saturate(0.7) contrast(0.95)"),
  fx("col_pastel", "Pastel", "saturate(0.85) brightness(1.1) contrast(0.9)", { color: "#ffd6e8", blend: "soft-light", alpha: 0.2 }),
  fx("col_punchy", "Saturado", "saturate(1.8) contrast(1.15) brightness(1.02)"),
  fx("col_sunny", "Soleado", "saturate(1.3) brightness(1.1)", { color: "#ffd24a", blend: "soft-light", alpha: 0.2 }),
  fx("col_arctic", "Ártico", "saturate(1.1) brightness(1.05)", { color: "#a0e0ff", blend: "soft-light", alpha: 0.25 }),
  fx("col_emerald", "Esmeralda", "saturate(1.3) contrast(1.1)", { color: "#0ac86e", blend: "soft-light", alpha: 0.18 }),
  fx("col_crimson", "Carmesí", "saturate(1.3) contrast(1.1)", { color: "#e02e3a", blend: "soft-light", alpha: 0.18 }),
  fx("col_purple", "Violeta", "saturate(1.25) contrast(1.05)", { color: "#8a3aff", blend: "soft-light", alpha: 0.2 }),
  fx("col_teal", "Turquesa", "saturate(1.25) contrast(1.08)", { color: "#0ac8c8", blend: "soft-light", alpha: 0.2 }),
  fx("col_peach", "Durazno", "saturate(1.15) brightness(1.08)", { color: "#ffb38a", blend: "soft-light", alpha: 0.22 }),
  fx("col_mint", "Menta", "saturate(1.1) brightness(1.06)", { color: "#8affc4", blend: "soft-light", alpha: 0.2 }),
  fx("col_rose", "Rosado", "saturate(1.15) brightness(1.06)", { color: "#ff8ab0", blend: "soft-light", alpha: 0.2 }),
  fx("col_amber", "Ámbar", "saturate(1.25) contrast(1.05)", { color: "#ffaa1a", blend: "soft-light", alpha: 0.22 }),
  fx("col_indigo", "Índigo", "saturate(1.2) contrast(1.08)", { color: "#3a4aff", blend: "soft-light", alpha: 0.2 }),
  fx("col_highcontrast", "Alto Contraste", "contrast(1.5) saturate(1.1)"),
  fx("col_softlight", "Luz Suave", "contrast(0.9) brightness(1.12) saturate(1.05)"),
  fx("col_clean", "Limpio", "contrast(1.08) saturate(1.12) brightness(1.02)"),
];

/* ─────────────────  5. Estético / Redes sociales  ───────────────── */
const AESTHETIC: Omit<VideoEffectDef, "section">[] = [
  fx("aes_clarendon", "Clarendon", "contrast(1.2) saturate(1.35) brightness(1.05)", { color: "#2e9aff", blend: "soft-light", alpha: 0.12 }),
  fx("aes_juno", "Juno", "saturate(1.4) contrast(1.05) sepia(0.1)", { color: "#ff7a4a", blend: "soft-light", alpha: 0.15 }),
  fx("aes_gingham", "Gingham", "brightness(1.05) contrast(0.9) sepia(0.12)", { color: "#fff0e0", blend: "soft-light", alpha: 0.2 }),
  fx("aes_lark", "Lark", "saturate(1.1) brightness(1.08) contrast(0.95)", { color: "#8affd6", blend: "soft-light", alpha: 0.12 }),
  fx("aes_moon", "Moon", "grayscale(1) brightness(1.05) contrast(1.1)", { color: "#3a3a52", blend: "soft-light", alpha: 0.15 }),
  fx("aes_reyes", "Reyes", "sepia(0.22) contrast(0.85) brightness(1.1) saturate(0.75)"),
  fx("aes_aden", "Aden", "saturate(0.85) brightness(1.08) hue-rotate(-12deg)", { color: "#ffb8a0", blend: "soft-light", alpha: 0.18 }),
  fx("aes_slumber", "Slumber", "saturate(0.8) brightness(1.05)", { color: "#9c8a6e", blend: "soft-light", alpha: 0.25 }),
  fx("aes_crema", "Crema", "saturate(0.9) contrast(0.95) brightness(1.06) sepia(0.15)", { color: "#f0e0c8", blend: "soft-light", alpha: 0.18 }),
  fx("aes_ludwig", "Ludwig", "saturate(1.25) contrast(1.05) brightness(1.05)", { color: "#ffd6b0", blend: "soft-light", alpha: 0.12 }),
  fx("aes_perpetua", "Perpetua", "saturate(1.15) brightness(1.05)", { color: "#0ac8a0", blend: "soft-light", alpha: 0.15 }),
  fx("aes_amaro", "Amaro", "saturate(1.3) brightness(1.1) contrast(0.95)", { color: "#ffe0a0", blend: "soft-light", alpha: 0.18 }, 0.2),
  fx("aes_mayfair", "Mayfair", "saturate(1.2) contrast(1.05) brightness(1.04)", { color: "#ffb0c4", blend: "soft-light", alpha: 0.15 }, 0.25),
  fx("aes_valencia", "Valencia", "sepia(0.18) saturate(1.2) brightness(1.08) contrast(0.95)", { color: "#ffd6a0", blend: "soft-light", alpha: 0.18 }),
  fx("aes_xpro", "X-Pro II", "saturate(1.4) contrast(1.25) sepia(0.15)", { color: "#1a6a4a", blend: "soft-light", alpha: 0.15 }, 0.4),
  fx("aes_hudson", "Hudson", "brightness(1.08) contrast(1.05) saturate(1.1)", { color: "#5a9aff", blend: "soft-light", alpha: 0.15 }),
  fx("aes_sierra", "Sierra", "saturate(0.85) contrast(0.9) brightness(1.05) sepia(0.12)", { color: "#c8a06e", blend: "soft-light", alpha: 0.2 }, 0.3),
  fx("aes_willow", "Willow", "grayscale(0.6) brightness(1.05) contrast(0.95)", { color: "#9c8aa0", blend: "soft-light", alpha: 0.2 }),
  fx("aes_brooklyn", "Brooklyn", "saturate(1.1) brightness(1.08) contrast(0.95) sepia(0.08)", { color: "#a0d6ff", blend: "soft-light", alpha: 0.15 }),
  fx("aes_glow", "Glow", "brightness(1.12) saturate(1.15) contrast(0.92) blur(0.3px)", { color: "#fff0d6", blend: "screen", alpha: 0.12 }),
];

/* ─────────────────  6. Estilizado / Creativo  ───────────────── */
const STYLIZED: Omit<VideoEffectDef, "section">[] = [
  fx("sty_invert", "Negativo", "invert(1)"),
  fx("sty_psychedelic", "Psicodélico", "saturate(2) hue-rotate(90deg) contrast(1.2)"),
  fx("sty_neon", "Neón", "saturate(1.8) contrast(1.4) brightness(1.05)", { color: "#ff00e0", blend: "soft-light", alpha: 0.2 }),
  fx("sty_cyberpunk", "Cyberpunk", "saturate(1.6) contrast(1.3)", { color: "#ff007a", blend: "soft-light", alpha: 0.22 }, 0.4),
  fx("sty_vaporwave", "Vaporwave", "saturate(1.5) contrast(1.1) hue-rotate(-20deg)", { color: "#9a5aff", blend: "soft-light", alpha: 0.25 }),
  fx("sty_synthwave", "Synthwave", "saturate(1.6) contrast(1.2)", { color: "#ff2e88", blend: "soft-light", alpha: 0.25 }, 0.35),
  fx("sty_duotone_bp", "Duotono Azul", "grayscale(1) contrast(1.2)", { color: "#2e4aff", blend: "color", alpha: 0.6 }),
  fx("sty_duotone_pk", "Duotono Rosa", "grayscale(1) contrast(1.2)", { color: "#ff2e7a", blend: "color", alpha: 0.6 }),
  fx("sty_duotone_gn", "Duotono Verde", "grayscale(1) contrast(1.2)", { color: "#0ac86e", blend: "color", alpha: 0.55 }),
  fx("sty_thermal", "Térmico", "saturate(2.5) hue-rotate(150deg) contrast(1.3)"),
  fx("sty_xray", "Rayos X", "invert(1) grayscale(1) contrast(1.4)"),
  fx("sty_solarize", "Solarizado", "contrast(1.5) hue-rotate(180deg) brightness(1.1)"),
  fx("sty_comic", "Cómic", "saturate(1.7) contrast(1.6) brightness(1.05)"),
  fx("sty_dream", "Onírico", "saturate(1.2) brightness(1.15) contrast(0.85) blur(0.6px)", { color: "#d6c4ff", blend: "screen", alpha: 0.15 }),
  fx("sty_haze", "Bruma", "contrast(0.8) brightness(1.15) saturate(0.9)", { color: "#ffffff", blend: "screen", alpha: 0.12 }),
  fx("sty_frost", "Escarcha", "saturate(0.8) brightness(1.1) contrast(0.95)", { color: "#c4e8ff", blend: "screen", alpha: 0.18 }),
  fx("sty_ember", "Brasa", "saturate(1.4) contrast(1.2) brightness(1.02)", { color: "#ff5a1a", blend: "soft-light", alpha: 0.3 }, 0.45),
  fx("sty_toxic", "Tóxico", "saturate(1.8) hue-rotate(50deg) contrast(1.25)", { color: "#9aff00", blend: "soft-light", alpha: 0.2 }),
  fx("sty_midnight", "Medianoche", "contrast(1.3) saturate(1.1) brightness(0.8)", { color: "#1a1a4a", blend: "soft-light", alpha: 0.35 }, 0.5),
  fx("sty_sepia_deep", "Sepia Profundo", "sepia(1) contrast(1.2) brightness(0.95)", undefined, 0.4),
];

/* ─────────────────  Ensamblado del catálogo  ───────────────── */
export interface EffectSection {
  id: string;
  label: string;
  effects: VideoEffectDef[];
}

function withSection(items: Omit<VideoEffectDef, "section">[], section: string): VideoEffectDef[] {
  return items.map((e) => ({ ...e, section }));
}

export const EFFECT_SECTIONS: EffectSection[] = [
  { id: "bw", label: "Blanco y Negro", effects: withSection(BW, "bw") },
  { id: "vintage", label: "Vintage", effects: withSection(VINTAGE, "vintage") },
  { id: "cinematic", label: "Cinematográfico", effects: withSection(CINEMATIC, "cinematic") },
  { id: "color", label: "Tonos de Color", effects: withSection(COLOR, "color") },
  { id: "aesthetic", label: "Estético", effects: withSection(AESTHETIC, "aesthetic") },
  { id: "stylized", label: "Estilizado", effects: withSection(STYLIZED, "stylized") },
];

/** Mapa id -> definición, para resolver un efecto guardado en un clip. */
export const EFFECT_BY_ID: Record<string, VideoEffectDef> = Object.fromEntries(
  EFFECT_SECTIONS.flatMap((s) => s.effects).map((e) => [e.id, e]),
);

/** Devuelve la definición de un efecto por id (o undefined). */
export function effectById(id: string): VideoEffectDef | undefined {
  return EFFECT_BY_ID[id];
}
