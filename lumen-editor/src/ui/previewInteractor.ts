import { commands, type EditorStore } from "../state/store";
import { evaluate } from "../model/animated";

interface PreviewInteractorOpts {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  store: EditorStore;
  /** Devuelve el id del clip seleccionado (o null). */
  selectedClipId: () => string | null;
  /** Tamaño del proyecto (lienzo) en píxeles. */
  projectSize: () => { width: number; height: number };
  /** Tick actual del playhead (para evaluar la posición animada). */
  currentTick: () => number;
  /** Refresca el visor sin reconstruir la timeline (edición en vivo). */
  onLiveEdit: () => void;
}

/**
 * Permite manipular el título seleccionado directamente sobre el visor: arrastrar
 * el cuerpo lo mueve, los tiradores de las esquinas lo escalan y el tirador
 * superior lo rota. Como el lienzo lo pinta un worker (OffscreenCanvas) y no se
 * puede inspeccionar, se superpone una capa transparente alineada con el
 * rectángulo real del canvas; cada gesto traduce el movimiento de pantalla a las
 * propiedades de transform del clip.
 */
export class PreviewInteractor {
  private opts: PreviewInteractorOpts;
  private box!: HTMLElement; // recuadro de selección con los tiradores

  constructor(opts: PreviewInteractorOpts) {
    this.opts = opts;
    this.buildHandles();
    this.attach();
  }

  /** Construye el recuadro y los tiradores (esquinas + rotación) una sola vez. */
  private buildHandles(): void {
    const ov = this.opts.overlay;
    ov.innerHTML = `
      <div class="pv-box">
        <div class="pv-rot" data-h="rot"></div>
        <div class="pv-handle tl" data-h="tl"></div>
        <div class="pv-handle tr" data-h="tr"></div>
        <div class="pv-handle bl" data-h="bl"></div>
        <div class="pv-handle br" data-h="br"></div>
      </div>`;
    this.box = ov.querySelector(".pv-box") as HTMLElement;
  }

  /**
   * Reposiciona y dimensiona la capa para que cubra exactamente el clip de texto
   * seleccionado. Si no hay clip de texto seleccionado, la oculta.
   */
  update(): void {
    const { canvas, overlay, store, selectedClipId } = this.opts;
    const id = selectedClipId();
    const state = id ? store.getState() : null;
    const clip = id && state ? state.clips[id] : null;
    // se muestran tiradores para títulos y para clips visuales: vídeo e imagen
    // (no audio). Vídeo e imagen comparten el mismo modelo de transform.
    const assetKind = clip && !clip.text ? state?.assets[clip.assetId]?.kind : undefined;
    const isVisual = !!clip && !clip.text && (assetKind === "video" || assetKind === "image");
    const isText = !!clip && !!clip.text;
    if (!clip || canvas.hidden || (!isText && !isVisual)) {
      overlay.classList.remove("active");
      return;
    }

    const proj = this.opts.projectSize();
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = overlay.parentElement!.getBoundingClientRect();
    const sx = canvasRect.width / proj.width;
    const sy = canvasRect.height / proj.height;

    const tick = this.opts.currentTick();
    const local = tick - clip.startTick;
    const cx = evaluate(clip.transform.x, local);
    const cy = evaluate(clip.transform.y, local);
    const scale = evaluate(clip.transform.scaleX, local);
    const rot = evaluate(clip.transform.rotation, local);

    // caja del recuadro: para texto se ajusta al texto; para vídeo es el lienzo
    // completo escalado (el clip cubre el frame y se escala respecto a su centro).
    let boxW: number;
    let boxH: number;
    if (isText && clip.text) {
      const fs = clip.text.fontSizePx * scale;
      boxW = Math.min(proj.width * 0.9, Math.max(proj.width * 0.4, clip.text.text.length * fs * 0.55));
      boxH = fs * 1.6 * (clip.text.text.split("\n").length);
    } else if (assetKind === "image") {
      // la imagen se ajusta al lienzo manteniendo proporción (igual que el
      // compositor): el recuadro abraza el contenido real, no todo el lienzo.
      const asset = state?.assets[clip.assetId];
      const iw = asset?.width ?? proj.width;
      const ih = asset?.height ?? proj.height;
      const baseScale = Math.min(proj.width / iw, proj.height / ih);
      boxW = iw * baseScale * scale;
      boxH = ih * baseScale * scale;
    } else {
      boxW = proj.width * scale;
      boxH = proj.height * scale;
    }

    const canvasOffsetX = canvasRect.left - parentRect.left;
    const canvasOffsetY = canvasRect.top - parentRect.top;
    const centerX = canvasOffsetX + (proj.width / 2 + cx) * sx;
    const centerY = canvasOffsetY + (proj.height / 2 + cy) * sy;

    overlay.style.width = `${boxW * sx}px`;
    overlay.style.height = `${boxH * sy}px`;
    overlay.style.left = `${centerX - (boxW * sx) / 2}px`;
    overlay.style.top = `${centerY - (boxH * sy) / 2}px`;
    // rota el recuadro para acompañar la rotación del clip
    this.box.style.transform = `rotate(${rot}deg)`;
    overlay.classList.add("active");
  }

