import { produce, current, type Draft } from "immer";
import type {
  Asset,
  CaptionCue,
  Clip,
  Id,
  Project,
  ProjectState,
  SubtitleStyle,
  Track,
} from "../model/types";
import { clipDuration, defaultClipAudio, defaultSubtitleStyle, defaultTextContent } from "../model/types";
import type { TextContent, Easing } from "../model/types";
import { defaultTransform, makeStatic, setKeyframe, removeKeyframe, moveKeyframe, setKeyframeEasing } from "../model/animated";
import type { Ticks } from "../model/time";

const newId = (): Id => crypto.randomUUID();

/* ───────────────────────────────  Comandos  ───────────────────────────── */

/**
 * Un comando es una transformación pura del estado. Gracias a immer, cada
 * resultado comparte estructura con el anterior, así que guardar instantáneas
 * para undo/redo es barato (no se copia todo el documento en cada paso).
 */
export interface Command {
  label: string;
  run: (state: ProjectState) => ProjectState;
}

function command(
  label: string,
  recipe: (draft: Draft<ProjectState>) => void,
): Command {
  return { label, run: (state) => produce(state, recipe) };
}

/** Recalcula la duración total del proyecto a partir de sus clips. */
function recomputeDuration(d: Draft<ProjectState>): void {
  let max = 0;
  for (const clip of Object.values(d.clips)) {
    max = Math.max(max, clip.startTick + clipDuration(clip));
  }
  d.project.durationTick = max;
}

/**
 * Creadores de comandos. Aquí van solo unos cuantos como muestra del patrón;
 * el resto (split, trim, reorder, setProperty, addKeyframe…) se añaden igual,
 * sin tocar el store ni el historial.
 */
