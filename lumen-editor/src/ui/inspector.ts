import { commands, type EditorStore } from "../state/store";
import { evaluate } from "../model/animated";
import { clipDuration } from "../model/types";
import type { Clip, TextContent, CaptionCue, SubtitleStyle } from "../model/types";
import { icons } from "./icons";
import { TITLE_PRESETS } from "../captions/titlePresets";
import { ALL_FONTS, fontStack } from "../model/fonts";
import { EFFECT_SECTIONS, effectById } from "../model/videoEffects";
import { TRANSITION_SECTIONS, transitionLabelOf } from "../model/transitions";

interface InspectorOpts {
  container: HTMLElement;
  store: EditorStore;
  onEdit: () => void; // edición estructural: reconstruye timeline + inspector
  onLiveEdit: () => void; // edición continua (texto, color): refresca el visor SIN re-render
  currentTick: () => number; // tick actual del playhead (para keyframes)
}

/**
 * Panel derecho. Muestra las propiedades del clip seleccionado y las traduce a
 * comandos del store. Fiel al diseño de referencia: secciones de Transformación,
 * Opacidad/Fusión y —para audio— Volumen y fundidos. Si no hay selección,
 * muestra un estado vacío.
 */
export class Inspector {
  private container: HTMLElement;
  private store: EditorStore;
  private onEdit: () => void;
  private onLiveEdit: () => void;
  private currentTick: () => number;
  private selectedClipId: string | null = null;
  private selectedCaptionId: string | null = null;
  private selectedTransitionId: string | null = null;
  private effectTab = "bw"; // sección de efectos activa en el panel
  private transTab = "fade"; // sección de transiciones activa en el panel
  private transOpenedId: string | null = null; // qué transición se sincronizó ya

  constructor(opts: InspectorOpts) {
    this.container = opts.container;
    this.store = opts.store;
    this.onEdit = opts.onEdit;
    this.onLiveEdit = opts.onLiveEdit;
    this.currentTick = opts.currentTick;
    this.render();
  }

  setSelected(clipId: string | null): void {
    this.selectedClipId = clipId;
    if (clipId) { this.selectedCaptionId = null; this.selectedTransitionId = null; }
    this.render();
  }

  /** Selecciona un subtítulo para editar su estilo individual. */
  setSelectedCaption(captionId: string | null): void {
    this.selectedCaptionId = captionId;
    if (captionId) { this.selectedClipId = null; this.selectedTransitionId = null; }
    this.render();
  }

  /** Selecciona una transición para configurar su tipo y duración. */
  setSelectedTransition(transitionId: string | null): void {
    this.selectedTransitionId = transitionId;
    if (transitionId) { this.selectedClipId = null; this.selectedCaptionId = null; }
    this.transOpenedId = null; // fuerza re-sincronizar la pestaña al abrir
    this.render();
  }