  private attach(): void {
    const { overlay, store, selectedClipId } = this.opts;

    overlay.addEventListener("pointerdown", (e) => {
      const id = selectedClipId();
      const state = id ? store.getState() : null;
      const clip = id && state ? state.clips[id] : null;
      // permite manipular títulos y clips visuales (vídeo e imagen, no audio)
      const ak = clip && !clip.text ? state?.assets[clip.assetId]?.kind : undefined;
      const isVisual = !!clip && !clip.text && (ak === "video" || ak === "image");
      if (!clip || (!clip.text && !isVisual)) return;
      e.preventDefault();
      e.stopPropagation();

      const handle = (e.target as HTMLElement).dataset.h; // tl/tr/bl/br/rot, o undefined = mover
      overlay.setPointerCapture(e.pointerId);

      const proj = this.opts.projectSize();
      const canvasRect = this.opts.canvas.getBoundingClientRect();
      const sx = proj.width / canvasRect.width; // pantalla → proyecto
      const sy = proj.height / canvasRect.height;
      const startX = e.clientX;
      const startY = e.clientY;
      const tick = this.opts.currentTick();
      const local = tick - clip.startTick;
      const origX = evaluate(clip.transform.x, local);
      const origY = evaluate(clip.transform.y, local);
      const origScale = evaluate(clip.transform.scaleX, local);
      const origRot = evaluate(clip.transform.rotation, local);

      // centro del título en pantalla (para escala/rotación relativas al centro)
      const overlayRect = overlay.getBoundingClientRect();
      const cxScreen = overlayRect.left + overlayRect.width / 2;
      const cyScreen = overlayRect.top + overlayRect.height / 2;
      const startDist = Math.hypot(startX - cxScreen, startY - cyScreen) || 1;
      const startAngle = Math.atan2(startY - cyScreen, startX - cxScreen);

      const move = (ev: PointerEvent) => {
        if (handle === "rot") {
          const ang = Math.atan2(ev.clientY - cyScreen, ev.clientX - cxScreen);
          let deg = origRot + ((ang - startAngle) * 180) / Math.PI;
          deg = Math.max(-180, Math.min(180, Math.round(deg)));
          store.dispatch(commands.setClipRotation(clip.id, deg));
        } else if (handle === "tl" || handle === "tr" || handle === "bl" || handle === "br") {
          const dist = Math.hypot(ev.clientX - cxScreen, ev.clientY - cyScreen);
          const ns = Math.max(0.1, Math.min(3, (origScale * dist) / startDist));
          store.dispatch(commands.setClipScale(clip.id, ns));
        } else {
          // mover
          const nx = Math.round(origX + (ev.clientX - startX) * sx);
          const ny = Math.round(origY + (ev.clientY - startY) * sy);
          store.dispatch(commands.setClipPosition(clip.id, nx, ny));
        }
        this.opts.onLiveEdit();
        this.update();
      };
      const up = () => {
        overlay.removeEventListener("pointermove", move);
        overlay.removeEventListener("pointerup", up);
      };
      overlay.addEventListener("pointermove", move);
      overlay.addEventListener("pointerup", up);
    });
  }
}