export const commands = {
  addTrack: (kind: Track["kind"], name: string) =>
    command(`Añadir pista ${name}`, (d) => {
      const id = newId();
      d.tracks[id] = {
        id, kind, name,
        zIndex: d.project.trackIds.length,
        muted: false, locked: false, hidden: false,
        volume: 1, solo: false,
        clipIds: [],
      };
      d.project.trackIds.push(id);
    }),

  renameProject: (name: string) =>
    command("Renombrar proyecto", (d) => {
      d.project.name = name;
    }),

  addAsset: (asset: Asset) =>
    command(`Importar ${asset.name}`, (d) => {
      d.assets[asset.id] = asset;
    }),

  addClip: (
    trackId: Id,
    assetId: Id,
    startTick: Ticks,
    inTick: Ticks,
    outTick: Ticks,
  ) =>
    command("Añadir clip", (d) => {
      const id = newId();
      d.clips[id] = {
        id, assetId, trackId, startTick, inTick, outTick,
        speed: 1,
        opacity: makeStatic(1),
        blendMode: "normal",
        transform: defaultTransform(),
        effects: [],
        ...defaultClipAudio(),
      };
      const track = d.tracks[trackId];
      track.clipIds.push(id);
      track.clipIds.sort((a, b) => d.clips[a].startTick - d.clips[b].startTick);
      recomputeDuration(d);
    }),

  moveClip: (clipId: Id, newStartTick: Ticks) =>
    command("Mover clip", (d) => {
      const clip = d.clips[clipId];
      clip.startTick = Math.max(0, newStartTick);
      const track = d.tracks[clip.trackId];
      track.clipIds.sort((a, b) => d.clips[a].startTick - d.clips[b].startTick);
      recomputeDuration(d);
    }),

  /**
   * Mueve un clip a otra pista (y opcionalmente reposiciona en el tiempo).
   * Valida compatibilidad: un clip de audio solo va a pistas de audio; los de
   * video y los de texto solo a pistas de video. Si no es compatible, no hace nada.
   */
  moveClipToTrack: (clipId: Id, toTrackId: Id, newStartTick: Ticks) =>
    command("Mover a otra pista", (d) => {
      const clip = d.clips[clipId];
      const toTrack = d.tracks[toTrackId];
      if (!clip || !toTrack) return;
      const fromTrack = d.tracks[clip.trackId];
      if (!fromTrack) return;
      if (toTrackId === clip.trackId) {
        // misma pista: equivale a un move normal
        clip.startTick = Math.max(0, newStartTick);
        fromTrack.clipIds.sort((a, b) => d.clips[a].startTick - d.clips[b].startTick);
        recomputeDuration(d);
        return;
      }
      // compatibilidad pista/clip
      if (clip.text) {
        if (toTrack.kind !== "text") return; // los títulos solo van a pistas de texto
      } else {
        const assetKind = d.assets[clip.assetId]?.kind;
        if (assetKind === "audio" && toTrack.kind !== "audio") return;
        if (assetKind === "image" && toTrack.kind !== "image") return;
        if (assetKind === "video" && toTrack.kind !== "video") return;
      }

      // limpia transiciones del clip (su contexto de adyacencia cambia)
      for (const [tid, tr] of Object.entries(d.transitions)) {
        if (tr.fromClipId === clipId || tr.toClipId === clipId) delete d.transitions[tid];
      }

      fromTrack.clipIds = fromTrack.clipIds.filter((c) => c !== clipId);
      clip.trackId = toTrackId;
      clip.startTick = Math.max(0, newStartTick);
      toTrack.clipIds.push(clipId);
      toTrack.clipIds.sort((a, b) => d.clips[a].startTick - d.clips[b].startTick);
      recomputeDuration(d);
    }),

  /** Añade un clip de texto (título) a una pista de video en `startTick`. */
  /**
   * Añade un título. Si `trackId` es null, usa (o crea) una pista de texto
   * dedicada. Coloca el clip en `startTick`; si ahí se solaparía con otro título
   * de la misma pista, lo recoloca justo después del último para que no se pisen.
   */
  addTextClip: (trackId: Id | null, startTick: Ticks, durationTick: Ticks) =>
    command("Añadir texto", (d) => {
      // resuelve la pista de texto destino
      let tid = trackId;
      if (!tid || d.tracks[tid]?.kind !== "text") {
        const textTrack = d.project.trackIds
          .map((id) => d.tracks[id])
          .find((t) => t && t.kind === "text");
        if (textTrack) {
          tid = textTrack.id;
        } else {
          tid = newId();
          d.tracks[tid] = {
            id: tid, kind: "text", name: "Títulos",
            zIndex: 50, // muy por encima del video, para que los títulos vayan arriba
            muted: false, locked: false, hidden: false,
            volume: 1, solo: false,
            clipIds: [],
          };
          d.project.trackIds.push(tid);
        }
      }
      const track = d.tracks[tid];

      // evita solapamiento: si el hueco en startTick está ocupado, va tras el último
      let start = Math.max(0, startTick);
      for (const cid of track.clipIds) {
        const c = d.clips[cid];
        const end = c.startTick + (c.outTick - c.inTick);
        if (start < end && start + durationTick > c.startTick) {
          start = end; // empújalo después de este clip
        }
      }

      const id = newId();
      d.clips[id] = {
        id, assetId: "", trackId: tid,
        startTick: start,
        inTick: 0,
        outTick: durationTick, // para un clip de texto, out marca su duración
        speed: 1,
        opacity: makeStatic(1),
        blendMode: "normal",
        transform: defaultTransform(),
        effects: [],
        text: defaultTextContent(),
        ...defaultClipAudio(),
      };
      track.clipIds.push(id);
      track.clipIds.sort((a, b) => d.clips[a].startTick - d.clips[b].startTick);
      recomputeDuration(d);
    }),

  /** Actualiza el contenido/estilo de un clip de texto. */
  updateTextClip: (clipId: Id, patch: Partial<TextContent>) =>
    command("Editar texto", (d) => {
      const clip = d.clips[clipId];
      if (!clip || !clip.text) return;
      Object.assign(clip.text, patch);
    }),

  removeClip: (clipId: Id) =>
    command("Eliminar clip", (d) => {
      const clip = d.clips[clipId];
      if (!clip) return;
      d.tracks[clip.trackId].clipIds =
        d.tracks[clip.trackId].clipIds.filter((c) => c !== clipId);
      delete d.clips[clipId];
      // elimina transiciones que referencien a este clip
      for (const [tid, tr] of Object.entries(d.transitions)) {
        if (tr.fromClipId === clipId || tr.toClipId === clipId) delete d.transitions[tid];
      }
      recomputeDuration(d);
    }),

  removeTrack: (trackId: Id) =>
    command("Eliminar pista", (d) => {
      const track = d.tracks[trackId];
      if (!track) return;
      // borra los clips de la pista y las transiciones que los referencien
      for (const clipId of [...track.clipIds]) {
        delete d.clips[clipId];
        for (const [tid, tr] of Object.entries(d.transitions)) {
          if (tr.fromClipId === clipId || tr.toClipId === clipId) delete d.transitions[tid];
        }
      }
      // elimina la pista del estado y de la lista de orden
      delete d.tracks[trackId];
      d.project.trackIds = d.project.trackIds.filter((t) => t !== trackId);
      recomputeDuration(d);
    }),

  removeAsset: (assetId: Id) =>
    command("Eliminar medio", (d) => {
      if (!d.assets[assetId]) return;
      // Borra todos los clips que usan este asset (y limpia sus pistas y las
      // transiciones que los referencien). Así un medio borrado no deja clips
      // huérfanos ni sigue apareciendo en selectores (p.ej. el de subtítulos).
      const clipIds = Object.values(d.clips)
        .filter((c) => c.assetId === assetId)
        .map((c) => c.id);
      for (const clipId of clipIds) {
        const clip = d.clips[clipId];
        if (!clip) continue;
        const track = d.tracks[clip.trackId];
        if (track) track.clipIds = track.clipIds.filter((c) => c !== clipId);
        delete d.clips[clipId];
        for (const [tid, tr] of Object.entries(d.transitions)) {
          if (tr.fromClipId === clipId || tr.toClipId === clipId) delete d.transitions[tid];
        }
      }
      delete d.assets[assetId];
      recomputeDuration(d);
    }),

  /* --- edición de clips: dividir y recortar --- */

  /** Divide un clip en el punto `atTick` de la línea de tiempo. */
  splitClip: (clipId: Id, atTick: Ticks) =>
    command("Dividir clip", (d) => {
      const clip = d.clips[clipId];
      if (!clip) return;
      const dur = clipDuration(clip);
      if (atTick <= clip.startTick || atTick >= clip.startTick + dur) return;

      const offsetSource = Math.round((atTick - clip.startTick) * clip.speed);
      const splitIn = clip.inTick + offsetSource;

      const copy = structuredClone(current(clip)) as Clip;
      const bId = newId();
      copy.id = bId;
      copy.startTick = atTick;
      copy.inTick = splitIn;
      d.clips[bId] = copy;

      clip.outTick = splitIn; // la primera mitad termina en el corte

      const track = d.tracks[clip.trackId];
      track.clipIds.push(bId);
      track.clipIds.sort((a, b) => d.clips[a].startTick - d.clips[b].startTick);
    }),

  /** Recorta el inicio del clip moviéndolo a `newStartTick`. */
  trimClipStart: (clipId: Id, newStartTick: Ticks) =>
    command("Recortar inicio", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const end = c.startTick + clipDuration(c);
      const ns = Math.max(0, Math.min(newStartTick, end - 1000));
      const newIn = c.inTick + Math.round((ns - c.startTick) * c.speed);
      if (newIn < 0 || newIn >= c.outTick) return;
      c.startTick = ns;
      c.inTick = newIn;
      recomputeDuration(d);
    }),

  /** Recorta el final del clip llevándolo a `newEndTick`. */
  trimClipEnd: (clipId: Id, newEndTick: Ticks) =>
    command("Recortar fin", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const asset = d.assets[c.assetId];
      const newDur = Math.max(1000, newEndTick - c.startTick);
      let newOut = c.inTick + Math.round(newDur * c.speed);
      if (asset) newOut = Math.min(newOut, asset.durationTick);
      if (newOut <= c.inTick) return;
      c.outTick = newOut;
      recomputeDuration(d);
    }),

  /* --- transform / composición del clip --- */

  setClipScale: (clipId: Id, scale: number) =>
    command("Escala del clip", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const s = Math.max(0.1, Math.min(3, scale));
      c.transform.scaleX = makeStatic(s);
      c.transform.scaleY = makeStatic(s);
    }),

  setClipRotation: (clipId: Id, deg: number) =>
    command("Rotación del clip", (d) => {
      const c = d.clips[clipId];
      if (c) c.transform.rotation = makeStatic(Math.max(-180, Math.min(180, deg)));
    }),

  setClipOpacity: (clipId: Id, value: number) =>
    command("Opacidad del clip", (d) => {
      const c = d.clips[clipId];
      if (c) c.opacity = makeStatic(Math.max(0, Math.min(1, value)));
    }),

  setClipPosition: (clipId: Id, x: number, y: number) =>
    command("Posición del clip", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      c.transform.x = makeStatic(x);
      c.transform.y = makeStatic(y);
    }),

  setClipBlend: (clipId: Id, blend: Clip["blendMode"]) =>
    command("Fusión del clip", (d) => {
      const c = d.clips[clipId];
      if (c) c.blendMode = blend;
    }),

  /** Aplica (o quita, con null) un efecto de look del catálogo a un clip. */
  setClipEffect: (clipId: Id, effectId: string | null) =>
    command("Efecto del clip", (d) => {
      const c = d.clips[clipId];
      if (c) c.effectId = effectId ?? undefined;
    }),

  /**
   * Fija un keyframe de una propiedad animable del clip en `localTick` (tick
   * relativo al inicio del clip) con el valor actual de esa propiedad evaluado
   * ahí. Convierte la propiedad en animada. `prop` indica cuál: escala, rotación,
   * opacidad, x o y. Para escala se animan scaleX e scaleY a la par.
   */
  setClipKeyframe: (clipId: Id, prop: "scale" | "rotation" | "opacity" | "x" | "y", localTick: Ticks, value: number) =>
    command("Fijar keyframe", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const t = Math.max(0, localTick);
      if (prop === "scale") {
        c.transform.scaleX = setKeyframe(c.transform.scaleX, t, value, "easeInOut", newId);
        c.transform.scaleY = setKeyframe(c.transform.scaleY, t, value, "easeInOut", newId);
      } else if (prop === "rotation") {
        c.transform.rotation = setKeyframe(c.transform.rotation, t, value, "easeInOut", newId);
      } else if (prop === "opacity") {
        c.opacity = setKeyframe(c.opacity, t, value, "easeInOut", newId);
      } else if (prop === "x") {
        c.transform.x = setKeyframe(c.transform.x, t, value, "easeInOut", newId);
      } else {
        c.transform.y = setKeyframe(c.transform.y, t, value, "easeInOut", newId);
      }
    }),

  /** Elimina el keyframe en `localTick` de una propiedad animable del clip. */
  removeClipKeyframe: (clipId: Id, prop: "scale" | "rotation" | "opacity" | "x" | "y", localTick: Ticks) =>
    command("Eliminar keyframe", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const t = Math.max(0, localTick);
      if (prop === "scale") {
        c.transform.scaleX = removeKeyframe(c.transform.scaleX, t);
        c.transform.scaleY = removeKeyframe(c.transform.scaleY, t);
      } else if (prop === "rotation") {
        c.transform.rotation = removeKeyframe(c.transform.rotation, t);
      } else if (prop === "opacity") {
        c.opacity = removeKeyframe(c.opacity, t);
      } else if (prop === "x") {
        c.transform.x = removeKeyframe(c.transform.x, t);
      } else {
        c.transform.y = removeKeyframe(c.transform.y, t);
      }
    }),

  /**
   * Reubica el keyframe de una propiedad de `fromTick` a `toTick` (ticks locales
   * al clip). Para escala mueve scaleX e scaleY a la par.
   */
  moveClipKeyframe: (clipId: Id, prop: "scale" | "rotation" | "opacity" | "x" | "y", fromTick: Ticks, toTick: Ticks) =>
    command("Mover keyframe", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const to = Math.max(0, toTick);
      if (prop === "scale") {
        c.transform.scaleX = moveKeyframe(c.transform.scaleX, fromTick, to);
        c.transform.scaleY = moveKeyframe(c.transform.scaleY, fromTick, to);
      } else if (prop === "rotation") {
        c.transform.rotation = moveKeyframe(c.transform.rotation, fromTick, to);
      } else if (prop === "opacity") {
        c.opacity = moveKeyframe(c.opacity, fromTick, to);
      } else if (prop === "x") {
        c.transform.x = moveKeyframe(c.transform.x, fromTick, to);
      } else {
        c.transform.y = moveKeyframe(c.transform.y, fromTick, to);
      }
    }),

  /** Cambia la curva de easing del keyframe en `localTick` de una propiedad. */
  setClipKeyframeEasing: (clipId: Id, prop: "scale" | "rotation" | "opacity" | "x" | "y", localTick: Ticks, easing: Easing) =>
    command("Curva del keyframe", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      if (prop === "scale") {
        c.transform.scaleX = setKeyframeEasing(c.transform.scaleX, localTick, easing);
        c.transform.scaleY = setKeyframeEasing(c.transform.scaleY, localTick, easing);
      } else if (prop === "rotation") {
        c.transform.rotation = setKeyframeEasing(c.transform.rotation, localTick, easing);
      } else if (prop === "opacity") {
        c.opacity = setKeyframeEasing(c.opacity, localTick, easing);
      } else if (prop === "x") {
        c.transform.x = setKeyframeEasing(c.transform.x, localTick, easing);
      } else {
        c.transform.y = setKeyframeEasing(c.transform.y, localTick, easing);
      }
    }),

  /* --- audio --- */

  /** Ajusta el volumen (ganancia estática) de un clip. */
  setClipVolume: (clipId: Id, value: number) =>
    command("Volumen del clip", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      c.volume = makeStatic(Math.max(0, Math.min(4, value)));
    }),

  /** Silencia o reactiva un clip concreto. */
  setClipMuted: (clipId: Id, muted: boolean) =>
    command(muted ? "Silenciar clip" : "Activar clip", (d) => {
      const c = d.clips[clipId];
      if (c) c.muted = muted;
    }),

  /** Define las rampas de fade in/out (en ticks) de un clip. */
  setClipFades: (clipId: Id, fadeInTick: Ticks, fadeOutTick: Ticks) =>
    command("Fundido de audio", (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const dur = clipDuration(c);
      c.fadeInTick = Math.max(0, Math.min(fadeInTick, dur));
      c.fadeOutTick = Math.max(0, Math.min(fadeOutTick, dur));
    }),

  /** Volumen de toda una pista (multiplica al de cada clip). */
  setTrackVolume: (trackId: Id, value: number) =>
    command("Volumen de pista", (d) => {
      const t = d.tracks[trackId];
      if (t) t.volume = Math.max(0, Math.min(4, value));
    }),

  /** Mute/unmute de una pista entera. */
  setTrackMuted: (trackId: Id, muted: boolean) =>
    command(muted ? "Silenciar pista" : "Activar pista", (d) => {
      const t = d.tracks[trackId];
      if (t) t.muted = muted;
    }),

  /** Solo de pista: al activarlo, solo suenan las pistas en solo. */
  setTrackSolo: (trackId: Id, solo: boolean) =>
    command(solo ? "Solo de pista" : "Quitar solo", (d) => {
      const t = d.tracks[trackId];
      if (t) t.solo = solo;
    }),

  /**
   * Separa el audio de un clip de video a su propia pista de audio. El clip de
   * video se queda mudo y se crea un clip de audio espejo (mismo asset, mismo
   * recorte y posición) en una pista de audio, creándola si hace falta.
   */
  detachAudio: (videoClipId: Id) =>
    command("Separar audio", (d) => {
      const vc = d.clips[videoClipId];
      if (!vc) return;
      const asset = d.assets[vc.assetId];
      if (!asset || asset.kind !== "video" || !asset.hasAudio) return;

      // localizar (o crear) una pista de audio
      let audioTrackId = d.project.trackIds.find(
        (id) => d.tracks[id]?.kind === "audio",
      );
      if (!audioTrackId) {
        audioTrackId = newId();
        d.tracks[audioTrackId] = {
          id: audioTrackId, kind: "audio", name: "Audio 1",
          zIndex: d.project.trackIds.length,
          muted: false, locked: false, hidden: false,
          volume: 1, solo: false, clipIds: [],
        };
        d.project.trackIds.push(audioTrackId);
      }

      const aId = newId();
      d.clips[aId] = {
        id: aId,
        assetId: vc.assetId,
        trackId: audioTrackId,
        startTick: vc.startTick,
        inTick: vc.inTick,
        outTick: vc.outTick,
        speed: vc.speed,
        opacity: makeStatic(1),
        blendMode: "normal",
        transform: defaultTransform(),
        effects: [],
        ...defaultClipAudio(),
      };
      const at = d.tracks[audioTrackId];
      at.clipIds.push(aId);
      at.clipIds.sort((a, b) => d.clips[a].startTick - d.clips[b].startTick);

      // el clip de video queda mudo para no oírse dos veces
      vc.muted = true;
    }),

  /* --- transiciones --- */

  /**
   * Crea (o reemplaza) una transición entre un clip y el siguiente de su pista.
   * La transición se solapa: durante sus últimos `durationTick`, el clip saliente
   * se mezcla con el entrante. Si los clips no son adyacentes, no hace nada.
   */
  addTransition: (fromClipId: Id, type: string, durationTick: Ticks) =>
    command("Añadir transición", (d) => {
      const from = d.clips[fromClipId];
      if (!from) return;
      const track = d.tracks[from.trackId];
      if (!track) return;
      const idx = track.clipIds.indexOf(fromClipId);
      const toClipId = track.clipIds[idx + 1];
      if (!toClipId) return; // no hay clip siguiente
      // límite: la transición no puede durar más que el menor de los dos clips
      const to = d.clips[toClipId];
      const fromDur = Math.round((from.outTick - from.inTick) / from.speed);
      const toDur = Math.round((to.outTick - to.inTick) / to.speed);
      const dur = Math.max(1, Math.min(durationTick, Math.floor(Math.min(fromDur, toDur) / 2)));

      // elimina cualquier transición previa entre estos dos clips
      for (const [tid, tr] of Object.entries(d.transitions)) {
        if (tr.fromClipId === fromClipId && tr.toClipId === toClipId) delete d.transitions[tid];
      }
      const id = newId();
      d.transitions[id] = { id, type, fromClipId, toClipId, durationTick: dur, params: {} };
    }),

  setTransitionType: (transitionId: Id, type: string) =>
    command("Tipo de transición", (d) => {
      const tr = d.transitions[transitionId];
      if (tr) tr.type = type;
    }),

  setTransitionDuration: (transitionId: Id, durationTick: Ticks) =>
    command("Duración de transición", (d) => {
      const tr = d.transitions[transitionId];
      if (tr) tr.durationTick = Math.max(1, durationTick);
    }),

  removeTransition: (transitionId: Id) =>
    command("Eliminar transición", (d) => {
      delete d.transitions[transitionId];
    }),

  /* --- subtítulos --- */

  addCaption: (startTick: Ticks, endTick: Ticks, text: string) =>
    command("Añadir subtítulo", (d) => {
      const id = newId();
      d.captions[id] = { id, startTick, endTick, text };
    }),

  updateCaption: (id: Id, patch: Partial<Omit<CaptionCue, "id">>) =>
    command("Editar subtítulo", (d) => {
      const cue = d.captions[id];
      if (cue) Object.assign(cue, patch);
    }),

  /**
   * Aplica un override parcial de estilo a un subtítulo concreto (color, tamaño,
   * posición, etc.), conservando el resto del estilo global. Si `patch` deja el
   * override vacío, lo elimina para que el cue vuelva a usar el estilo global.
   */
  setCaptionStyle: (id: Id, patch: Partial<SubtitleStyle>) =>
    command("Estilo de subtítulo", (d) => {
      const cue = d.captions[id];
      if (!cue) return;
      cue.style = { ...(cue.style ?? {}), ...patch };
      if (Object.keys(cue.style).length === 0) delete cue.style;
    }),

  /** Quita el estilo personalizado de un subtítulo (vuelve al estilo global). */
  clearCaptionStyle: (id: Id) =>
    command("Restablecer estilo", (d) => {
      const cue = d.captions[id];
      if (cue) delete cue.style;
    }),

  removeCaption: (id: Id) =>
    command("Eliminar subtítulo", (d) => {
      delete d.captions[id];
    }),

  /** Reemplaza todos los subtítulos (lo usará la transcripción automática). */
  setCaptions: (cues: CaptionCue[]) =>
    command("Subtítulos automáticos", (d) => {
      d.captions = {};
      for (const cue of cues) d.captions[cue.id] = cue;
    }),

  clearCaptions: () =>
    command("Eliminar todos los subtítulos", (d) => {
      d.captions = {};
    }),

  setSubtitleStyle: (patch: Partial<SubtitleStyle>) =>
    command("Estilo de subtítulos", (d) => {
      Object.assign(d.project.subtitleStyle, patch);
    }),
};

