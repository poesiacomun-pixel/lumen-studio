import { detectCapabilities } from "./runtime/capabilities";
import { EditorStore, createEmptyProject, commands } from "./state/store";
import type { ProjectState } from "./model/types";
import { importVideoFile, importAudioFile, importImageFile } from "./media/import";
import {
  PlaybackController,
  type TimelineClipInfo,
  type AssetInfo,
} from "./media/playback";
import { Transcriber } from "./captions/transcriber";
import { Exporter } from "./export/exporter";
import { Timeline } from "./timeline/timeline";
import { formatTimecode, TICKS_PER_SECOND } from "./model/time";
import { readFromOPFS } from "./storage/opfs";
import {
  saveProject,
  loadProjectById,
  migrateLegacyProject,
} from "./storage/projectStore";
import { renderProjectsScreen } from "./ui/projectsScreen";
import { setupResizers } from "./ui/resizers";
import { Inspector } from "./ui/inspector";
import { PreviewInteractor } from "./ui/previewInteractor";
import { icons } from "./ui/icons";
import { googleFontsHref } from "./model/fonts";
import { loadAllFonts } from "./media/fontLoader";

/** Handle mínimo devuelto por showSaveFilePicker (File System Access API). */
interface FileSystemWritableTarget {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

async function boot(): Promise<void> {
  const app = document.getElementById("app")!;
  const caps = await detectCapabilities();
  console.log("Capacidades:", caps);

  // inyecta la hoja de Google Fonts con todo el catálogo (UI y previsualización)
  // y carga las familias en el documento para que se vean al instante.
  if (!document.getElementById("lumen-fonts")) {
    const link = document.createElement("link");
    link.id = "lumen-fonts";
    link.rel = "stylesheet";
    link.href = googleFontsHref();
    document.head.appendChild(link);
    void loadAllFonts(document as unknown as { fonts: FontFaceSet });
  }

  if (!caps.supported) {
    app.innerHTML = `
      <div class="gate">
        <h1>Lumen Studio</h1>
        <p>Tu navegador todavía no puede ejecutar el editor:</p>
        <ul>${caps.blockers.map((b) => `<li>${b}</li>`).join("")}</ul>
        <p>Recomendado: Chrome reciente en escritorio o Android.</p>
      </div>`;
    return;
  }

  // Migra el proyecto único del esquema anterior (clave "current") al nuevo
  // formato multi-proyecto, una sola vez.
  await migrateLegacyProject();

  // Arranca en la PANTALLA DE INICIO.
  showHome();
}

/** Pinta la pantalla de inicio (galería de proyectos) y conecta sus acciones. */
function showHome(): void {
  console.log("[nav] showHome()", new Error().stack);
  const app = document.getElementById("app")!;
  void renderProjectsScreen(app, {
    onNew: () => {
      const state = createEmptyProject({ name: "Proyecto sin título" });
      void saveProject(state).then(() => startEditor(state));
    },
    onOpen: (id) => {
      console.log("[nav] onOpen()", id);
      void loadProjectById(id).then((state) => {
        console.log("[nav] loadProjectById resolved", !!state);
        if (state) startEditor(state);
        else showHome();
      });
    },
  });
}

/** Diálogo "¿quieres guardar tu proyecto?" al salir con cambios sin guardar. */
function showSaveDialog(opts: { onSave: () => void; onDiscard: () => void }): void {
  const back = document.createElement("div");
  back.className = "save-dialog-backdrop";
  back.innerHTML = `
    <div class="save-dialog" role="dialog" aria-modal="true">
      <h3>¿Guardar tu proyecto?</h3>
      <p>Tienes cambios sin guardar. ¿Quieres guardarlos antes de salir?</p>
      <div class="save-dialog-actions">
        <button class="sd-discard">Salir sin guardar</button>
        <button class="sd-cancel">Cancelar</button>
        <button class="sd-save">Guardar y salir</button>
      </div>
    </div>`;
  const close = () => back.remove();
  back.querySelector(".sd-save")!.addEventListener("click", () => { close(); opts.onSave(); });
  back.querySelector(".sd-discard")!.addEventListener("click", () => { close(); opts.onDiscard(); });
  back.querySelector(".sd-cancel")!.addEventListener("click", close);
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  document.body.appendChild(back);
}

/**
 * Monta el editor con un estado de proyecto concreto. Antes vivía dentro de
 * boot(); ahora se invoca desde la pantalla de inicio con el proyecto elegido.
 */
function startEditor(initialState: ProjectState): void {
  console.log("[nav] startEditor()", initialState.project?.name);
  const app = document.getElementById("app")!;
  const store = new EditorStore(initialState);
  const controller = new PlaybackController();
  const transcriber = new Transcriber();
  const exporter = new Exporter();
  let inited = false;
  let scrubbing = false;
  let dirty = false; // hay cambios sin guardar
  const fps = store.getState().project.fps;

  /** Captura el lienzo del visor como dataURL para usarlo de preview estático. */
  function captureThumb(): string | undefined {
    // El canvas del visor está transferido a un worker (OffscreenCanvas), así
    // que no podemos leer sus píxeles aquí. Devolvemos undefined para conservar
    // el thumb anterior. (Mejorable más adelante pidiendo el frame al worker.)
    return undefined;
  }

  /** Guarda el proyecto ahora mismo (botón manual / autosave / al salir). */
  async function doSave(): Promise<void> {
    await saveProject(store.getState(), captureThumb());
    dirty = false;
    showSaved();
  }

  // autoguardado en IndexedDB (con rebote) + marca de "sin guardar"
  let saveTimer = 0;
  store.subscribe(() => {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void doSave(); }, 800);
  });

  // Autosave de seguridad cada 10 minutos (además del rebote por cambios).
  const periodicSave = window.setInterval(() => { if (dirty) void doSave(); }, 10 * 60 * 1000);

  // Al cerrar/recargar: si hay cambios sin guardar, intenta guardar y avisa.
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!dirty) return;
    void doSave();
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  /* ─────────────────────── Estructura del shell ─────────────────────── */
  app.innerHTML = `
    <div class="app-root">
      <header class="app-header">
        <div class="brand">
          <button class="icon-btn" id="home-btn" title="Volver a proyectos" style="margin-right:4px">${icons.importArrow(16)}</button>
          <div class="brand-mark">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#16201e"><path d="M8 5.5v13l11-6.5z"/></svg>
          </div>
          <span class="brand-name">Lumen</span>
          <span class="brand-sub">Studio</span>
        </div>
        <div class="project-pill">
          <span class="project-name" id="proj-name" contenteditable="true" spellcheck="false"></span>
          <span style="color:var(--tx-40);display:flex">${icons.edit(12)}</span>
        </div>
        <div class="header-actions">
          <button class="icon-btn" id="undo" title="Deshacer">${icons.undo(17)}</button>
          <button class="icon-btn" id="redo" title="Rehacer">${icons.redo(17)}</button>
          <div class="hdr-divider"></div>
          <button class="btn-ghost" id="save-btn" title="Guardar proyecto (Ctrl+S)">Guardar</button>
          <button class="btn-primary" id="export">${icons.export(15)} Exportar</button>
        </div>
      </header>

      <div class="body-row">
        <!-- Librería de medios -->
        <aside class="side-panel library">
          <div class="panel-tabs">
            <button class="panel-tab active" data-tab="media">Medios</button>
            <button class="panel-tab" data-tab="audio">Audio</button>
            <button class="panel-tab" data-tab="text">Texto</button>
            <button class="panel-tab" data-tab="captions">Subtítulos</button>
          </div>
          <div class="panel-scroll" id="library-body"></div>
        </aside>

        <!-- Visor -->
        <div class="gutter gutter-col" data-gutter="library" title="Arrastra para redimensionar"></div>
        <section class="stage">
          <div class="stage-bar">
            <div class="stage-bar-l"><span class="live-dot"></span> Visor</div>
            <div class="stage-bar-r" id="stage-meta">
              <span id="meta-res">—</span><span class="dot">·</span><span id="meta-fps">${Math.round(fps)} fps</span>
              <button class="stage-fs-btn" id="fullscreen-btn" title="Pantalla completa">${icons.fullscreen(15)}</button>
            </div>
          </div>
          <div class="stage-view" id="stage-view">
            <canvas id="preview" class="preview" hidden></canvas>
            <div id="preview-overlay" class="preview-overlay"></div>
            <div id="preview-empty" class="preview empty">Importa un video para empezar</div>
            <!-- Controles embebidos, visibles solo en pantalla completa -->
            <div class="fs-controls" id="fs-controls">
              <button class="fs-play" id="fs-play" title="Reproducir/Pausar">${icons.play(30)}</button>
              <div class="fs-bar">
                <span class="fs-time" id="fs-time">00:00</span>
                <div class="fs-seek" id="fs-seek"><div class="fs-seek-fill" id="fs-seek-fill"></div></div>
                <span class="fs-time" id="fs-dur">00:00</span>
                <button class="fs-exit" id="fs-exit" title="Salir de pantalla completa">${icons.fullscreenExit(16)}</button>
              </div>
            </div>
          </div>
          <div class="transport">
            <div class="tc"><b id="tc-cur">00:00:00:00</b><span id="tc-dur"> / 00:00:00:00</span></div>
            <div class="transport-mid">
              <button class="play-btn" id="play">${icons.play(18)}</button>
            </div>
            <div class="transport-r">
              <span class="saved" id="saved"></span>
            </div>
          </div>
        </section>

        <!-- Inspector -->
        <div class="gutter gutter-col" data-gutter="inspector" title="Arrastra para redimensionar"></div>
        <aside class="side-panel inspector" id="inspector"></aside>
      </div>

      <!-- Timeline -->
      <div class="gutter gutter-row" data-gutter="timeline" title="Arrastra para redimensionar"></div>
      <div class="timeline-region" id="timeline"></div>
    </div>`;

  /* ─────────────────────────── Referencias ─────────────────────────── */
  const canvas = document.getElementById("preview") as HTMLCanvasElement;
  const previewOverlay = document.getElementById("preview-overlay")!;
  const previewEmpty = document.getElementById("preview-empty")!;
  const playBtn = document.getElementById("play") as HTMLButtonElement;
  const tcCur = document.getElementById("tc-cur")!;
  const tcDur = document.getElementById("tc-dur")!;
  const tlWrap = document.getElementById("timeline")!;
  const inspectorEl = document.getElementById("inspector")!;
  const libraryBody = document.getElementById("library-body")!;
  const projName = document.getElementById("proj-name")!;
  const undoBtn = document.getElementById("undo") as HTMLButtonElement;
  const redoBtn = document.getElementById("redo") as HTMLButtonElement;
  const metaRes = document.getElementById("meta-res")!;

  projName.textContent = store.getState().project.name;
  projName.addEventListener("blur", () => {
    const name = projName.textContent?.trim() || "Sin título";
    store.dispatch(commands.renameProject(name));
  });

  function showSaved(): void {
    const el = document.getElementById("saved");
    if (!el) return;
    el.textContent = "Guardado ✓";
    window.setTimeout(() => { el.textContent = ""; }, 1500);
  }

  function refreshHistoryButtons(): void {
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
  }
  undoBtn.addEventListener("click", () => { store.undo(); void afterEditAsync(); });
  redoBtn.addEventListener("click", () => { store.redo(); void afterEditAsync(); });

  const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
  saveBtn.addEventListener("click", () => void doSave());

  /** Vuelve a la pantalla de inicio. Si hay cambios sin guardar, pregunta. */
  function goHome(): void {
    const leave = () => {
      controller.pause();
      window.clearInterval(periodicSave);
      window.removeEventListener("beforeunload", onBeforeUnload);
      showHome();
    };
    if (!dirty) { void doSave().then(leave); return; }
    showSaveDialog({
      onSave: () => void doSave().then(leave),
      onDiscard: leave,
    });
  }
  document.getElementById("home-btn")!.addEventListener("click", goHome);

  /* ───────────────────────── Sincronización ───────────────────────── */
  function videoTimelineInfo(): { clips: TimelineClipInfo[]; assets: Record<string, AssetInfo> } {
    const st = store.getState();
    // pre-roll por clip: si un clip es el "to" de una transición, se activa antes
    const preRoll: Record<string, number> = {};
    for (const tr of Object.values(st.transitions)) {
      preRoll[tr.toClipId] = Math.max(preRoll[tr.toClipId] ?? 0, tr.durationTick);
    }
    const clips: TimelineClipInfo[] = [];
    for (const trackId of st.project.trackIds) {
      const track = st.tracks[trackId];
      // se componen las pistas visuales: video, imagen y texto (títulos)
      if (track.kind !== "video" && track.kind !== "text" && track.kind !== "image") continue;
      if (track.hidden) continue; // las pistas ocultas no se componen
      for (const id of track.clipIds) {
        const c = st.clips[id];
        if (!c) continue;
        clips.push({
          id: c.id, assetId: c.assetId, startTick: c.startTick,
          inTick: c.inTick, outTick: c.outTick, speed: c.speed,
          zIndex: track.zIndex,
          preRollTick: preRoll[c.id] ?? 0,
          text: c.text,
        });
      }
    }
    const assets: Record<string, AssetInfo> = {};
    for (const a of Object.values(st.assets)) {
      assets[a.id] = {
        opfsPath: a.opfsPath, codec: a.codec ?? "",
        width: a.width ?? 0, height: a.height ?? 0,
        kind: a.kind,
      };
    }
    return { clips, assets };
  }

  async function syncTimeline(): Promise<void> {
    const st = store.getState();
    controller.setCanvasSize(st.project.width, st.project.height);
    const { clips, assets } = videoTimelineInfo();
    await controller.setTimeline(clips, assets, fps);
    await controller.setProject(st);
    pushSubtitles();
  }

  let selectedClipId: string | null = null;

  const timeline = new Timeline({
    container: tlWrap,
    store,
    controller,
    onEdit: () => void afterEditAsync(),
    onSelect: (clipId) => {
      selectedClipId = clipId;
      inspector.setSelected(clipId);
      previewInteractor.update();
    },
    onSelectCaption: (captionId) => {
      selectedClipId = null;
      inspector.setSelectedCaption(captionId);
      previewInteractor.update();
    },
    onSelectTransition: (transitionId) => {
      selectedClipId = null;
      inspector.setSelectedTransition(transitionId);
      previewInteractor.update();
    },
  });

  const inspector = new Inspector({
    container: inspectorEl,
    store,
    currentTick: () => controller.tick,
    onEdit: () => {
      renderLibrary();
      void afterEditAsync(); // reconstruye la timeline (capas de texto incluidas) + inspector
    },
    onLiveEdit: () => {
      // edición continua (texto/color): refleja el cambio en el visor SIN
      // reconstruir el inspector, para no perder el foco del campo de texto.
      void controller.refreshText(store.getState());
      previewInteractor.update();
    },
  });

  const previewInteractor = new PreviewInteractor({
    canvas,
    overlay: previewOverlay,
    store,
    selectedClipId: () => selectedClipId,
    projectSize: () => {
      const p = store.getState().project;
      return { width: p.width, height: p.height };
    },
    currentTick: () => controller.tick,
    onLiveEdit: () => {
      // refresca el visor según el tipo de clip que se manipula: los títulos
      // solo necesitan refrescar texto; los clips de vídeo, recomponer el frame.
      const c = selectedClipId ? store.getState().clips[selectedClipId] : null;
      if (c && c.text) controller.refreshText(store.getState());
      else controller.refreshCompose(store.getState());
    },
  });
  window.addEventListener("resize", () => previewInteractor.update());

  // Paneles redimensionables (biblioteca, inspector y timeline). Al redimensionar
  // se recolocan el recuadro del visor y la regla/cabezal de la timeline.
  setupResizers(app, () => {
    previewInteractor.update();
    timeline.render();
  });

  function afterEdit(): void {
    timeline.render();
    inspector.render();
    refreshHistoryButtons();
    previewInteractor.update();
  }
  async function afterEditAsync(): Promise<void> {
    await syncTimeline();
    afterEdit();
  }

  /* ─────────────────────────── Transporte ─────────────────────────── */
  playBtn.addEventListener("click", () => {
    controller.toggle();
    playBtn.blur(); // quita el foco para que Espacio no dispare el botón nativo + el atajo
  });

  let lastPlaying: boolean | null = null;
  function setPlayIcon(playing: boolean): void {
    if (playing === lastPlaying) return; // evita reescribir el SVG en cada frame
    lastPlaying = playing;
    playBtn.innerHTML = playing ? icons.pause(18) : icons.play(18);
  }

  controller.onTick = (tick, duration, playing) => {
    if (!scrubbing) { /* el playhead lo mueve la timeline */ }
    tcCur.textContent = formatTimecode(tick, fps);
    tcDur.textContent = " / " + formatTimecode(duration, fps);
    setPlayIcon(playing);
    timeline.setPlayhead(tick);
    if (!playing) previewInteractor.update(); // recoloca el recuadro del título al hacer scrub
    updateFsControls(tick, duration, playing);
  };

  /* ───────────────────── Pantalla completa del visor ───────────────────── */
  const stageView = document.getElementById("stage-view")!;
  const fsBtn = document.getElementById("fullscreen-btn") as HTMLButtonElement;
  const fsPlay = document.getElementById("fs-play") as HTMLButtonElement;
  const fsExit = document.getElementById("fs-exit") as HTMLButtonElement;
  const fsTime = document.getElementById("fs-time")!;
  const fsDur = document.getElementById("fs-dur")!;
  const fsSeek = document.getElementById("fs-seek")!;
  const fsSeekFill = document.getElementById("fs-seek-fill")!;

  let fsLastPlaying: boolean | null = null;
  function fmtClock(tick: number): string {
    const secs = Math.max(0, Math.floor(tick / TICKS_PER_SECOND));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  function updateFsControls(tick: number, duration: number, playing: boolean): void {
    if (!document.fullscreenElement) return; // solo si estamos en pantalla completa
    const pct = duration > 0 ? Math.min(100, (tick / duration) * 100) : 0;
    fsSeekFill.style.width = `${pct}%`;
    fsSeek.style.setProperty("--fs-knob", `${pct}%`);
    fsTime.textContent = fmtClock(tick);
    fsDur.textContent = fmtClock(duration);
    if (playing !== fsLastPlaying) {
      fsLastPlaying = playing;
      fsPlay.innerHTML = playing ? icons.pause(30) : icons.play(30);
    }
  }

  function isFullscreen(): boolean {
    return document.fullscreenElement === stageView;
  }
  async function toggleFullscreen(): Promise<void> {
    try {
      if (isFullscreen()) await document.exitFullscreen();
      else await stageView.requestFullscreen();
    } catch (err) {
      console.error("No se pudo cambiar a pantalla completa:", err);
    }
  }
  fsBtn.addEventListener("click", () => void toggleFullscreen());
  fsExit.addEventListener("click", () => void toggleFullscreen());
  fsPlay.addEventListener("click", () => { controller.toggle(); fsPlay.blur(); });

  // mostrar los controles al mover el ratón; ocultarlos tras 2.5 s de quietud
  let hideTimer = 0;
  function showControls(): void {
    stageView.classList.add("show-controls");
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => stageView.classList.remove("show-controls"), 2500);
  }
  stageView.addEventListener("pointermove", () => { if (document.fullscreenElement) showControls(); });

  // seek arrastrando/clic sobre la barra embebida
  function seekFromBar(clientX: number): void {
    const rect = fsSeek.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    void controller.seek(Math.round(frac * controller.duration));
  }
  fsSeek.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fsSeek.setPointerCapture(e.pointerId);
    seekFromBar(e.clientX);
    const mv = (ev: PointerEvent) => seekFromBar(ev.clientX);
    const up = () => {
      fsSeek.releasePointerCapture(e.pointerId);
      fsSeek.removeEventListener("pointermove", mv);
      fsSeek.removeEventListener("pointerup", up);
    };
    fsSeek.addEventListener("pointermove", mv);
    fsSeek.addEventListener("pointerup", up);
  });

  // al entrar/salir de pantalla completa: ajustar icono del botón y el canvas
  document.addEventListener("fullscreenchange", () => {
    const fs = isFullscreen();
    fsBtn.innerHTML = fs ? icons.fullscreenExit(15) : icons.fullscreen(15);
    if (fs) {
      showControls();
      updateFsControls(controller.tick, controller.duration, controller.isPlaying);
    } else {
      stageView.classList.remove("show-controls");
      clearTimeout(hideTimer);
    }
    previewInteractor.update();
  });

  /* ─────────────────────────── Atajos de teclado ─────────────────────────── */
  // ¿el foco está en un campo editable? Entonces no robamos las teclas.
  function isTyping(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  window.addEventListener("keydown", (e) => {
    // Ctrl/⌘ + S guarda, incluso si el foco está en un campo de texto.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void doSave();
      return;
    }
    if (isTyping()) return;

    // Deshacer / rehacer (Ctrl/⌘ + Z, y Shift para rehacer)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      void afterEditAsync();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      store.redo();
      void afterEditAsync();
      return;
    }
    // a partir de aquí, atajos sin modificadores
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case " ": // Espacio: play / pausa
        e.preventDefault();
        controller.toggle();
        break;
      case "f":
      case "F": // F: pantalla completa del visor
        e.preventDefault();
        void toggleFullscreen();
        break;
      case "Delete":
      case "Backspace": // Suprimir: borra el clip seleccionado
        if (selectedClipId) {
          e.preventDefault();
          timeline.deleteSelectedClip();
          selectedClipId = null;
          previewInteractor.update();
        }
        break;
      case "s":
      case "S": // S: dividir en el cabezal
        e.preventDefault();
        timeline.splitAtPlayhead();
        break;
      case "ArrowLeft": // ←/→: avanzar/retroceder un fotograma
        e.preventDefault();
        void controller.seek(controller.tick - TICKS_PER_SECOND / fps);
        break;
      case "ArrowRight":
        e.preventDefault();
        void controller.seek(controller.tick + TICKS_PER_SECOND / fps);
        break;
      case "Home": // Home/End: inicio / fin
        e.preventDefault();
        void controller.seek(0);
        break;
      case "End":
        e.preventDefault();
        void controller.seek(controller.duration);
        break;
    }
  });

  /* ─────────────────────────── Subtítulos ─────────────────────────── */
  function pushSubtitles(): void {
    const st = store.getState();
    const cues = Object.values(st.captions)
      .sort((a, b) => a.startTick - b.startTick)
      .map((c) => ({ startTick: c.startTick, endTick: c.endTick, text: c.text, style: c.style }));
    controller.setSubtitles(cues, st.project.subtitleStyle);
  }

  async function runTranscription(opfsPath: string, model: string): Promise<void> {
    try {
      const file = await readFromOPFS(opfsPath);
      const cues = await transcriber.transcribe(file, { model, language: "spanish" }, (p) => {
        setLibInfo(p.label);
      });
      store.dispatch(commands.setCaptions(cues));
      pushSubtitles();
      setLibInfo(`${cues.length} subtítulos generados.`);
      renderLibrary();
    } catch (err) {
      setLibInfo("Error al transcribir: " + (err as Error).message);
      console.error(err);
    }
  }

  /* ─────────────────────────── Exportación ────────────────────────── */
  const exportBtn = document.getElementById("export") as HTMLButtonElement;
  exportBtn.addEventListener("click", () => void runExport());

  async function runExport(): Promise<void> {
    const st = store.getState();
    const hasVideo = Object.values(st.assets).some((a) => a.kind === "video");
    if (!hasVideo) { setLibInfo("Primero importa un video."); return; }
    const cues = Object.values(st.captions)
      .sort((a, b) => a.startTick - b.startTick)
      .map((c) => ({ startTick: c.startTick, endTick: c.endTick, text: c.text, style: c.style }));
    const baseName =
      Object.values(st.assets).find((a) => a.kind === "video")?.name ?? "lumen";
    const suggestedName = baseName.replace(/\.[^.]+$/, "") + "-lumen.mp4";

    // IMPORTANTE: pedir el destino ANTES de procesar. showSaveFilePicker exige la
    // "activación del usuario" del clic, que se pierde si esperamos a que termine
    // el export (que tarda). Así el diálogo abre inmediatamente al pulsar Exportar.
    let fileHandle: FileSystemWritableTarget | null = null;
    const picker = (window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName?: string;
        types?: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<FileSystemWritableTarget>;
    }).showSaveFilePicker;
    if (picker) {
      try {
        fileHandle = await picker({
          suggestedName,
          types: [{ description: "Video MP4", accept: { "video/mp4": [".mp4"] } }],
        });
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") { setLibInfo("Exportación cancelada."); return; }
        console.warn("showSaveFilePicker falló, se descargará a Descargas:", err);
        fileHandle = null;
      }
    }

    exportBtn.disabled = true;
    try {
      const blob = await exporter.export(st, st.project.subtitleStyle, cues, fps, (p) => {
        exportBtn.textContent = p.label;
      });
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        // respaldo: descarga automática a la carpeta de Descargas
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);
      }
      setLibInfo("Exportación completa ✓");
    } catch (err) {
      setLibInfo("Error al exportar: " + (err as Error).message);
      console.error(err);
    } finally {
      exportBtn.disabled = false;
      exportBtn.innerHTML = `${icons.export(15)} Exportar`;
    }
  }

  /* ─────────────────────────── Librería ───────────────────────────── */
  let activeTab = "media";
  let libInfo = "";
  function setLibInfo(msg: string): void { libInfo = msg; renderLibrary(); }

  document.querySelectorAll<HTMLButtonElement>(".panel-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab!;
      document.querySelectorAll(".panel-tab").forEach((b) => b.classList.toggle("active", b === btn));
      renderLibrary();
    });
  });

  const THUMBS = [
    "linear-gradient(165deg,#2f4a4d,#243036)",
    "linear-gradient(165deg,#5a4038,#32272a)",
    "linear-gradient(165deg,#3d473a,#292e29)",
    "linear-gradient(165deg,#39424f,#262c33)",
    "linear-gradient(165deg,#42404f,#2a2930)",
    "linear-gradient(165deg,#4a3f39,#2c2826)",
  ];
  function thumbFor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return THUMBS[Math.abs(h) % THUMBS.length];
  }
  function fmtDur(tick: number): string {
    const s = Math.round(tick / 90000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function renderLibrary(): void {
    const st = store.getState();
    const assets = Object.values(st.assets);

    if (activeTab === "text") {
      libraryBody.innerHTML = `
        <div class="panel-head"><div class="panel-head-title"><b>Texto</b></div></div>
        <button class="mini-btn" id="add-title" style="width:100%;justify-content:center;height:34px;margin-bottom:10px">
          ${icons.text(13)} Añadir título</button>
        <div style="font-size:11px;color:var(--tx-40);line-height:1.5">${libInfo || "Añade un título en la posición actual del cursor. Selecciónalo en la línea de tiempo para editar su contenido y estilo en el inspector."}</div>`;
      document.getElementById("add-title")?.addEventListener("click", () => {
        const start = controller.tick;
        const dur = TICKS_PER_SECOND * 3;
        store.dispatch(commands.addTextClip(null, start, dur));
        void afterEditAsync();
        setLibInfo("Título añadido a la pista de títulos. Edítalo en el inspector.");
      });
      return;
    }

    if (activeTab === "captions") {
      // Fuentes con audio disponibles: videos (con pista de audio) y audios.
      const audioSources = assets.filter((a) => a.kind === "audio" || a.hasAudio);
      // Fuente por defecto: si hay un clip seleccionado cuyo asset tenga audio,
      // ese; si no, cuando solo hay una fuente, esa; si no, la primera.
      const selClip = selectedClipId ? st.clips[selectedClipId] : null;
      const selAsset = selClip ? audioSources.find((a) => a.id === selClip.assetId) : undefined;
      const defaultSource = selAsset ?? audioSources[0];
      const hasSources = audioSources.length > 0;
      const multiple = audioSources.length > 1;
      const sourceSelect = multiple
        ? `<select id="cap-source" class="mini-btn" style="width:100%;height:30px;margin-bottom:10px;background:var(--bg-elev)">
            ${audioSources.map((a) => {
              const tag = a.kind === "audio" ? "Audio" : "Video";
              const sel = defaultSource && a.id === defaultSource.id ? " selected" : "";
              return `<option value="${a.id}"${sel}>${tag}: ${a.name}</option>`;
            }).join("")}
          </select>`
        : "";
      const hint = !defaultSource
        ? "Importa un video o un audio primero."
        : multiple
          ? "Elige la fuente de audio para los subtítulos."
          : `Se usará el audio de «${defaultSource.name}».`;
      libraryBody.innerHTML = `
        <div class="panel-head"><div class="panel-head-title"><b>Subtítulos</b></div></div>
        <button class="mini-btn" id="autocap" style="width:100%;justify-content:center;height:32px;margin-bottom:10px"${hasSources ? "" : " disabled"}>
          ${icons.sparkles(13)} Generar automáticos</button>
        ${sourceSelect}
        <select id="cap-model" class="mini-btn" style="width:100%;height:30px;margin-bottom:10px;background:var(--bg-elev)">
          <option value="onnx-community/whisper-tiny">Tiny · más rápido, menos preciso (~75 MB)</option>
          <option value="onnx-community/whisper-base" selected>Base · equilibrado (~145 MB)</option>
          <option value="onnx-community/whisper-small">Small · más preciso en español (~250 MB)</option>
          <option value="onnx-community/whisper-large-v3-turbo">Large v3 Turbo · el más preciso (~800 MB, lento sin GPU)</option>
        </select>
        <div style="font-size:11px;color:var(--tx-40);line-height:1.5">${libInfo || hint}</div>`;
      document.getElementById("autocap")?.addEventListener("click", () => {
        const picker = document.getElementById("cap-source") as HTMLSelectElement | null;
        const chosenId = picker?.value;
        const source =
          (chosenId && audioSources.find((a) => a.id === chosenId)) || defaultSource;
        if (!source) { setLibInfo("Primero importa un video o un audio."); return; }
        const model = (document.getElementById("cap-model") as HTMLSelectElement).value;
        void runTranscription(source.opfsPath, model);
      });
      return;
    }

    const filtered = activeTab === "audio" ? assets.filter((a) => a.kind === "audio") : assets;
    const label = activeTab === "audio" ? "Audio" : "Medios";
    const cards = filtered.map((a) => {
      const isAudio = a.kind === "audio";
      const thumb = isAudio
        ? `<div class="media-thumb" style="background:linear-gradient(165deg,#2c2937,#242230);display:flex;align-items:center;justify-content:center;color:var(--accent-violet)">${icons.music(22)}<span class="badge">${fmtDur(a.durationTick)}</span></div>`
        : `<div class="media-thumb" style="background:${thumbFor(a.id)}"><span class="badge">${fmtDur(a.durationTick)}</span></div>`;
      return `<div class="media-card" data-asset="${a.id}">${thumb}<div class="media-name">${a.name}</div><button class="media-del" data-del="${a.id}" title="Eliminar este medio">${icons.trash(13)}</button></div>`;
    }).join("");

    libraryBody.innerHTML = `
      <div class="panel-head">
        <div class="panel-head-title"><b>${label}</b><span>${filtered.length} clip${filtered.length === 1 ? "" : "s"}</span></div>
        <button class="mini-btn" id="import-btn">${icons.plus(12)} Importar</button>
      </div>
      <div class="media-drop" id="drop">
        <div class="media-drop-ic">${icons.importArrow(15)}</div>
        <div><div class="media-drop-t1">Arrastra archivos aquí</div><div class="media-drop-t2">o haz clic para importar</div></div>
      </div>
      <div class="media-grid">${cards || `<div class="media-empty">Sin medios aún</div>`}</div>
      ${libInfo ? `<div style="margin-top:12px;font-size:11px;color:var(--tx-40)">${libInfo}</div>` : ""}
      <input id="file" type="file" accept="${activeTab === "audio" ? "audio/*" : "video/mp4,image/*,audio/*"}" hidden />`;

    const fileInput = document.getElementById("file") as HTMLInputElement;
    const drop = document.getElementById("drop")!;
    document.getElementById("import-btn")!.addEventListener("click", () => fileInput.click());
    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      void dispatchFile(f);
    });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      void dispatchFile(f);
    });
    libraryBody.querySelectorAll<HTMLElement>("[data-del]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.del;
        if (!id) return;
        store.dispatch(commands.removeAsset(id));
        void afterEditAsync();
        renderLibrary();
      });
    });
  }

  /** Decide el importador según el tipo MIME del archivo. */
  async function dispatchFile(f: File): Promise<void> {
    if (f.type.startsWith("audio/")) return handleAudioFile(f);
    if (f.type.startsWith("image/")) return handleImageFile(f);
    return handleFile(f);
  }

  /* ───────────────────────── Importación ──────────────────────────── */
  function revealEditor(): void {
    canvas.hidden = false;
    previewEmpty.style.display = "none";
  }

  /** Devuelve el tick donde termina el último clip de una pista (0 si vacía). */
  function trackEndTick(trackId: string): number {
    const st = store.getState();
    const track = st.tracks[trackId];
    if (!track) return 0;
    let end = 0;
    for (const cid of track.clipIds) {
      const c = st.clips[cid];
      if (!c) continue;
      const e = c.startTick + Math.round((c.outTick - c.inTick) / c.speed);
      if (e > end) end = e;
    }
    return end;
  }

  async function handleAudioFile(file: File): Promise<void> {
    setLibInfo("Importando audio…");
    try {
      const asset = await importAudioFile(file);
      store.dispatch(commands.addAsset(asset));
      let audioTrackId = store.getState().project.trackIds.find(
        (id) => store.getState().tracks[id]?.kind === "audio",
      );
      if (!audioTrackId) {
        store.dispatch(commands.addTrack("audio", "Música"));
        audioTrackId = store.getState().project.trackIds.find(
          (id) => store.getState().tracks[id]?.kind === "audio",
        )!;
      }
      store.dispatch(commands.addClip(audioTrackId, asset.id, trackEndTick(audioTrackId), 0, asset.durationTick));
      if (!inited) { await controller.init(canvas); inited = true; }
      await syncTimeline();
      afterEdit();
      setLibInfo(`${asset.name} añadido.`);
    } catch (err) {
      setLibInfo("Error al importar audio: " + (err as Error).message);
      console.error(err);
    }
  }

  async function handleImageFile(file: File): Promise<void> {
    setLibInfo("Importando imagen…");
    try {
      const asset = await importImageFile(file);
      store.dispatch(commands.addAsset(asset));
      // las imágenes van en su propia pista dedicada (tipo "image")
      if (store.getState().project.trackIds.filter((id) => store.getState().tracks[id]?.kind === "image").length === 0) {
        store.dispatch(commands.addTrack("image", "Imágenes"));
      }
      const trackId = store.getState().project.trackIds.find((id) => store.getState().tracks[id]?.kind === "image")!;
      // duración por defecto de una imagen fija: 5 s (editable con trim)
      const dur = TICKS_PER_SECOND * 5;
      store.dispatch(commands.addClip(trackId, asset.id, trackEndTick(trackId), 0, dur));

      if (!inited) { await controller.init(canvas); inited = true; }
      revealEditor();
      await syncTimeline();
      afterEdit();
      setLibInfo(`${asset.name} añadida (5 s).`);
    } catch (err) {
      setLibInfo("Error al importar imagen: " + (err as Error).message);
      console.error(err);
    }
  }

  async function handleFile(file: File): Promise<void> {
    setLibInfo("Importando…");
    try {
      const asset = await importVideoFile(file);
      store.dispatch(commands.addAsset(asset));
      if (store.getState().project.trackIds.filter((id) => store.getState().tracks[id]?.kind === "video").length === 0) {
        store.dispatch(commands.addTrack("video", "Vídeo 1"));
      }
      const trackId = store.getState().project.trackIds.find((id) => store.getState().tracks[id]?.kind === "video")!;
      store.dispatch(commands.addClip(trackId, asset.id, trackEndTick(trackId), 0, asset.durationTick));

      if (!inited) { await controller.init(canvas); inited = true; }
      revealEditor();
      await syncTimeline();
      afterEdit();
      metaRes.textContent = `${asset.width} × ${asset.height}`;
      setLibInfo(`${asset.name} · ${asset.codec}`);
    } catch (err) {
      setLibInfo("Error: " + (err as Error).message);
      console.error(err);
    }
  }

  /* ─────────────────────── Restaurar sesión ───────────────────────── */
  async function restoreSession(): Promise<void> {
    try {
      const st = store.getState();
      if (Object.values(st.clips).length === 0) return;
      if (!inited) { await controller.init(canvas); inited = true; }
      const hasVideo = Object.values(st.assets).some((a) => a.kind === "video");
      if (hasVideo) revealEditor();
      await syncTimeline();
      afterEdit();
      const va = Object.values(st.assets).find((a) => a.kind === "video");
      if (va) metaRes.textContent = `${va.width} × ${va.height}`;
    } catch (err) {
      console.error(err);
    }
  }

  renderLibrary();
  refreshHistoryButtons();
  void restoreSession();
}

void boot();