  private fmtDur(tick: number): string {
    const s = Math.round(tick / 90000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  render(): void {
    const st = this.store.getState();

    // panel de configuración de transición (prioridad si hay una seleccionada)
    if (this.selectedTransitionId) {
      const tr = st.transitions[this.selectedTransitionId];
      if (tr) { this.renderTransition(tr.id, tr.type, tr.durationTick); return; }
      this.selectedTransitionId = null;
    }

    // panel de estilo de subtítulo (tiene prioridad si hay uno seleccionado)
    if (this.selectedCaptionId) {
      const cue = st.captions[this.selectedCaptionId];
      if (cue) { this.renderCaption(cue, st.project.subtitleStyle); return; }
      this.selectedCaptionId = null;
    }

    const clip = this.selectedClipId ? st.clips[this.selectedClipId] : null;

    if (!clip) {
      this.container.innerHTML = `
        <div class="insp-head"><div class="insp-title-row"><b>Inspector</b></div></div>
        <div class="insp-empty">Selecciona un clip en la línea de tiempo para ver sus propiedades.</div>`;
      return;
    }

    const asset = st.assets[clip.assetId];
    const track = st.tracks[clip.trackId];
    const isText = !!clip.text;
    const isAudio = !isText && (track?.kind === "audio" || asset?.kind === "audio");
    const kindLabel = isText ? "Título" : isAudio ? "Clip de audio" : "Clip de vídeo";

    const x = Math.round(evaluate(clip.transform.x, 0));
    const y = Math.round(evaluate(clip.transform.y, 0));
    const scale = Math.round(evaluate(clip.transform.scaleX, 0) * 100);
    const rot = Math.round(evaluate(clip.transform.rotation, 0));
    const opacity = Math.round(evaluate(clip.opacity, 0) * 100);
    const vol = Math.round(evaluate(clip.volume, 0) * 100);
    const dur = clipDuration(clip);

    const t = clip.text;
    const presetSection = !isText || !t ? "" : `
      <div class="insp-section">
        <div class="insp-section-title">Estilo</div>
        <div class="insp-presets">
          ${TITLE_PRESETS.map((p) => `<button class="insp-preset" data-preset="${p.id}">${p.name}</button>`).join("")}
        </div>
      </div>
      <div class="insp-section">
        <div class="insp-section-title">Tipo</div>
        ${this.fontSelectHtml(t.fontFamily, "txt-font")}
      </div>`;
    const textSection = !isText || !t ? "" : `
      <div class="insp-section">
        <div class="insp-section-title">Texto</div>
        <textarea data-act="txt-content" class="insp-textarea" rows="2" placeholder="Escribe tu título…">${t.text.replace(/</g, "&lt;")}</textarea>
        ${this.sliderRow("Tamaño", t.fontSizePx, 12, 320, "txt-size", "px")}
        <div class="insp-row">
          <span class="insp-label">Color</span>
          <input type="color" data-act="txt-color" value="${t.color}" class="insp-color" />
          <button class="insp-field" data-act="txt-bold" style="cursor:pointer;${t.bold ? "color:var(--accent-bright)" : ""}"><b>B</b></button>
          <button class="insp-field" data-act="txt-italic" style="cursor:pointer;${t.italic ? "color:var(--accent-bright)" : ""}"><i>I</i></button>
        </div>
        <div class="insp-row">
          <span class="insp-label">Alineación</span>
          <button class="insp-field" data-act="txt-align" style="justify-content:space-between;cursor:pointer;width:100%">
            <span class="v" style="color:var(--tx-70)">${({ left: "Izquierda", center: "Centro", right: "Derecha" } as Record<string, string>)[t.align]}</span>
            <span class="k">⇄</span>
          </button>
        </div>
        <div class="insp-row">
          <span class="insp-label">Fondo</span>
          <button class="mini-btn" data-act="txt-bg" style="height:26px">${t.background ? "Quitar fondo" : "Añadir fondo"}</button>
        </div>
        <div class="insp-row">
          <span class="insp-label">Contorno</span>
          <input type="color" data-act="txt-outline-color" value="${this.toHex(t.outlineColor)}" class="insp-color" />
        </div>
        ${this.sliderRow("Grosor", t.outlineWidthPx, 0, 20, "txt-outline", "px")}
      </div>`;

    const transformSection = (isAudio) ? "" : `
      <div class="insp-section">
        <div class="insp-section-title">Transformación</div>
        <div class="insp-row">
          <span class="insp-label">Posición</span>
          <div class="insp-field"><span class="k">X</span><input type="number" data-act="pos-x" class="insp-num" value="${x}" /></div>
          <div class="insp-field"><span class="k">Y</span><input type="number" data-act="pos-y" class="insp-num" value="${y}" /></div>
        </div>
        ${this.sliderRow("Escala", scale, 10, 300, "scale", "%", false, "scale")}
        ${this.sliderRow("Rotación", rot, -180, 180, "rotation", "°", false, "rotation")}
        ${this.sliderRow("Opacidad", opacity, 0, 100, "opacity", "%", true, "opacity")}
        <div class="insp-row">
          <span class="insp-label">Fusión</span>
          <button class="insp-field" data-act="blend" style="justify-content:space-between;cursor:pointer;width:100%">
            <span class="v" style="color:var(--tx-70)">${this.blendLabel(clip.blendMode)}</span>
            <span class="k">⇄</span>
          </button>
        </div>
      </div>`;

    const audioSection = isText ? "" : `
      <div class="insp-section">
        <div class="insp-section-title">Audio</div>
        ${this.sliderRow("Volumen", vol, 0, 200, "volume", "%", true)}
        ${this.sliderRow("Fade in", Math.round((clip.fadeInTick / Math.max(1, dur)) * 100), 0, 100, "fadein", "%")}
        ${this.sliderRow("Fade out", Math.round((clip.fadeOutTick / Math.max(1, dur)) * 100), 0, 100, "fadeout", "%")}
        <div class="insp-row">
          <span class="insp-label">Silencio</span>
          <button class="mini-btn" data-act="mute" style="height:26px">
            ${clip.muted ? icons.volumeX(13) : icons.volume(13)} ${clip.muted ? "Activar" : "Silenciar"}</button>
        </div>
      </div>`;

    // panel de efectos: solo para clips visuales (video/imagen), no texto ni audio
    const showEffects = !isText && !isAudio;
    const effectsSection = !showEffects ? "" : this.effectsSectionHtml(clip);

    this.container.innerHTML = `
      <div class="insp-head">
        <div class="insp-title-row"><b>Inspector</b></div>
        <div class="insp-clip">
          <div class="insp-clip-thumb" style="background:${isText ? "linear-gradient(165deg,#3a3548,#2a2636)" : isAudio ? "linear-gradient(165deg,#2c2937,#242230)" : "linear-gradient(165deg,#39424f,#262c33)"}"></div>
          <div style="min-width:0">
            <div class="insp-clip-name">${isText ? (clip.text?.text.split("\n")[0] || "Título") : (asset?.name ?? "Clip")}</div>
            <div class="insp-clip-sub">${kindLabel} · ${this.fmtDur(dur)}</div>
          </div>
        </div>
      </div>
      ${presetSection}
      ${textSection}
      ${transformSection}
      ${effectsSection}
      ${audioSection}`;

    this.wire(clip.id, dur);
  }

  private blendLabel(b: string): string {
    return ({ normal: "Normal", multiply: "Multiplicar", screen: "Trama", overlay: "Superponer", add: "Añadir" } as Record<string, string>)[b] ?? "Normal";
  }

  /** Panel de efectos: pestañas por sección + rejilla de efectos aplicables. */
  private effectsSectionHtml(clip: Clip): string {
    const current = clip.effectId ?? null;
    const activeSec = EFFECT_SECTIONS.find((s) => s.id === this.effectTab) ?? EFFECT_SECTIONS[0];
    const currentLabel = current ? (effectById(current)?.label ?? "Ninguno") : "Ninguno";

    const tabs = EFFECT_SECTIONS.map((s) =>
      `<button class="fx-tab${s.id === activeSec.id ? " on" : ""}" data-fxtab="${s.id}">${s.label}</button>`
    ).join("");

    // "Ninguno" + los 20 de la sección activa; el seleccionado se resalta
    const noneCard = `<button class="fx-cell${current === null ? " on" : ""}" data-fx="__none__" title="Sin efecto">
      <span class="fx-none">∅</span><span class="fx-name">Ninguno</span></button>`;
    const cells = activeSec.effects.map((e) => {
      // miniatura: un degradado simple con el filtro aplicado, como muestra rápida
      const sel = current === e.id ? " on" : "";
      return `<button class="fx-cell${sel}" data-fx="${e.id}" title="${e.label}">
        <span class="fx-swatch" style="filter:${e.filter === "none" ? "none" : e.filter}"></span>
        <span class="fx-name">${e.label}</span></button>`;
    }).join("");

    return `
      <div class="insp-section">
        <div class="insp-section-title">Efectos · <span style="color:var(--tx-70)">${currentLabel}</span></div>
        <div class="fx-tabs">${tabs}</div>
        <div class="fx-grid">${noneCard}${cells}</div>
      </div>`;
  }

  /**
   * Genera un selector de tipografía agrupado (Espectaculares / Genéricas). Cada
   * opción se previsualiza en su propia fuente. `current` es el font-family
   * actual; `act` es el valor data-act para cablear el cambio.
   */
  private fontSelectHtml(current: string, act: string): string {
    // el font-family guardado puede ser un stack ("Familia", fallback...); toma
    // la primera familia entre comillas o antes de la primera coma
    const cur = (current.match(/"([^"]+)"/)?.[1] ?? current.split(",")[0]).trim();
    const opt = (f: { family: string; label?: string }) => {
      const sel = f.family === cur ? " selected" : "";
      return `<option value="${f.family}" style="font-family:'${f.family}',sans-serif"${sel}>${f.label ?? f.family}</option>`;
    };
    const display = ALL_FONTS.filter((f) => f.category === "display").map(opt).join("");
    const generic = ALL_FONTS.filter((f) => f.category === "generic").map(opt).join("");
    return `
      <select class="insp-font" data-act="${act}" style="font-family:'${cur}',sans-serif">
        <optgroup label="Espectaculares">${display}</optgroup>
        <optgroup label="Genéricas">${generic}</optgroup>
      </select>`;
  }

  private sliderRow(
    label: string, value: number, min: number, max: number,
    key: string, suffix: string, neutral = false, kf?: string,
  ): string {
    const pct = ((value - min) / (max - min)) * 100;
    const kfBtn = kf
      ? `<button class="insp-kf" data-kf="${kf}" title="Fijar keyframe en el cursor">◆</button>`
      : "";
    return `
      <div class="insp-row" data-slider="${key}" data-min="${min}" data-max="${max}">
        <span class="insp-label">${label}</span>
        <div class="slider-track">
          <div class="slider-fill ${neutral ? "" : "neutral"}" style="width:${pct}%"></div>
          <div class="slider-knob" style="left:${pct}%"></div>
        </div>
        <span class="slider-val">${value}${suffix}</span>
        ${kfBtn}
      </div>`;
  }

  private wire(clipId: string, dur: number): void {
    // sliders (arrastre sobre la pista)
    this.container.querySelectorAll<HTMLElement>("[data-slider]").forEach((row) => {
      const track = row.querySelector(".slider-track") as HTMLElement;
      const key = row.dataset.slider!;
      const min = Number(row.dataset.min);
      const max = Number(row.dataset.max);

      const apply = (clientX: number, commit: boolean) => {
        const rect = track.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const value = min + t * (max - min);
        this.dispatchSlider(clipId, key, value, dur, commit);
      };
      track.addEventListener("pointerdown", (e) => {
        track.setPointerCapture(e.pointerId);
        apply(e.clientX, false);
        const mv = (ev: PointerEvent) => apply(ev.clientX, false);
        const up = (ev: PointerEvent) => {
          track.removeEventListener("pointermove", mv);
          track.removeEventListener("pointerup", up);
          apply(ev.clientX, true);
        };
        track.addEventListener("pointermove", mv);
        track.addEventListener("pointerup", up);
      });
    });

    const muteBtn = this.container.querySelector('[data-act="mute"]');
    muteBtn?.addEventListener("click", () => {
      const c = this.store.getState().clips[clipId];
      if (!c) return;
      this.store.dispatch(commands.setClipMuted(clipId, !c.muted));
      this.onEdit();
    });

    const blendBtn = this.container.querySelector('[data-act="blend"]');
    blendBtn?.addEventListener("click", () => {
      const c = this.store.getState().clips[clipId];
      if (!c) return;
      const modes: Clip["blendMode"][] = ["normal", "multiply", "screen", "overlay", "add"];
      const next = modes[(modes.indexOf(c.blendMode) + 1) % modes.length];
      this.store.dispatch(commands.setClipBlend(clipId, next));
      this.onEdit();
    });

    // ── efectos: cambiar de pestaña (sección) ──
    this.container.querySelectorAll<HTMLButtonElement>("[data-fxtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.effectTab = btn.dataset.fxtab!;
        this.render(); // solo re-renderiza el panel; el clip sigue seleccionado
      });
    });

