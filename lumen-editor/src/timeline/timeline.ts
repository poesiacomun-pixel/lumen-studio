import { TICKS_PER_SECOND } from "../model/time";
import { commands, type EditorStore } from "../state/store";
import { clipDuration } from "../model/types";
import type { Clip, Asset, Easing } from "../model/types";
import { getPeaks, slicePeaks } from "../media/peaks";
import { readFromOPFS } from "../storage/opfs";
import { icons } from "../ui/icons";
import { effectById } from "../model/videoEffects";
import { SUBTITLE_PRESETS } from "../captions/subtitlePresets";
import { transitionLabelOf } from "../model/transitions";
import type { PlaybackController } from "../media/playback";

interface TimelineOpts {
  container: HTMLElement;
  store: EditorStore;
  controller: PlaybackController;
  onEdit: () => void; // se llama tras cualquier edición que cambie los clips
  onSelect?: (clipId: string | null) => void; // se llama al seleccionar un clip
  onSelectCaption?: (captionId: string | null) => void; // al seleccionar un subtítulo
  onSelectTransition?: (transitionId: string | null) => void; // al seleccionar una transición
}

type DragMode = "move" | "left" | "right";

/**
 * Línea de tiempo interactiva sobre el modelo: dibuja pistas y clips, y traduce
 * gestos (arrastrar, recortar por los bordes, dividir, eliminar) a comandos del
 * store. No conoce de decodificación; solo edita el modelo y avisa con onEdit.
 */
export class Timeline {
  private container: HTMLElement;
  private store: EditorStore;
  private controller: PlaybackController;
  private onEdit: () => void;
  private onSelect: (clipId: string | null) => void;
  private onSelectCaption: (captionId: string | null) => void;
  private onSelectTransition: (transitionId: string | null) => void;

  private pxPerSec = 80;
  private static readonly RAIL_W = 132; // ancho del riel fijo de controles (px)
  private selectedClipId: string | null = null;
  private selectedCaptionId: string | null = null;
  private subtitleLanePainted = false; // controla dónde se intercala la pista de subtítulos
  private imageThumbUrls = new Map<string, string>(); // objectURL de miniatura por asset de imagen
  private scroller!: HTMLElement;
  private lanes!: HTMLElement;
  private playhead!: HTMLElement;

  constructor(opts: TimelineOpts) {
    this.container = opts.container;
    this.store = opts.store;
    this.controller = opts.controller;
    this.onEdit = opts.onEdit;
    this.onSelect = opts.onSelect ?? (() => {});
    this.onSelectCaption = opts.onSelectCaption ?? (() => {});
    this.onSelectTransition = opts.onSelectTransition ?? (() => {});
    this.build();
  }

  /** Posición X (px) de un tick en la timeline, contando el riel de la izquierda. */
  private tickToPx(t: number): number {
    return (t / TICKS_PER_SECOND) * this.pxPerSec + Timeline.RAIL_W;
  }
  /** Ancho (px) de una DURACIÓN en ticks (sin el offset del riel). */
  private tickToWidth(dur: number): number {
    return (dur / TICKS_PER_SECOND) * this.pxPerSec;
  }
  private pxToTick(px: number): number {
    return Math.round(((px - Timeline.RAIL_W) / this.pxPerSec) * TICKS_PER_SECOND);
  }
  /** Convierte una DISTANCIA en px a ticks (sin offset del riel). Para deltas de arrastre y snapping. */
  private pxToTickDelta(px: number): number {
    return Math.round((px / this.pxPerSec) * TICKS_PER_SECOND);
  }

  /**
   * Aplica un factor de zoom. Si se da `anchorTick` y `screenX` (px desde el
   * borde izquierdo del scroller), mantiene ese tick bajo ese punto de pantalla
   * tras el zoom, de modo que se acerca/aleja "hacia el cursor".
   */
  private zoomBy(factor: number, anchorTick?: number, screenX?: number): void {
    const prev = this.pxPerSec;
    this.pxPerSec = Math.max(10, Math.min(400, prev * factor));
    this.render();
    if (anchorTick !== undefined && screenX !== undefined) {
      // nueva posición en px del tick anclado, menos su offset en pantalla
      this.scroller.scrollLeft = this.tickToPx(anchorTick) - screenX;
    }
  }