/* ─────────────────────────  Store con historial  ──────────────────────── */

export class EditorStore {
  private state: ProjectState;
  private past: ProjectState[] = [];
  private future: ProjectState[] = [];
  private listeners = new Set<() => void>();
  private limit: number;

  constructor(initial: ProjectState, historyLimit = 200) {
    this.state = initial;
    this.limit = historyLimit;
  }

  getState(): ProjectState {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispatch(cmd: Command): void {
    const next = cmd.run(this.state);
    if (next === this.state) return; // el comando no cambió nada
    this.past.push(this.state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.state = next;
    this.emit();
  }

  undo(): void {
    const prev = this.past.pop();
    if (prev === undefined) return;
    this.future.push(this.state);
    this.state = prev;
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (next === undefined) return;
    this.past.push(this.state);
    this.state = next;
    this.emit();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/* ────────────────────────────  Estado inicial  ────────────────────────── */

export function createEmptyProject(
  opts?: Partial<Pick<Project, "name" | "width" | "height" | "fps">>,
): ProjectState {
  const project: Project = {
    id: newId(),
    name: opts?.name ?? "Proyecto sin título",
    width: opts?.width ?? 1920,
    height: opts?.height ?? 1080,
    fps: opts?.fps ?? 30,
    durationTick: 0,
    trackIds: [],
    subtitleStyle: defaultSubtitleStyle(),
  };
  return { project, assets: {}, tracks: {}, clips: {}, transitions: {}, captions: {} };
}
