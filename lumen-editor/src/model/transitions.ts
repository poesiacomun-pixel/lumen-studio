/**
 * Catálogo de transiciones de video. Cada transición se define por un "engine"
 * (cómo se anima) más parámetros (dirección, etc.). El compositor sabe aplicar
 * cada engine con Canvas 2D, así que se ve igual en el visor y en la exportación.
 *
 * El `type` que se guarda en la transición es el id de la entrada (p.ej.
 * "wipeLeft", "slideUp", "irisIn"...). El compositor lee ese id.
 */

export interface TransitionDef {
  id: string; // identificador estable, se guarda en la transición
  label: string; // nombre visible
  section: string; // categoría
}

export interface TransitionSection {
  id: string;
  name: string;
  items: TransitionDef[];
}

const t = (id: string, label: string): Omit<TransitionDef, "section"> => ({ id, label });

const SECTIONS_RAW: { id: string; name: string; items: Omit<TransitionDef, "section">[] }[] = [
  {
    id: "fade",
    name: "Fundidos",
    items: [
      t("crossfade", "Fundido cruzado"),
      t("fade", "Fundido"),
      t("fadeBlack", "Fundido a negro"),
      t("fadeWhite", "Fundido a blanco"),
      t("dissolve", "Disolver"),
      t("flash", "Destello"),
    ],
  },
  {
    id: "wipe",
    name: "Barridos",
    items: [
      t("wipeLeft", "Barrido ←"),
      t("wipeRight", "Barrido →"),
      t("wipeUp", "Barrido ↑"),
      t("wipeDown", "Barrido ↓"),
      t("wipeTL", "Barrido ↖"),
      t("wipeTR", "Barrido ↗"),
      t("wipeBL", "Barrido ↙"),
      t("wipeBR", "Barrido ↘"),
    ],
  },
  {
    id: "slide",
    name: "Deslizar",
    items: [
      t("slideLeft", "Deslizar ←"),
      t("slideRight", "Deslizar →"),
      t("slideUp", "Deslizar ↑"),
      t("slideDown", "Deslizar ↓"),
    ],
  },
  {
    id: "push",
    name: "Empujar",
    items: [
      t("pushLeft", "Empujar ←"),
      t("pushRight", "Empujar →"),
      t("pushUp", "Empujar ↑"),
      t("pushDown", "Empujar ↓"),
    ],
  },
  {
    id: "iris",
    name: "Iris y formas",
    items: [
      t("irisIn", "Círculo ▸ centro"),
      t("irisOut", "Círculo ▸ fuera"),
      t("boxIn", "Caja ▸ centro"),
      t("boxOut", "Caja ▸ fuera"),
      t("diamondIn", "Rombo ▸ centro"),
      t("diamondOut", "Rombo ▸ fuera"),
    ],
  },
  {
    id: "bars",
    name: "Barras y persianas",
    items: [
      t("barsH", "Persiana horizontal"),
      t("barsV", "Persiana vertical"),
      t("splitH", "División horizontal"),
      t("splitV", "División vertical"),
      t("checker", "Mosaico"),
    ],
  },
  {
    id: "zoom",
    name: "Zoom y movimiento",
    items: [
      t("zoomIn", "Acercar"),
      t("zoomOut", "Alejar"),
      t("whipLeft", "Paneo rápido ←"),
      t("whipRight", "Paneo rápido →"),
      t("blurMix", "Mezcla difusa"),
    ],
  },
];

export const TRANSITION_SECTIONS: TransitionSection[] = SECTIONS_RAW.map((s) => ({
  id: s.id,
  name: s.name,
  items: s.items.map((it) => ({ ...it, section: s.id })),
}));

export const TRANSITION_BY_ID: Record<string, TransitionDef> = Object.fromEntries(
  TRANSITION_SECTIONS.flatMap((s) => s.items).map((it) => [it.id, it]),
);

export function transitionById(id: string): TransitionDef | undefined {
  return TRANSITION_BY_ID[id];
}

export function transitionLabelOf(id: string): string {
  return TRANSITION_BY_ID[id]?.label ?? id;
}