  private injectStyles(): void {
    if (document.getElementById("tl-styles")) return;
    const css = `
      .tl-toolbar {
        height: 40px; flex: none; display: flex; align-items: center; justify-content: space-between;
        padding: 0 12px; border-bottom: 1px solid var(--line-soft); gap: 8px;
      }
      .tl-tools, .tl-zoom { display: flex; align-items: center; gap: 4px; }
      .tl-tbtn-tool {
        display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 9px;
        border: 1px solid transparent; border-radius: 7px; background: transparent;
        color: var(--tx-70); font-size: 11.5px; font-weight: 500; cursor: pointer;
        transition: background 0.12s, color 0.12s;
      }
      .tl-tbtn-tool:hover { background: var(--fill-05); color: var(--tx); }
      .tl-tbtn-tool span { line-height: 1; }
      .tl-sep { width: 1px; height: 18px; background: var(--fill-08); margin: 0 4px; }

      .tl-scroller {
        position: relative; flex: 1; min-height: 0; overflow: auto;
        background: var(--bg-timeline);
      }
      .tl-ruler {
        position: sticky; top: 0; z-index: 4; height: 26px;
        border-bottom: 1px solid var(--line-soft); min-width: 100%;
        background: var(--bg-timeline);
      }
      .tl-ruler-corner {
        position: sticky; left: 0; z-index: 6; display: block; float: left;
        width: 132px; height: 26px; background: var(--bg-timeline);
        border-right: 1px solid var(--line);
      }
      .tl-mark {
        position: absolute; top: 6px; font-size: 9.5px; color: var(--tx-34);
        font-variant-numeric: tabular-nums; transform: translateX(3px); white-space: nowrap;
      }
      .tl-mark::before {
        content: ""; position: absolute; left: 0; top: -6px; width: 1px; height: 5px;
        background: var(--fill-10);
      }
      .tl-lanes { min-width: 100%; padding-top: 4px; cursor: grab; }
      .tl-lanes.panning { cursor: grabbing; }
      .tl-lane {
        position: relative; height: 56px; margin: 4px 0; display: flex; align-items: stretch;
        border-bottom: 1px solid var(--line-soft);
      }
      .tl-lane.audio { height: 46px; }
      .tl-lane.texttrack { height: 38px; }
      .tl-lane.imagetrack { height: 46px; }
      .tl-lane.subtrack { height: 34px; }
      .tl-clip.sub {
        background: #2a2832; border-color: rgba(163, 154, 196, 0.28);
        color: var(--accent-violet); top: 4px; bottom: 4px;
      }
      .tl-sub-edit {
        position: absolute; inset: 2px 6px; z-index: 10; border: 1px solid var(--accent);
        border-radius: 3px; background: #151517; color: var(--tx-90);
        font-family: inherit; font-size: 11.5px; padding: 0 4px; outline: none;
      }
      .tl-lane.drop { background: rgba(111, 182, 171, 0.12); box-shadow: inset 0 0 0 1.5px var(--accent); border-radius: 6px; }
      .tl-kf {
        position: absolute; bottom: 2px; width: 8px; height: 8px;
        transform: translateX(-50%) rotate(45deg); transform-origin: center;
        background: var(--accent-bright); border: 1px solid rgba(0,0,0,0.4);
        cursor: pointer; z-index: 5;
      }
      .tl-kf:hover { background: #fff; }
      .tl-kf.drag { background: #fff; transform: translateX(-50%) rotate(45deg) scale(1.3); z-index: 6; }

      .tl-kf-menu {
        position: fixed; z-index: 1000; min-width: 140px; padding: 4px;
        background: var(--bg-elev, #232329); border: 1px solid var(--line, rgba(255,255,255,0.1));
        border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,0.5);
        display: flex; flex-direction: column; gap: 1px;
      }
      .tl-kf-menu-h {
        font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase;
        color: var(--tx-45, rgba(232,230,224,0.45)); padding: 5px 9px 3px;
      }
      .tl-kf-menu-item {
        text-align: left; padding: 6px 9px; border: none; background: none;
        color: var(--tx-90, #E8E6E0); font-family: inherit; font-size: 12.5px;
        border-radius: 5px; cursor: pointer;
      }
      .tl-kf-menu-item:hover { background: var(--fill-10, rgba(255,255,255,0.07)); }
      .tl-kf-menu-item.on { color: var(--accent-bright, #7FC6BA); }
      .tl-kf-menu-item.del { color: #d98b8b; margin-top: 2px; border-top: 1px solid var(--line, rgba(255,255,255,0.08)); border-radius: 0 0 5px 5px; }
      .tl-tr-menu { max-height: 60vh; overflow-y: auto; min-width: 168px; }
      .tl-tr-menu .tl-kf-menu-h:first-child { padding-top: 2px; }

      .tl-clip {
        position: absolute; top: 5px; bottom: 5px; box-sizing: border-box;
        border-radius: 5px; overflow: hidden; cursor: grab;
        display: flex; align-items: stretch; user-select: none; touch-action: none;
        background: linear-gradient(165deg, #2f4a4d, #243036);
        border: 1px solid rgba(255, 255, 255, 0.07);
      }
      .tl-clip.audio { background: #28332f; border-color: rgba(169, 189, 183, 0.22); color: var(--accent-sage); }
      .tl-clip.text { background: #322d40; border-color: rgba(163, 154, 196, 0.32); color: var(--accent-violet); }
      .tl-clip.image { border-color: rgba(127, 198, 186, 0.4); color: #fff; }
      .tl-clip.image .tl-label { background: linear-gradient(180deg, rgba(0,0,0,0.6), transparent); text-shadow: 0 1px 2px rgba(0,0,0,0.7); }
      .tl-clip.image .tl-ticon { filter: drop-shadow(0 1px 1px rgba(0,0,0,0.8)); }
      .tl-ticon { display: inline-flex; align-items: center; margin: 0 3px; opacity: 0.9; flex: 0 0 auto; }
      .tl-clip.audio.music { background: #2c2937; border-color: rgba(163, 154, 196, 0.22); color: var(--accent-violet); }
      .tl-clip.muted { opacity: 0.5; }
      .tl-clip.sel { border-color: var(--accent); box-shadow: 0 0 0 1.5px var(--accent), 0 0 0 4px rgba(111, 182, 171, 0.16); }

      .tl-label {
        position: absolute; left: 0; right: 0; top: 0; padding: 2px 8px; z-index: 2;
        font-size: 9.5px; color: rgba(255, 255, 255, 0.86); pointer-events: none;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.4), transparent);
      }
      .tl-clip.audio .tl-label { background: none; color: currentColor; opacity: 0.85; }

      .tl-fx {
        position: absolute; right: 10px; bottom: 4px; z-index: 4;
        display: inline-flex; align-items: center; gap: 3px; max-width: calc(100% - 22px);
        padding: 1px 6px 1px 4px; border-radius: 999px; cursor: pointer;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(20, 18, 28, 0.66); color: #e9def7;
        font-size: 9px; line-height: 1.4; backdrop-filter: blur(2px);
        transition: background 0.12s, border-color 0.12s, transform 0.12s;
      }
      .tl-fx:hover { background: rgba(120, 60, 60, 0.82); border-color: rgba(255, 150, 150, 0.55); color: #ffe2e2; }
      .tl-fx:hover .tl-fx-name { display: none; }
      .tl-fx:hover::after { content: "Quitar"; font-size: 9px; }
      .tl-fx svg { flex: 0 0 auto; }
      .tl-fx-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .tl-wave {
        position: absolute; inset: 14px 4px 4px; z-index: 1; display: block;
        color: currentColor; opacity: 0.6; pointer-events: none;
      }
      .tl-wave svg { display: block; width: 100%; height: 100%; }

      .tl-h { width: 8px; z-index: 3; cursor: ew-resize; flex: none; align-self: stretch; }
      .tl-hl { margin-right: auto; }
      .tl-hr { margin-left: auto; }
      .tl-clip.sel .tl-h { background: rgba(111, 182, 171, 0.25); }

      .tl-playhead { position: absolute; top: 26px; left: 0; width: 0; z-index: 6; pointer-events: none; }
      .tl-snap {
        position: absolute; top: 0; width: 2px; margin-left: -1px; z-index: 7;
        display: none; pointer-events: none; background: var(--accent-bright, #7FC6BA);
        box-shadow: 0 0 6px rgba(127, 198, 186, 0.7);
      }
      .tl-playhead::before {
        content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 1.5px;
        background: var(--accent); transform: translateX(-50%);
        box-shadow: 0 0 8px rgba(111, 182, 171, 0.4);
      }
      .tl-playhead::after {
        content: ""; position: absolute; top: -26px; left: 0; transform: translateX(-50%);
        width: 11px; height: 13px; background: var(--accent); border-radius: 2px 2px 0 0;
        clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
      }

      .tl-track-ctrls {
        position: sticky; left: 0; z-index: 8; box-sizing: border-box;
        width: 132px; height: 100%; flex: 0 0 132px;
        display: flex; align-items: center; gap: 5px;
        background: var(--bg-timeline, #191a1d); padding: 0 8px;
        border-right: 1px solid var(--line); margin: 0;
      }
      .tl-track-name { font-size: 10.5px; color: var(--tx-70); flex: 1 1 auto; min-width: 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tl-tbtn {
        width: 18px; height: 18px; padding: 0; font-size: 10px; font-weight: 700; flex: 0 0 auto;
        display: inline-flex; align-items: center; justify-content: center;
        background: var(--bg-elev); color: var(--tx-55); border: 1px solid var(--line);
        border-radius: 5px; cursor: pointer; line-height: 1;
      }
      .tl-tbtn:hover { color: var(--tx); border-color: var(--fill-14, rgba(255,255,255,0.14)); }
      .tl-tbtn.on { background: var(--accent); color: #14201d; border-color: var(--accent); }
      .tl-tbtn-del:hover { background: rgba(150,60,60,0.85); border-color: rgba(255,150,150,0.55); color: #ffe2e2; }
      .tl-tvol { width: 100%; flex: 1 1 40px; min-width: 30px; accent-color: var(--accent); }
      .tl-lane.dimmed .tl-clip { opacity: 0.5; }
      .tl-transition {
        position: absolute; top: 50%; transform: translateY(-50%); z-index: 4;
        height: 20px; min-width: 18px; display: flex; align-items: center; justify-content: center;
        background: linear-gradient(180deg, rgba(127,198,186,0.9), rgba(111,182,171,0.7));
        border: 1px solid rgba(180,230,220,0.9); border-radius: 6px; color: #14201d;
        cursor: pointer; pointer-events: auto; box-shadow: 0 1px 6px rgba(111,182,171,0.4);
        transition: filter 0.12s, transform 0.12s;
      }
      .tl-transition:hover { filter: brightness(1.12); transform: translateY(-50%) scale(1.08); }`;
    const style = document.createElement("style");
    style.id = "tl-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  private build(): void {
    this.injectStyles();
    this.container.innerHTML = `
      <div class="tl-toolbar">
        <div class="tl-tools">
          <button class="tl-tbtn-tool" data-act="split" title="Dividir en el cursor">${icons.scissors(14)}<span>Dividir</span></button>
          <button class="tl-tbtn-tool" data-act="delete" title="Eliminar selección">${icons.trash(14)}</button>
          <button class="tl-tbtn-tool" data-act="detach" title="Separar audio">${icons.detach(14)}</button>
          <button class="tl-tbtn-tool" data-act="transition" title="Transición con el clip siguiente">${icons.transition(14)}</button>
        </div>
        <div class="tl-zoom">
          <button class="tl-tbtn-tool" data-act="zoomout" title="Alejar">${icons.zoomOut(14)}</button>
          <button class="tl-tbtn-tool" data-act="zoomin" title="Acercar">${icons.zoomIn(14)}</button>
        </div>
      </div>
      <div class="tl-scroller">
        <div class="tl-ruler"></div>
        <div class="tl-lanes"></div>
        <div class="tl-playhead"></div>
      </div>`;

    this.scroller = this.container.querySelector(".tl-scroller")!;
    this.lanes = this.container.querySelector(".tl-lanes")!;
    this.playhead = this.container.querySelector(".tl-playhead")!;

    const act = (name: string, fn: () => void) =>
      this.container.querySelector(`[data-act="${name}"]`)!.addEventListener("click", fn);
    act("split", () => this.split());
    act("delete", () => this.deleteSelected());
    act("detach", () => this.detachSelectedAudio());
    act("transition", () => this.toggleTransition());
    act("zoomin", () => this.zoomBy(1.25));
    act("zoomout", () => this.zoomBy(1 / 1.25));

    // zoom con la rueda del ratón (centrado en el cursor)
    this.scroller.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        // rueda con Ctrl/⌘ = zoom; rueda normal = scroll horizontal
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const rect = this.scroller.getBoundingClientRect();
          const anchorPx = e.clientX - rect.left + this.scroller.scrollLeft;
          const anchorTick = this.pxToTick(anchorPx);
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          this.zoomBy(factor, anchorTick, e.clientX - rect.left);
        } else if (e.shiftKey || e.deltaX !== 0) {
          // shift+rueda o trackpad horizontal: desplaza la timeline
          e.preventDefault();
          this.scroller.scrollLeft += e.deltaX || e.deltaY;
        }
      },
      { passive: false },
    );

    // arrastrar el fondo de las pistas para desplazar (pan) la timeline
    this.lanes.addEventListener("pointerdown", (e) => {
      // solo si se hace clic en zona vacía: no sobre un clip, un keyframe, ni el
      // riel de controles de la izquierda (si no, el paneo se traga los clics de
      // sus botones, como la papelera de la pista).
      const target = e.target as HTMLElement;
      if (target.closest(".tl-clip") || target.closest(".tl-kf") || target.closest(".tl-track-ctrls") || target.closest(".tl-transition")) return;
      this.scroller.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startScroll = this.scroller.scrollLeft;
      let panning = false;
      const mv = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - startX) > 3) panning = true;
        if (panning) this.scroller.scrollLeft = startScroll - (ev.clientX - startX);
      };
      const up = () => {
        this.scroller.releasePointerCapture(e.pointerId);
        this.scroller.removeEventListener("pointermove", mv);
        this.scroller.removeEventListener("pointerup", up);
        this.lanes.classList.remove("panning");
      };
      this.lanes.classList.add("panning");
      this.scroller.addEventListener("pointermove", mv);
      this.scroller.addEventListener("pointerup", up);
    });

    // seek arrastrando sobre la regla
    const ruler = this.container.querySelector(".tl-ruler") as HTMLElement;
    const seekFrom = (e: PointerEvent) => {
      const rect = this.scroller.getBoundingClientRect();
      const x = e.clientX - rect.left + this.scroller.scrollLeft;
      void this.controller.seek(Math.max(0, this.pxToTick(x)));
    };
    ruler.addEventListener("pointerdown", (e) => {
      ruler.setPointerCapture(e.pointerId);
      seekFrom(e);
      const mv = (ev: PointerEvent) => seekFrom(ev);
      const up = () => {
        ruler.removeEventListener("pointermove", mv);
        ruler.removeEventListener("pointerup", up);
      };
      ruler.addEventListener("pointermove", mv);
      ruler.addEventListener("pointerup", up);
    });
  }

  render(): void {
    const st = this.store.getState();
    const totalSec = Math.max(5, Math.ceil(st.project.durationTick / TICKS_PER_SECOND) + 2);
    const width = totalSec * this.pxPerSec + Timeline.RAIL_W;

    const ruler = this.container.querySelector(".tl-ruler") as HTMLElement;
    ruler.style.width = `${width}px`;
    this.lanes.style.width = `${width}px`;

    // intervalo de marcas adaptativo: ~70px mínimo entre etiquetas
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = candidates.find((c) => c * this.pxPerSec >= 70) ?? 300;
    let marks = "";
    for (let s = 0; s <= totalSec; s += step) {
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      marks += `<span class="tl-mark" style="left:${s * this.pxPerSec + Timeline.RAIL_W}px">${mm}:${ss}</span>`;
    }
    ruler.innerHTML = `<span class="tl-ruler-corner"></span>` + marks;

    this.lanes.innerHTML = "";
    // libera miniaturas de imágenes que ya no existen (evita fugas de objectURL)
    for (const [assetId, url] of this.imageThumbUrls) {
      if (!st.assets[assetId]) {
        URL.revokeObjectURL(url);
        this.imageThumbUrls.delete(assetId);
      }
    }
    this.subtitleLanePainted = false;
    const soloActive = Object.values(st.tracks).some(
      (t) => t.kind === "audio" && t.solo,
    );

    // orden visual fijo de las pistas: vídeo arriba, luego audio, y los títulos
    // abajo del todo. La pista de subtítulos se intercala justo antes de títulos.
    const kindOrder: Record<string, number> = { video: 0, image: 1, audio: 2, text: 4 };
    const orderedTrackIds = [...st.project.trackIds].sort((a, b) => {
      const ka = kindOrder[st.tracks[a]?.kind] ?? 2;
      const kb = kindOrder[st.tracks[b]?.kind] ?? 2;
      if (ka !== kb) return ka - kb;
      // dentro del mismo tipo, conserva el orden de creación
      return st.project.trackIds.indexOf(a) - st.project.trackIds.indexOf(b);
    });

    for (const trackId of orderedTrackIds) {
      const track = st.tracks[trackId];
      // no mostramos pistas vacías, salvo las que el usuario creó a propósito con
      // el botón (placeholders): una pista normal solo aparece cuando tiene
      // Solo se muestran las pistas CON contenido. Una pista vacía (p.ej. tras
      // eliminar su contenido, o una de audio que quedó sin clips) no se pinta.
      if (track.clipIds.length === 0) continue;
      // la pista de subtítulos va justo ANTES de la primera pista de títulos
      if (track.kind === "text" && !this.subtitleLanePainted) {
        this.paintSubtitleTrack();
        this.subtitleLanePainted = true;
      }
      const lane = document.createElement("div");
      lane.className = "tl-lane" +
        (track.kind === "audio" ? " audio" : "") +
        (track.kind === "text" ? " texttrack" : "") +
        (track.kind === "image" ? " imagetrack" : "");
      lane.dataset.track = trackId;

      // Riel de controles (todas las pistas): nombre + eliminar contenido.
      // Audio además: mute, solo y volumen.
      {
        const ctrls = document.createElement("div");
        ctrls.className = "tl-track-ctrls";
        const dim = track.kind === "audio" && soloActive && !track.solo && !track.muted;
        let inner = `<span class="tl-track-name">${track.name}</span>`;
        if (track.kind === "audio") {
          inner +=
            `<button class="tl-tbtn${track.muted ? " on" : ""}" data-tk="mute" title="Silenciar">M</button>` +
            `<button class="tl-tbtn${track.solo ? " on" : ""}" data-tk="solo" title="Solo">S</button>`;
        }
        inner += `<button class="tl-tbtn tl-tbtn-del" data-tk="removetrack" title="Eliminar esta pista">${icons.trash(12)}</button>`;
        ctrls.innerHTML = inner;
        if (dim) lane.classList.add("dimmed");
        // el riel no debe iniciar el paneo de la timeline ni la selección
        ctrls.addEventListener("pointerdown", (e) => e.stopPropagation());

        ctrls.querySelector('[data-tk="removetrack"]')!.addEventListener("click", (e) => {
          e.stopPropagation();
          const n = track.clipIds.length;
          const msg = n > 0
            ? `¿Eliminar la pista «${track.name}» y sus ${n} ${n === 1 ? "elemento" : "elementos"}? Puedes deshacerlo con Ctrl+Z.`
            : `¿Eliminar la pista «${track.name}»? Puedes deshacerlo con Ctrl+Z.`;
          if (!confirm(msg)) return;
          this.store.dispatch(commands.removeTrack(trackId));
          this.onEdit();
          this.render();
        });

        if (track.kind === "audio") {
          ctrls.querySelector('[data-tk="mute"]')!.addEventListener("click", (e) => {
            e.stopPropagation();
            this.store.dispatch(commands.setTrackMuted(trackId, !track.muted));
            this.onEdit();
            this.render();
          });
          ctrls.querySelector('[data-tk="solo"]')!.addEventListener("click", (e) => {
            e.stopPropagation();
            this.store.dispatch(commands.setTrackSolo(trackId, !track.solo));
            this.onEdit();
            this.render();
          });
          const vol = document.createElement("input");
          vol.className = "tl-tvol";
          vol.type = "range"; vol.min = "0"; vol.max = "2"; vol.step = "0.01";
          vol.value = String(track.volume);
          vol.title = "Volumen de pista";
          vol.addEventListener("input", () => {
            this.controller.setTrackVolumeLive(trackId, Number(vol.value));
          });
          vol.addEventListener("change", () => {
            this.store.dispatch(commands.setTrackVolume(trackId, Number(vol.value)));
            this.onEdit();
          });
          vol.addEventListener("pointerdown", (ev) => ev.stopPropagation());
          ctrls.appendChild(vol);
        }
        lane.appendChild(ctrls);
      }

      for (const clipId of track.clipIds) {
        const clip = st.clips[clipId];
        if (!clip) continue;
        const asset = st.assets[clip.assetId];
        const isText = !!clip.text;
        const isAudio = !isText && (track.kind === "audio" || asset?.kind === "audio");
        const isMusic = isAudio && asset?.kind === "audio";
        const isImage = !isText && asset?.kind === "image";
        const el = document.createElement("div");
        el.className =
          "tl-clip" +
          (isAudio ? " audio" : "") +
          (isMusic ? " music" : "") +
          (isText ? " text" : "") +
          (isImage ? " image" : "") +
          (clip.muted ? " muted" : "") +
          (clipId === this.selectedClipId ? " sel" : "");
        el.style.left = `${this.tickToPx(clip.startTick)}px`;
        el.style.width = `${this.tickToWidth(clipDuration(clip))}px`;
        el.dataset.id = clipId;
        const label = isText
          ? (clip.text?.text.split("\n")[0] || "Texto")
          : (asset?.name ?? "clip");
        // Insignia de efecto: solo en clips visuales (vídeo/imagen) y solo si el
        // clip tiene un efecto aplicado. Clic en la insignia = quitar el efecto.
        const isVisual = !isText && !isAudio;
        const fxDef = isVisual && clip.effectId ? effectById(clip.effectId) : undefined;
        const fxBadge = fxDef
          ? `<button class="tl-fx" data-fx="1" title="Efecto: ${fxDef.label} · clic para quitar">${icons.sparkles(10)}<span class="tl-fx-name">${fxDef.label}</span></button>`
          : "";
        el.innerHTML =
          `<span class="tl-h tl-hl"></span>` +
          (isAudio ? `<span class="tl-wave"></span>` : "") +
          (isText ? `<span class="tl-ticon">${icons.text(11)}</span>` : "") +
          (isImage ? `<span class="tl-ticon">${icons.image(11)}</span>` : "") +
          `<span class="tl-label">${label}</span>` +
          fxBadge +
          `<span class="tl-h tl-hr"></span>`;
        if (fxBadge) {
          const btn = el.querySelector('[data-fx="1"]') as HTMLElement;
          btn.addEventListener("pointerdown", (e) => e.stopPropagation());
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.store.dispatch(commands.setClipEffect(clipId, null));
            this.onEdit();
            this.render();
          });
        }
        this.attachClipHandlers(el, clipId);
        lane.appendChild(el);
        if (isAudio && asset) {
          void this.paintWaveform(el, clip, asset);
        }
        if (isImage && asset) {
          void this.paintImageThumb(el, asset);
        }
        // marcadores de keyframes (solo en el clip seleccionado, para no saturar)
        if (clipId === this.selectedClipId) {
          this.paintKeyframes(el, clip);
        }
      }
      // marcadores de transición: en el borde entre el clip "to" y el anterior
      for (const tr of Object.values(st.transitions)) {
        const toClip = st.clips[tr.toClipId];
        if (!toClip || toClip.trackId !== trackId) continue;
        const marker = document.createElement("div");
        marker.className = "tl-transition";
        const px = this.tickToPx(toClip.startTick);
        const w = this.tickToWidth(tr.durationTick);
        marker.style.left = `${px - w / 2}px`;
        marker.style.width = `${Math.max(10, w)}px`;
        marker.dataset.tid = tr.id;
        marker.innerHTML = `<span>${icons.transition(11)}</span>`;
        marker.title = `Transición: ${this.transitionLabel(tr.type)} · clic para configurar`;
        marker.addEventListener("pointerdown", (e) => e.stopPropagation());
        marker.addEventListener("click", (e) => {
          e.stopPropagation();
          this.selectedClipId = null;
          this.selectedCaptionId = null;
          this.onSelectTransition(tr.id);
          this.render();
        });
        lane.appendChild(marker);
      }
      this.lanes.appendChild(lane);
    }
    // si no hubo pista de títulos, la de subtítulos va al final
    if (!this.subtitleLanePainted) this.paintSubtitleTrack();
    this.setPlayhead(this.controller.tick);
  }

  /**
   * Pista de subtítulos estilo CapCut: una fila dedicada donde cada cue es un
   * bloque editable. Doble clic edita el texto; arrastrar el cuerpo lo mueve; los
   * tiradores laterales ajustan inicio/fin; clic derecho lo elimina. Un botón "+"
   * añade un subtítulo en el cabezal.
   */
  private paintSubtitleTrack(): void {
    const st = this.store.getState();
    const cues = Object.values(st.captions).sort((a, b) => a.startTick - b.startTick);
    // Solo se muestra la pista de subtítulos cuando hay subtítulos. Se generan
    // desde el panel lateral "Subtítulos"; aquí solo se editan/eliminan.
    if (cues.length === 0) return;

    const lane = document.createElement("div");
    lane.className = "tl-lane subtrack";
    lane.dataset.subtrack = "1";

    const ctrls = document.createElement("div");
    ctrls.className = "tl-track-ctrls";
    ctrls.addEventListener("pointerdown", (e) => e.stopPropagation());
    ctrls.innerHTML =
      `<span class="tl-track-name">${icons.text(11)} Subt.</span>` +
      `<button class="tl-tbtn" data-sub="add" title="Añadir subtítulo en el cursor">+</button>` +
      `<button class="tl-tbtn" data-sub="format" title="Cambiar el formato de TODOS los subtítulos">${icons.text(11)}</button>` +
      `<button class="tl-tbtn tl-tbtn-del" data-sub="clear" title="Eliminar TODOS los subtítulos">${icons.trash(12)}</button>`;
    ctrls.querySelector('[data-sub="add"]')!.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = this.controller.tick;
      this.store.dispatch(commands.addCaption(t, t + TICKS_PER_SECOND * 2, "Subtítulo"));
      this.onEdit();
      this.render();
    });
    ctrls.querySelector('[data-sub="clear"]')!.addEventListener("click", (e) => {
      e.stopPropagation();
      const n = cues.length;
      if (!confirm(`¿Eliminar los ${n} subtítulos? Puedes deshacerlo con Ctrl+Z.`)) return;
      this.store.dispatch(commands.clearCaptions());
      this.selectedCaptionId = null;
      this.onEdit();
      this.render();
    });
    ctrls.querySelector('[data-sub="format"]')!.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this.showSubtitleFormatMenu(r.left, r.bottom + 4);
    });
    lane.appendChild(ctrls);

    for (const cue of cues) {
      const el = document.createElement("div");
      el.className = "tl-clip sub" + (cue.id === this.selectedCaptionId ? " sel" : "");
      el.dataset.cue = cue.id;
      el.style.left = `${this.tickToPx(cue.startTick)}px`;
      el.style.width = `${this.tickToWidth(Math.max(1, cue.endTick - cue.startTick))}px`;
      el.innerHTML =
        `<span class="tl-h tl-hl"></span>` +
        `<span class="tl-label">${(cue.text.split("\n")[0] || "—").replace(/</g, "&lt;")}</span>` +
        `<span class="tl-h tl-hr"></span>`;
      this.attachCaptionHandlers(el, cue.id);
      lane.appendChild(el);
    }

    this.lanes.appendChild(lane);
  }

  /** Arrastre/edición de un bloque de subtítulo. */
  private attachCaptionHandlers(el: HTMLElement, cueId: string): void {
    const startDrag = (mode: "move" | "left" | "right") => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const cue = this.store.getState().captions[cueId];
      if (!cue) return;
      const startX = e.clientX;
      const origStart = cue.startTick;
      const origEnd = cue.endTick;
      let moved = false;
      el.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const d = this.pxToTickDelta(ev.clientX - startX);
        if (Math.abs(ev.clientX - startX) > 3) moved = true;
        if (mode === "move") {
          const ns = Math.max(0, origStart + d);
          el.style.left = `${this.tickToPx(ns)}px`;
        } else if (mode === "left") {
          const ns = Math.max(0, Math.min(origStart + d, origEnd - 1000));
          el.style.left = `${this.tickToPx(ns)}px`;
          el.style.width = `${this.tickToWidth(origEnd - ns)}px`;
        } else {
          const ne = Math.max(origStart + 1000, origEnd + d);
          el.style.width = `${this.tickToWidth(ne - origStart)}px`;
        }
      };
      const up = (ev: PointerEvent) => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        // sin arrastre: es un clic → selecciona el subtítulo (abre su panel)
        if (!moved && mode === "move") {
          this.selectCaption(cueId);
          return;
        }
        const d = this.pxToTickDelta(ev.clientX - startX);
        if (mode === "move") {
          const ns = Math.max(0, origStart + d);
          this.store.dispatch(commands.updateCaption(cueId, { startTick: ns, endTick: ns + (origEnd - origStart) }));
        } else if (mode === "left") {
          const ns = Math.max(0, Math.min(origStart + d, origEnd - 1000));
          this.store.dispatch(commands.updateCaption(cueId, { startTick: ns }));
        } else {
          const ne = Math.max(origStart + 1000, origEnd + d);
          this.store.dispatch(commands.updateCaption(cueId, { endTick: ne }));
        }
        this.onEdit();
        this.render();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    };

    el.addEventListener("pointerdown", startDrag("move"));
    (el.querySelector(".tl-hl") as HTMLElement).addEventListener("pointerdown", startDrag("left"));
    (el.querySelector(".tl-hr") as HTMLElement).addEventListener("pointerdown", startDrag("right"));

    // doble clic: editar el texto en sitio
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.editCaptionText(el, cueId);
    });
    // clic derecho: eliminar
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.store.dispatch(commands.removeCaption(cueId));
      this.onEdit();
      this.render();
    });
  }

  /** Edición en sitio del texto de un subtítulo (un input sobre el bloque). */
  private editCaptionText(el: HTMLElement, cueId: string): void {
    const cue = this.store.getState().captions[cueId];
    if (!cue) return;
    const input = document.createElement("input");
    input.className = "tl-sub-edit";
    input.value = cue.text;
    el.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim();
      input.remove();
      if (v && v !== cue.text) {
        this.store.dispatch(commands.updateCaption(cueId, { text: v }));
        this.onEdit();
      }
      this.render();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); commit(); }
      if (ev.key === "Escape") { input.value = cue.text; input.blur(); }
    });
    input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  }

  /**
   * Dibuja la waveform de un clip de audio como barras verticales SVG. Carga los
   * picos del asset (async, cacheados) y toma solo el tramo recortado in→out.
   * El estilo sigue el diseño: barras color sage/violeta translúcidas.
   */
  private async paintWaveform(el: HTMLElement, clip: Clip, asset: Asset): Promise<void> {
    const slot = el.querySelector(".tl-wave") as HTMLElement | null;
    if (!slot) return;
    const peaks = await getPeaks(asset.id, asset.opfsPath);
    if (!peaks || asset.durationTick <= 0) return;
    // si el clip cambió/desapareció mientras cargaba, aborta
    if (!el.isConnected) return;

    const widthPx = Math.max(1, Math.round(this.tickToWidth(clipDuration(clip))));
    const barW = 2;
    const gap = 1;
    const n = Math.max(8, Math.floor(widthPx / (barW + gap)));

    const from01 = clip.inTick / asset.durationTick;
    const to01 = clip.outTick / asset.durationTick;
    const vals = slicePeaks(peaks, from01, to01, n);

    const H = 100; // viewBox alto; el contenedor lo escala
    const mid = H / 2;
    let bars = "";
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, vals[i] * (H - 8));
      const x = i * (barW + gap);
      bars += `<rect x="${x}" y="${mid - h / 2}" width="${barW}" height="${h}" rx="1"/>`;
    }
    const totalW = n * (barW + gap);
    slot.innerHTML =
      `<svg viewBox="0 0 ${totalW} ${H}" preserveAspectRatio="none" width="100%" height="100%">` +
      `<g fill="currentColor">${bars}</g></svg>`;
  }

  /**
   * Pinta la miniatura de un clip de imagen como fondo del bloque, para
   * reconocerla de un vistazo en la timeline. El objectURL se cachea por asset
   * (se libera al destruir la timeline no es crítico: el navegador los recoge al
   * recargar; aun así se reutiliza para no crear uno por render).
   */
  private async paintImageThumb(el: HTMLElement, asset: Asset): Promise<void> {
    try {
      let url = this.imageThumbUrls.get(asset.id);
      if (!url) {
        const file = await readFromOPFS(asset.opfsPath);
        url = URL.createObjectURL(file);
        this.imageThumbUrls.set(asset.id, url);
      }
      if (!el.isConnected) return;
      el.style.backgroundImage = `url("${url}")`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
    } catch {
      /* si no se puede leer, el clip queda con su color de fondo normal */
    }
  }

  setPlayhead(tick: number): void {
    const px = this.tickToPx(tick);
    this.playhead.style.left = `${px}px`;
    // la altura del playhead debe cubrir TODO el contenido (ruler + todas las
    // pistas), no solo la parte visible; si no, al hacer scroll vertical la línea
    // "desaparece" en las pistas de abajo. scrollHeight da la altura total.
    this.playhead.style.height = `${this.scroller.scrollHeight}px`;
    if (this.controller.isPlaying) {
      const view = this.scroller;
      if (px < view.scrollLeft + 40 || px > view.scrollLeft + view.clientWidth - 40) {
        view.scrollLeft = px - view.clientWidth / 2;
      }
    }
  }

  private select(id: string | null): void {
    this.selectedClipId = id;
    if (id) this.selectedCaptionId = null;
    this.lanes.querySelectorAll(".tl-clip").forEach((c) => {
      c.classList.toggle("sel", (c as HTMLElement).dataset.id === id);
    });
    this.onSelect(id);
  }

  /** Selecciona un subtítulo: lo resalta y abre su panel en el inspector. */
  private selectCaption(cueId: string | null): void {
    this.selectedCaptionId = cueId;
    this.selectedClipId = null;
    this.lanes.querySelectorAll(".tl-clip").forEach((c) => c.classList.remove("sel"));
    this.lanes.querySelectorAll(".tl-clip.sub").forEach((c) => {
      c.classList.toggle("sel", (c as HTMLElement).dataset.cue === cueId);
    });
    this.onSelect(null);
    this.onSelectCaption(cueId);
  }

  /** Permite al exterior fijar la selección (p.ej. desde el inspector). */
  getSelectedClipId(): string | null {
    return this.selectedClipId;
  }

  private attachClipHandlers(el: HTMLElement, clipId: string): void {
    const startDrag = (mode: DragMode) => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.select(clipId);
      const clip = this.store.getState().clips[clipId];
      if (!clip) return;
      const startX = e.clientX;
      const origStart = clip.startTick;
      const origDur = clipDuration(clip);
      el.setPointerCapture(e.pointerId);

      // para "move": detecta la pista bajo el cursor y resáltala
      let hoverTrackId: string | null = null;
      const updateHover = (clientX: number, clientY: number) => {
        // oculta el clip un instante para que elementFromPoint vea la lane debajo
        const prevPe = el.style.pointerEvents;
        el.style.pointerEvents = "none";
        const target = document.elementFromPoint(clientX, clientY);
        el.style.pointerEvents = prevPe;
        const lane = target?.closest<HTMLElement>(".tl-lane");
        const tid = lane?.dataset.track ?? null;
        if (tid !== hoverTrackId) {
          this.lanes.querySelectorAll(".tl-lane.drop").forEach((l) => l.classList.remove("drop"));
          if (tid && tid !== clip.trackId && this.trackAcceptsClip(tid, clipId)) {
            lane?.classList.add("drop");
            hoverTrackId = tid;
          } else {
            hoverTrackId = tid && tid !== clip.trackId ? null : tid;
          }
        }
      };

      const move = (ev: PointerEvent) => {
        const d = this.pxToTickDelta(ev.clientX - startX);
        if (mode === "move") {
          const raw = Math.max(0, origStart + d);
          const snapped = this.snapClipStart(clipId, raw, origDur);
          el.style.left = `${this.tickToPx(snapped)}px`;
          updateHover(ev.clientX, ev.clientY);
        } else if (mode === "left") {
          // recorta el inicio: el borde izquierdo engancha a puntos cercanos
          const rawStart = Math.max(0, Math.min(origStart + d, origStart + origDur - 1000));
          const ns = Math.min(this.snapEdge(clipId, rawStart), origStart + origDur - 1000);
          el.style.left = `${this.tickToPx(ns)}px`;
          el.style.width = `${this.tickToWidth(origStart + origDur - ns)}px`;
        } else {
          // recorta el fin: el borde derecho engancha a puntos cercanos
          const rawEnd = Math.max(origStart + 1000, origStart + origDur + d);
          const ne = Math.max(this.snapEdge(clipId, rawEnd), origStart + 1000);
          el.style.width = `${this.tickToWidth(ne - origStart)}px`;
        }
      };
      const up = (ev: PointerEvent) => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        this.lanes.querySelectorAll(".tl-lane.drop").forEach((l) => l.classList.remove("drop"));
        this.hideSnapGuide();
        const d = this.pxToTickDelta(ev.clientX - startX);
        if (mode === "move") {
          const raw = Math.max(0, origStart + d);
          const newStart = this.snapClipStart(clipId, raw, origDur);
          if (hoverTrackId && hoverTrackId !== clip.trackId && this.trackAcceptsClip(hoverTrackId, clipId)) {
            this.store.dispatch(commands.moveClipToTrack(clipId, hoverTrackId, newStart));
          } else {
            this.store.dispatch(commands.moveClip(clipId, newStart));
          }
        } else if (mode === "left") {
          const rawStart = Math.max(0, Math.min(origStart + d, origStart + origDur - 1000));
          const ns = Math.min(this.snapEdge(clipId, rawStart), origStart + origDur - 1000);
          this.store.dispatch(commands.trimClipStart(clipId, Math.max(0, ns)));
        } else {
          const rawEnd = Math.max(origStart + 1000, origStart + origDur + d);
          const ne = Math.max(this.snapEdge(clipId, rawEnd), origStart + 1000);
          this.store.dispatch(commands.trimClipEnd(clipId, ne));
        }
        this.onEdit();
        this.render();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    };

    el.addEventListener("pointerdown", startDrag("move"));
    (el.querySelector(".tl-hl") as HTMLElement).addEventListener("pointerdown", startDrag("left"));
    (el.querySelector(".tl-hr") as HTMLElement).addEventListener("pointerdown", startDrag("right"));
  }

  /**
   * Ajusta el inicio propuesto de un clip a un punto de enganche cercano (borde
   * de otro clip de la misma pista, el tick 0 o el cabezal), para facilitar que
   * los clips queden contiguos. Muestra una guía vertical cuando engancha.
   * Devuelve el startTick ya ajustado.
   */
  private snapClipStart(clipId: string, rawStart: number, dur: number): number {
    const st = this.store.getState();
    const clip = st.clips[clipId];
    if (!clip) return rawStart;
    const snapTick = this.pxToTickDelta(8); // distancia de enganche

    const points = this.snapPoints(clipId);
    const rawEnd = rawStart + dur;
    let best: { start: number; at: number } | null = null;
    for (const p of points) {
      // engancha el borde IZQUIERDO del clip a un punto
      if (Math.abs(rawStart - p) <= snapTick) {
        const dist = Math.abs(rawStart - p);
        if (!best || dist < Math.abs(best.start - best.at)) best = { start: p, at: p };
      }
      // engancha el borde DERECHO del clip a un punto (queda contiguo por la cola)
      if (Math.abs(rawEnd - p) <= snapTick) {
        const dist = Math.abs(rawEnd - p);
        const candidateStart = p - dur;
        if (candidateStart >= 0 && (!best || dist < Math.abs(best.start + dur - best.at))) {
          best = { start: candidateStart, at: p };
        }
      }
    }

    if (best) {
      this.showSnapGuide(best.at);
      return Math.max(0, best.start);
    }
    this.hideSnapGuide();
    return rawStart;
  }

  /** Puntos de enganche de una pista: bordes de otros clips, tick 0 y cabezal. */
  private snapPoints(clipId: string): number[] {
    const st = this.store.getState();
    const clip = st.clips[clipId];
    const points: number[] = [0, this.controller.tick];
    const track = clip ? st.tracks[clip.trackId] : null;
    if (track) {
      for (const cid of track.clipIds) {
        if (cid === clipId) continue;
        const c = st.clips[cid];
        if (!c) continue;
        points.push(c.startTick);
        points.push(c.startTick + clipDuration(c));
      }
    }
    return points;
  }

  /**
   * Engancha un borde suelto (al recortar inicio/fin) al punto cercano. Muestra
   * la guía si engancha. Devuelve el tick ajustado.
   */
  private snapEdge(clipId: string, rawTick: number): number {
    const snapTick = this.pxToTickDelta(8);
    let best: number | null = null;
    for (const p of this.snapPoints(clipId)) {
      if (Math.abs(rawTick - p) <= snapTick && (best === null || Math.abs(rawTick - p) < Math.abs(rawTick - best))) {
        best = p;
      }
    }
    if (best !== null) {
      this.showSnapGuide(best);
      return Math.max(0, best);
    }
    this.hideSnapGuide();
    return rawTick;
  }

  /** Muestra una guía vertical en el tick indicado (línea de enganche). */
  private showSnapGuide(tick: number): void {
    let guide = this.lanes.querySelector<HTMLElement>(".tl-snap");
    if (!guide) {
      guide = document.createElement("div");
      guide.className = "tl-snap";
      this.lanes.appendChild(guide);
    }
    guide.style.left = `${this.tickToPx(tick)}px`;
    guide.style.height = `${this.lanes.scrollHeight}px`;
    guide.style.display = "block";
  }

  private hideSnapGuide(): void {
    const guide = this.lanes.querySelector<HTMLElement>(".tl-snap");
    if (guide) guide.style.display = "none";
  }


  /** ¿La pista destino acepta este clip (compatibilidad audio/video)? */
  private trackAcceptsClip(trackId: string, clipId: string): boolean {
    const st = this.store.getState();
    const track = st.tracks[trackId];
    const clip = st.clips[clipId];
    if (!track || !clip) return false;
    if (clip.text) return track.kind === "text"; // los títulos solo a la pista de texto
    const assetKind = st.assets[clip.assetId]?.kind;
    if (assetKind === "audio") return track.kind === "audio";
    if (assetKind === "image") return track.kind === "image"; // imágenes solo a su pista
    return track.kind === "video";
  }

  /**
   * Dibuja los keyframes del clip como diamantes sobre su barra. Cada diamante
   * representa un tick con uno o más keyframes (de distintas propiedades).
   * Arrastrar: reubica el keyframe en el tiempo. Clic (sin arrastre): lleva el
   * playhead ahí. Clic derecho: lo elimina.
   */
  private paintKeyframes(clipEl: HTMLElement, clip: Clip): void {
    // recoge, por tick local, qué propiedades tienen keyframe ahí
    const byTick = new Map<number, Set<"scale" | "rotation" | "opacity" | "x" | "y">>();
    const collect = (prop: typeof clip.opacity, name: "scale" | "rotation" | "opacity" | "x" | "y") => {
      if (prop.kind !== "animated") return;
      for (const k of prop.keyframes) {
        if (!byTick.has(k.tick)) byTick.set(k.tick, new Set());
        byTick.get(k.tick)!.add(name);
      }
    };
    collect(clip.transform.scaleX, "scale");
    collect(clip.transform.rotation, "rotation");
    collect(clip.opacity, "opacity");
    collect(clip.transform.x, "x");
    collect(clip.transform.y, "y");
    if (byTick.size === 0) return;

    const dur = clipDuration(clip);
    for (const [localTick, props] of byTick) {
      const frac = dur > 0 ? Math.max(0, Math.min(1, localTick / dur)) : 0;
      const kf = document.createElement("div");
      kf.className = "tl-kf";
      kf.style.left = `${frac * 100}%`;
      kf.title = `Keyframe: ${[...props].join(", ")} · arrastra: recolocar · clic: ir · clic derecho: opciones`;

      kf.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showKeyframeMenu(e.clientX, e.clientY, clip.id, [...props], localTick);
      });

      kf.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation(); // no inicia el arrastre del clip
        kf.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        let dragged = false;
        let newTick = localTick;

        const move = (ev: PointerEvent) => {
          const d = this.pxToTickDelta(ev.clientX - startX);
          if (Math.abs(ev.clientX - startX) > 3) dragged = true;
          // limita al rango [0, duración] del clip
          newTick = Math.max(0, Math.min(dur, localTick + d));
          const f = dur > 0 ? newTick / dur : 0;
          kf.style.left = `${f * 100}%`;
          kf.classList.add("drag");
        };
        const up = () => {
          kf.removeEventListener("pointermove", move);
          kf.removeEventListener("pointerup", up);
          kf.classList.remove("drag");
          if (!dragged) {
            // fue un clic: lleva el playhead al keyframe
            void this.controller.seek(clip.startTick + localTick);
            return;
          }
          if (newTick !== localTick) {
            for (const p of props) {
              this.store.dispatch(commands.moveClipKeyframe(clip.id, p, localTick, newTick));
            }
            this.onEdit();
          }
          this.render();
        };
        kf.addEventListener("pointermove", move);
        kf.addEventListener("pointerup", up);
      });

      clipEl.appendChild(kf);
    }
  }

  /**
   * Menú contextual de un keyframe: permite elegir la curva de easing (cómo
   * interpola hacia el siguiente keyframe) o eliminarlo. Aplica a todas las
   * propiedades que comparten ese tick.
   */
  private showKeyframeMenu(
    screenX: number,
    screenY: number,
    clipId: string,
    props: ("scale" | "rotation" | "opacity" | "x" | "y")[],
    localTick: number,
  ): void {
    // cierra cualquier menú previo
    document.querySelectorAll(".tl-kf-menu").forEach((m) => m.remove());

    const menu = document.createElement("div");
    menu.className = "tl-kf-menu";
    menu.style.left = `${screenX}px`;
    menu.style.top = `${screenY}px`;

    const curves: { key: Easing; label: string }[] = [
      { key: "linear", label: "Lineal" },
      { key: "easeIn", label: "Acelera" },
      { key: "easeOut", label: "Desacelera" },
      { key: "easeInOut", label: "Suave" },
      { key: "hold", label: "Mantener" },
    ];
    // easing actual (de la primera propiedad)
    const st = this.store.getState();
    const clip = st.clips[clipId];
    let current: Easing | undefined;
    if (clip) {
      const p = props[0];
      const prop = p === "scale" ? clip.transform.scaleX
        : p === "rotation" ? clip.transform.rotation
        : p === "opacity" ? clip.opacity
        : p === "x" ? clip.transform.x : clip.transform.y;
      if (prop.kind === "animated") current = prop.keyframes.find((k) => k.tick === localTick)?.easing;
    }

    const header = document.createElement("div");
    header.className = "tl-kf-menu-h";
    header.textContent = "Curva";
    menu.appendChild(header);

    for (const c of curves) {
      const item = document.createElement("button");
      item.className = "tl-kf-menu-item" + (c.key === current ? " on" : "");
      item.textContent = c.label;
      item.addEventListener("click", () => {
        for (const p of props) {
          this.store.dispatch(commands.setClipKeyframeEasing(clipId, p, localTick, c.key));
        }
        this.onEdit();
        this.render();
        menu.remove();
      });
      menu.appendChild(item);
    }

    const del = document.createElement("button");
    del.className = "tl-kf-menu-item del";
    del.textContent = "Eliminar keyframe";
    del.addEventListener("click", () => {
      for (const p of props) {
        this.store.dispatch(commands.removeClipKeyframe(clipId, p, localTick));
      }
      this.onEdit();
      this.render();
      menu.remove();
    });
    menu.appendChild(del);

    document.body.appendChild(menu);
    // cerrar al hacer clic fuera
    const close = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener("pointerdown", close, true);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }

  /**
   * Menú contextual de una transición: permite elegir su duración. El comando
   * setTransitionDuration ajusta cuánto dura el efecto entre los dos clips.
   */

  /**
   * Menú para cambiar el FORMATO de todos los subtítulos a la vez. Aplica un
   * preset al estilo global del proyecto (setSubtitleStyle), que afecta a todos
   * los cues que no tengan un override propio. Tras aplicar, onEdit() reempuja
   * los subtítulos al visor con el nuevo estilo.
   */
  private showSubtitleFormatMenu(screenX: number, screenY: number): void {
    document.querySelectorAll(".tl-kf-menu").forEach((m) => m.remove());

    const menu = document.createElement("div");
    menu.className = "tl-kf-menu";
    menu.style.left = `${screenX}px`;
    menu.style.top = `${screenY}px`;

    const header = document.createElement("div");
    header.className = "tl-kf-menu-h";
    header.textContent = "Formato de todos";
    menu.appendChild(header);

    for (const preset of SUBTITLE_PRESETS) {
      const item = document.createElement("button");
      item.className = "tl-kf-menu-item";
      item.textContent = preset.name;
      item.addEventListener("click", () => {
        this.store.dispatch(commands.setSubtitleStyle(preset.style));
        this.onEdit();
        this.render();
        menu.remove();
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    const close = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener("pointerdown", close, true);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }
  /** Divide el clip bajo el cabezal (atajo de teclado o botón). */
  splitAtPlayhead(): void {
    this.split();
  }
  /** Elimina el clip seleccionado (atajo de teclado o botón). */
  deleteSelectedClip(): void {
    this.deleteSelected();
  }

  private split(): void {
    const t = this.controller.tick;
    const st = this.store.getState();
    const clip = Object.values(st.clips).find(
      (c) => t > c.startTick && t < c.startTick + clipDuration(c),
    );
    if (!clip) return;
    this.store.dispatch(commands.splitClip(clip.id, t));
    this.onEdit();
    this.render();
  }

  private deleteSelected(): void {
    if (!this.selectedClipId) return;
    this.store.dispatch(commands.removeClip(this.selectedClipId));
    this.selectedClipId = null;
    this.onSelect(null); // refleja la deselección (limpia el inspector)
    this.onEdit();
    this.render();
  }

  /** Separa el audio del clip de video seleccionado a una pista de audio. */
  private detachSelectedAudio(): void {
    if (!this.selectedClipId) return;
    const st = this.store.getState();
    const clip = st.clips[this.selectedClipId];
    if (!clip) return;
    const asset = st.assets[clip.assetId];
    if (!asset || asset.kind !== "video" || !asset.hasAudio) return;
    this.store.dispatch(commands.detachAudio(this.selectedClipId));
    this.onEdit();
    this.render();
  }

  /** Nombre legible de un tipo de transición. */
  private transitionLabel(type: string): string {
    return transitionLabelOf(type);
  }

  /** Menú para elegir el TIPO de transición entre el catálogo (por categorías). */

  /**
   * Añade (o quita) una transición crossfade entre el clip seleccionado y el
   * siguiente de su pista. Por defecto dura ~0.5 s.
   */
  private toggleTransition(): void {
    if (!this.selectedClipId) return;
    const st = this.store.getState();
    const clip = st.clips[this.selectedClipId];
    if (!clip) return;
    const track = st.tracks[clip.trackId];
    if (!track) return;
    const idx = track.clipIds.indexOf(clip.id);
    const nextId = track.clipIds[idx + 1];
    if (!nextId) return; // no hay clip siguiente

    // ¿ya existe una transición desde este clip? entonces la quitamos
    const existing = Object.values(st.transitions).find(
      (t) => t.fromClipId === clip.id && t.toClipId === nextId,
    );
    if (existing) {
      this.store.dispatch(commands.removeTransition(existing.id));
    } else {
      this.store.dispatch(commands.addTransition(clip.id, "crossfade", TICKS_PER_SECOND / 2));
    }
    this.onEdit();
    this.render();
  }
}
