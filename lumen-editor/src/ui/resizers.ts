/**
 * Paneles redimensionables. Conecta los divisores (.gutter) con el panel que
 * ajustan y persiste los tamaños en localStorage para que se conserven entre
 * sesiones. Cada gutter se identifica con data-gutter:
 *  - "library"   → ancho de la biblioteca (panel izquierdo)
 *  - "inspector" → ancho del inspector (panel derecho)
 *  - "timeline"  → alto de la timeline (panel inferior)
 */

interface PanelSpec {
  el: HTMLElement;
  axis: "x" | "y";
  min: number;
  max: number;
  // dirección del arrastre respecto al tamaño: para el inspector y la timeline,
  // arrastrar a la izquierda/arriba AGRANDA, así que invertimos el delta.
  invert: boolean;
  storageKey: string;
}

const LS_PREFIX = "lumen.panel.";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function applySaved(spec: PanelSpec): void {
  const raw = localStorage.getItem(LS_PREFIX + spec.storageKey);
  if (raw === null) return;
  const val = Number(raw);
  if (!Number.isFinite(val)) return;
  const size = clamp(val, spec.min, spec.max);
  if (spec.axis === "x") spec.el.style.width = `${size}px`;
  else spec.el.style.height = `${size}px`;
}

/**
 * Activa el redimensionado. Debe llamarse una vez que el shell del editor está
 * en el DOM. Devuelve una función de limpieza (quita los listeners globales).
 */
export function setupResizers(root: HTMLElement, onResize?: () => void): () => void {
  const library = root.querySelector<HTMLElement>(".library");
  const inspector = root.querySelector<HTMLElement>(".inspector");
  const timeline = root.querySelector<HTMLElement>(".timeline-region");

  const specs: Record<string, PanelSpec> = {};
  if (library) specs.library = { el: library, axis: "x", min: 200, max: 520, invert: false, storageKey: "library" };
  if (inspector) specs.inspector = { el: inspector, axis: "x", min: 220, max: 560, invert: true, storageKey: "inspector" };
  if (timeline) specs.timeline = { el: timeline, axis: "y", min: 160, max: 640, invert: true, storageKey: "timeline" };

  // aplica los tamaños guardados al cargar
  for (const key of Object.keys(specs)) applySaved(specs[key]);
  onResize?.();

  const cleanups: Array<() => void> = [];

  root.querySelectorAll<HTMLElement>(".gutter").forEach((gutter) => {
    const key = gutter.dataset.gutter;
    if (!key) return;
    const spec = specs[key];
    if (!spec) return;

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      gutter.setPointerCapture(e.pointerId);
      gutter.classList.add("dragging");
      document.body.classList.add("resizing");
      const startPos = spec.axis === "x" ? e.clientX : e.clientY;
      const rect = spec.el.getBoundingClientRect();
      const startSize = spec.axis === "x" ? rect.width : rect.height;

      const move = (ev: PointerEvent) => {
        const now = spec.axis === "x" ? ev.clientX : ev.clientY;
        let delta = now - startPos;
        if (spec.invert) delta = -delta;
        const size = clamp(startSize + delta, spec.min, spec.max);
        if (spec.axis === "x") spec.el.style.width = `${size}px`;
        else spec.el.style.height = `${size}px`;
        onResize?.();
      };
      const up = (ev: PointerEvent) => {
        gutter.releasePointerCapture(ev.pointerId);
        gutter.classList.remove("dragging");
        document.body.classList.remove("resizing");
        gutter.removeEventListener("pointermove", move);
        gutter.removeEventListener("pointerup", up);
        // persiste el tamaño final
        const rect2 = spec.el.getBoundingClientRect();
        const final = spec.axis === "x" ? rect2.width : rect2.height;
        localStorage.setItem(LS_PREFIX + spec.storageKey, String(Math.round(final)));
        onResize?.();
      };
      gutter.addEventListener("pointermove", move);
      gutter.addEventListener("pointerup", up);
    };

    gutter.addEventListener("pointerdown", onPointerDown);
    cleanups.push(() => gutter.removeEventListener("pointerdown", onPointerDown));

    // doble clic en el gutter: restablece al tamaño por defecto
    const onDblClick = () => {
      localStorage.removeItem(LS_PREFIX + spec.storageKey);
      spec.el.style.removeProperty(spec.axis === "x" ? "width" : "height");
      onResize?.();
    };
    gutter.addEventListener("dblclick", onDblClick);
    cleanups.push(() => gutter.removeEventListener("dblclick", onDblClick));
  });

  return () => cleanups.forEach((fn) => fn());
}