    // ── efectos: aplicar (o quitar con "__none__") al clip ──
    this.container.querySelectorAll<HTMLButtonElement>("[data-fx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.fx!;
        this.store.dispatch(commands.setClipEffect(clipId, id === "__none__" ? null : id));
        this.render();      // refresca el resaltado del seleccionado
        this.onLiveEdit();  // repinta el visor con el efecto aplicado
      });
    });

    // ── plantillas de título (presets) ──
    this.container.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = TITLE_PRESETS.find((p) => p.id === btn.dataset.preset);
        if (!preset) return;
        this.store.dispatch(commands.updateTextClip(clipId, preset.style));
        this.onEdit();
        this.render();
      });
    });

    // ── tipografía del título ──
    const txtFont = this.container.querySelector<HTMLSelectElement>('[data-act="txt-font"]');
    txtFont?.addEventListener("change", () => {
      this.store.dispatch(commands.updateTextClip(clipId, { fontFamily: fontStack(txtFont.value) }));
      this.onEdit();
      this.render();
    });

    // ── controles de texto ──
    const txtContent = this.container.querySelector<HTMLTextAreaElement>('[data-act="txt-content"]');
    txtContent?.addEventListener("input", () => {
      this.store.dispatch(commands.updateTextClip(clipId, { text: txtContent.value }));
      this.onLiveEdit(); // refresca el visor sin reconstruir el inspector (no pierde el foco)
    });
    const txtColor = this.container.querySelector<HTMLInputElement>('[data-act="txt-color"]');
    txtColor?.addEventListener("input", () => {
      this.store.dispatch(commands.updateTextClip(clipId, { color: txtColor.value }));
      this.onLiveEdit();
    });
    const txtOutlineColor = this.container.querySelector<HTMLInputElement>('[data-act="txt-outline-color"]');
    txtOutlineColor?.addEventListener("input", () => {
      this.store.dispatch(commands.updateTextClip(clipId, { outlineColor: txtOutlineColor.value }));
      this.onLiveEdit();
    });
    const txtBold = this.container.querySelector('[data-act="txt-bold"]');
    txtBold?.addEventListener("click", () => {
      const c = this.store.getState().clips[clipId];
      this.store.dispatch(commands.updateTextClip(clipId, { bold: !c?.text?.bold }));
      this.onEdit(); this.render();
    });
    const txtItalic = this.container.querySelector('[data-act="txt-italic"]');
    txtItalic?.addEventListener("click", () => {
      const c = this.store.getState().clips[clipId];
      this.store.dispatch(commands.updateTextClip(clipId, { italic: !c?.text?.italic }));
      this.onEdit(); this.render();
    });
    const txtAlign = this.container.querySelector('[data-act="txt-align"]');
    txtAlign?.addEventListener("click", () => {
      const c = this.store.getState().clips[clipId];
      const aligns: TextContent["align"][] = ["left", "center", "right"];
      const cur = c?.text?.align ?? "center";
      const next = aligns[(aligns.indexOf(cur) + 1) % aligns.length];
      this.store.dispatch(commands.updateTextClip(clipId, { align: next }));
      this.onEdit(); this.render();
    });
    const txtBg = this.container.querySelector('[data-act="txt-bg"]');
    txtBg?.addEventListener("click", () => {
      const c = this.store.getState().clips[clipId];
      this.store.dispatch(commands.updateTextClip(clipId, { background: !c?.text?.background }));
      this.onEdit(); this.render();
    });

    // ── posición X/Y editable ──
    const applyPos = () => {
      const xEl = this.container.querySelector<HTMLInputElement>('[data-act="pos-x"]');
      const yEl = this.container.querySelector<HTMLInputElement>('[data-act="pos-y"]');
      if (!xEl || !yEl) return;
      const nx = Number(xEl.value) || 0;
      const ny = Number(yEl.value) || 0;
      this.store.dispatch(commands.setClipPosition(clipId, nx, ny));
      this.onEdit();
    };
    this.container.querySelector('[data-act="pos-x"]')?.addEventListener("change", applyPos);
    this.container.querySelector('[data-act="pos-y"]')?.addEventListener("change", applyPos);

    // ── keyframes: fija el valor actual de la propiedad en el tick del playhead ──
    this.container.querySelectorAll<HTMLElement>('[data-kf]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const prop = btn.dataset.kf as "scale" | "rotation" | "opacity";
        const c = this.store.getState().clips[clipId];
        if (!c) return;
        const local = Math.max(0, this.currentTick() - c.startTick);
        let value: number;
        if (prop === "scale") value = evaluate(c.transform.scaleX, local);
        else if (prop === "rotation") value = evaluate(c.transform.rotation, local);
        else value = evaluate(c.opacity, local);
        this.store.dispatch(commands.setClipKeyframe(clipId, prop, local, value));
        this.onEdit();
        this.render();
      });
    });
  }

  private dispatchSlider(clipId: string, key: string, value: number, dur: number, commit: boolean): void {
    switch (key) {
      case "scale":
        this.store.dispatch(commands.setClipScale(clipId, value / 100));
        break;
      case "rotation":
        this.store.dispatch(commands.setClipRotation(clipId, value));
        break;
      case "opacity":
        this.store.dispatch(commands.setClipOpacity(clipId, value / 100));
        break;
      case "volume":
        this.store.dispatch(commands.setClipVolume(clipId, value / 100));
        break;
      case "fadein": {
        const c = this.store.getState().clips[clipId];
        this.store.dispatch(commands.setClipFades(clipId, Math.round((value / 100) * dur), c?.fadeOutTick ?? 0));
        break;
      }
      case "fadeout": {
        const c = this.store.getState().clips[clipId];
        this.store.dispatch(commands.setClipFades(clipId, c?.fadeInTick ?? 0, Math.round((value / 100) * dur)));
        break;
      }
      case "txt-size":
        this.store.dispatch(commands.updateTextClip(clipId, { fontSizePx: Math.round(value) }));
        break;
      case "txt-outline":
        this.store.dispatch(commands.updateTextClip(clipId, { outlineWidthPx: Math.round(value) }));
        break;
    }
    // refresca solo al confirmar para no re-renderizar en cada movimiento
    if (commit) this.onEdit();
    else this.render();
  }

  /**
   * Panel de estilo de un subtítulo concreto. Cada control parte del estilo
   * efectivo (global + override del cue) y, al cambiarlo, guarda un override solo
   * para ese subtítulo con `setCaptionStyle`. Un botón restablece al estilo global.
   */
  private renderTransition(transitionId: string, currentType: string, durationTick: number): void {
    // Al ABRIR esta transición por primera vez, sitúa la pestaña en la categoría
    // del tipo actual. En renders posteriores NO se toca, para que el usuario
    // pueda navegar libremente entre categorías (antes esto lo devolvía siempre a
    // la categoría del tipo actual y lo dejaba atrapado en "Fundidos").
    if (this.transOpenedId !== transitionId) {
      this.transOpenedId = transitionId;
      const secOfCurrent = TRANSITION_SECTIONS.find((s) => s.items.some((i) => i.id === currentType));
      if (secOfCurrent) this.transTab = secOfCurrent.id;
    }
    const activeSec = TRANSITION_SECTIONS.find((s) => s.id === this.transTab) ?? TRANSITION_SECTIONS[0];

    const tabs = TRANSITION_SECTIONS.map((s) =>
      `<button class="fx-tab${s.id === activeSec.id ? " on" : ""}" data-trtab="${s.id}">${s.name}</button>`,
    ).join("");

    const items = activeSec.items.map((it) =>
      `<button class="tr-item${it.id === currentType ? " on" : ""}" data-tr="${it.id}">${it.label}</button>`,
    ).join("");

    const durSecs = Math.round((durationTick / 90000) * 10) / 10;
    const durations = [0.3, 0.5, 1, 1.5, 2];
    const durBtns = durations.map((d) =>
      `<button class="tr-dur${Math.abs(durSecs - d) < 0.05 ? " on" : ""}" data-dur="${d}">${d}s</button>`,
    ).join("");

    this.container.innerHTML = `
      <div class="insp-head">
        <div class="insp-title-row"><b>Transición</b></div>
        <div class="insp-sub">${transitionLabelOf(currentType)} · ${durSecs}s</div>
      </div>
      <div class="insp-section">
        <div class="insp-section-title">Tipo</div>
        <div class="fx-tabs">${tabs}</div>
        <div class="tr-list">${items}</div>
      </div>
      <div class="insp-section">
        <div class="insp-section-title">Duración</div>
        <div class="tr-durs">${durBtns}</div>
      </div>
      <div class="insp-section">
        <button class="insp-del-btn" data-tr-del="1">${icons.trash(14)} Quitar transición</button>
      </div>`;

    this.container.querySelectorAll<HTMLButtonElement>("[data-trtab]").forEach((btn) => {
      btn.addEventListener("click", () => { this.transTab = btn.dataset.trtab!; this.render(); });
    });
    this.container.querySelectorAll<HTMLButtonElement>("[data-tr]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.store.dispatch(commands.setTransitionType(transitionId, btn.dataset.tr!));
        this.onEdit();
        this.render();
      });
    });
    this.container.querySelectorAll<HTMLButtonElement>("[data-dur]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.store.dispatch(commands.setTransitionDuration(transitionId, Math.round(Number(btn.dataset.dur) * 90000)));
        this.onEdit();
        this.render();
      });
    });
    const del = this.container.querySelector<HTMLButtonElement>("[data-tr-del]");
    del?.addEventListener("click", () => {
      this.store.dispatch(commands.removeTransition(transitionId));
      this.selectedTransitionId = null;
      this.onEdit();
      this.render();
    });
  }

  private renderCaption(cue: CaptionCue, global: SubtitleStyle): void {
    const eff: SubtitleStyle = cue.style ? { ...global, ...cue.style } : global;
    const hasOverride = !!cue.style && Object.keys(cue.style).length > 0;
    const posLabel: Record<string, string> = { top: "Arriba", middle: "Centro", bottom: "Abajo" };

    this.container.innerHTML = `
      <div class="insp-head">
        <div class="insp-title-row"><b>Subtítulo</b>
          <span class="insp-badge" style="background:#2a2832;color:var(--accent-violet)">${icons.text(11)} CC</span>
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-title">Texto</div>
        <textarea data-c="text" class="insp-textarea" rows="2" placeholder="Texto del subtítulo…">${cue.text.replace(/</g, "&lt;")}</textarea>
      </div>

      <div class="insp-section">
        <div class="insp-section-title">Tipo</div>
        ${this.fontSelectHtml(eff.fontFamily, "cap-font")}
      </div>

      <div class="insp-section">
        <div class="insp-section-title">Estilo${hasOverride ? ' <span style="color:var(--accent-violet);font-weight:400">· personalizado</span>' : ' <span style="color:var(--tx-40);font-weight:400">· global</span>'}</div>
        <div class="insp-row">
          <span class="insp-label">Color</span>
          <input type="color" data-c="color" value="${this.toHex(eff.color)}" class="insp-color" />
        </div>
        <div class="insp-row">
          <span class="insp-label">Tamaño</span>
          <div class="insp-field"><input type="number" data-c="size" class="insp-num" value="${Math.round(eff.fontSizePx)}" min="8" max="400" /><span class="k">px</span></div>
        </div>
        <div class="insp-row">
          <span class="insp-label">Estilo</span>
          <button class="mini-btn${eff.bold ? " on" : ""}" data-c="bold" style="height:26px;flex:1">Negrita</button>
          <button class="mini-btn${eff.italic ? " on" : ""}" data-c="italic" style="height:26px;flex:1">Cursiva</button>
        </div>
        <div class="insp-row">
          <span class="insp-label">Posición</span>
          <button class="insp-field" data-c="pos" style="justify-content:space-between;cursor:pointer;width:100%">
            <span class="v" style="color:var(--tx-70)">${posLabel[eff.position]}</span><span class="k">⇄</span>
          </button>
        </div>
        <div class="insp-row">
          <span class="insp-label">Contorno</span>
          <input type="color" data-c="outline-color" value="${this.toHex(eff.outlineColor)}" class="insp-color" />
          <div class="insp-field"><input type="number" data-c="outline-w" class="insp-num" value="${Math.round(eff.outlineWidthPx)}" min="0" max="20" /><span class="k">px</span></div>
        </div>
        <div class="insp-row">
          <span class="insp-label">Fondo</span>
          <button class="mini-btn${eff.background ? " on" : ""}" data-c="bg" style="height:26px;flex:1">${eff.background ? "Activado" : "Desactivado"}</button>
          <input type="color" data-c="bg-color" value="${this.toHex(eff.backgroundColor)}" class="insp-color"${eff.background ? "" : " disabled"} />
        </div>
      </div>

      <div class="insp-section">
        <button class="mini-btn" data-c="reset" style="width:100%;justify-content:center;height:30px"${hasOverride ? "" : " disabled"}>Restablecer al estilo global</button>
      </div>`;

    this.wireCaption(cue);
  }

  /** Convierte un color (hex o rgb) a #rrggbb para los inputs type=color. */
  private toHex(c: string): string {
    if (c.startsWith("#")) return c.slice(0, 7);
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return "#ffffff";
    const h = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }

  private wireCaption(cue: CaptionCue): void {
    const id = cue.id;
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector(sel) as T | null;

    // texto: en vivo mientras se escribe, sin re-render (no perder el foco)
    const ta = q<HTMLTextAreaElement>('[data-c="text"]');
    ta?.addEventListener("input", () => {
      this.store.dispatch(commands.updateCaption(id, { text: ta.value }));
      this.onLiveEdit();
    });
    ta?.addEventListener("change", () => this.onEdit());

    // color del texto: en vivo
    const col = q<HTMLInputElement>('[data-c="color"]');
    col?.addEventListener("input", () => {
      this.store.dispatch(commands.setCaptionStyle(id, { color: col.value }));
      this.onLiveEdit();
    });
    col?.addEventListener("change", () => this.render());

    // tamaño
    const size = q<HTMLInputElement>('[data-c="size"]');
    size?.addEventListener("change", () => {
      this.store.dispatch(commands.setCaptionStyle(id, { fontSizePx: Number(size.value) }));
      this.onEdit();
      this.render();
    });

    // negrita / cursiva (toggles respecto al valor efectivo)
    const eff = (): SubtitleStyle => {
      const g = this.store.getState().project.subtitleStyle;
      const c = this.store.getState().captions[id];
      return c?.style ? { ...g, ...c.style } : g;
    };
    q('[data-c="bold"]')?.addEventListener("click", () => {
      this.store.dispatch(commands.setCaptionStyle(id, { bold: !eff().bold }));
      this.onEdit(); this.render();
    });
    q('[data-c="italic"]')?.addEventListener("click", () => {
      this.store.dispatch(commands.setCaptionStyle(id, { italic: !eff().italic }));
      this.onEdit(); this.render();
    });

    // posición (cicla arriba→centro→abajo)
    q('[data-c="pos"]')?.addEventListener("click", () => {
      const order = ["top", "middle", "bottom"] as const;
      const cur = eff().position;
      const next = order[(order.indexOf(cur) + 1) % order.length];
      this.store.dispatch(commands.setCaptionStyle(id, { position: next }));
      this.onEdit(); this.render();
    });

    // contorno: color y grosor
    const oc = q<HTMLInputElement>('[data-c="outline-color"]');
    oc?.addEventListener("input", () => {
      this.store.dispatch(commands.setCaptionStyle(id, { outlineColor: oc.value }));
      this.onLiveEdit();
    });
    oc?.addEventListener("change", () => this.render());
    const ow = q<HTMLInputElement>('[data-c="outline-w"]');
    ow?.addEventListener("change", () => {
      this.store.dispatch(commands.setCaptionStyle(id, { outlineWidthPx: Number(ow.value) }));
      this.onEdit(); this.render();
    });

    // fondo (caja tras el texto): activar/desactivar y color
    q('[data-c="bg"]')?.addEventListener("click", () => {
      this.store.dispatch(commands.setCaptionStyle(id, { background: !eff().background }));
      this.onEdit(); this.render();
    });
    const bg = q<HTMLInputElement>('[data-c="bg-color"]');
    bg?.addEventListener("input", () => {
      // el input da #rrggbb; conserva una opacidad legible (0.55) como el global
      const hex = bg.value;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      this.store.dispatch(commands.setCaptionStyle(id, { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.55)` }));
      this.onLiveEdit();
    });
    bg?.addEventListener("change", () => this.render());

    // fuente del subtítulo
    const cf = q<HTMLSelectElement>('[data-c="cap-font"]');
    cf?.addEventListener("change", () => {
      this.store.dispatch(commands.setCaptionStyle(id, { fontFamily: fontStack(cf.value) }));
      this.onEdit(); this.render();
    });

    // restablecer al estilo global
    q('[data-c="reset"]')?.addEventListener("click", () => {
      this.store.dispatch(commands.clearCaptionStyle(id));
      this.onEdit(); this.render();
    });
  }
}
