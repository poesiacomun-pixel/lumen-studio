import type { ProjectState, Clip, Track, Asset } from "../model/types";
import { defaultClipAudio } from "../model/types";
import { defaultTransform, makeStatic } from "../model/animated";

// El estado del proyecto es JSON puro (los medios no viven aquí, sino en OPFS),
// así que IndexedDB lo guarda y restaura tal cual mediante structured clone.
//
// MULTI-PROYECTO: cada proyecto se guarda por su project.id en el store
// "projects". Además mantenemos un índice ligero de metadatos en "meta" para
// pintar la pantalla de inicio sin tener que cargar cada proyecto entero.

const DB_NAME = "lumen";
const STORE = "projects"; // estado completo, clave = project.id
const META = "meta"; // metadatos ligeros, clave = project.id
const LEGACY_KEY = "current"; // proyecto único del esquema anterior

/** Metadatos ligeros de un proyecto, para la galería de inicio. */
export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number; // epoch ms
  width: number;
  height: number;
  durationTick: number;
  thumb?: string; // dataURL opcional (preview estático)
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function migrate(state: ProjectState): ProjectState {
  // colecciones de nivel superior que pudieran faltar en esquemas anteriores
  if (state.transitions === undefined) state.transitions = {};
  if (state.captions === undefined) state.captions = {};

  for (const clip of Object.values(state.clips) as Clip[]) {
    if (clip.volume === undefined) clip.volume = defaultClipAudio().volume;
    if (clip.muted === undefined) clip.muted = false;
    if (clip.fadeInTick === undefined) clip.fadeInTick = 0;
    if (clip.fadeOutTick === undefined) clip.fadeOutTick = 0;
    if (clip.opacity === undefined) clip.opacity = makeStatic(1);
    if (clip.blendMode === undefined) clip.blendMode = "normal";
    if (clip.transform === undefined) clip.transform = defaultTransform();
    if (clip.effects === undefined) clip.effects = [];
    // `text` es opcional por diseño: ausente = clip normal (no de texto).
  }
  for (const track of Object.values(state.tracks) as Track[]) {
    if (track.volume === undefined) track.volume = 1;
    if (track.solo === undefined) track.solo = false;
    if (track.hidden === undefined) track.hidden = false;
    if (track.locked === undefined) track.locked = false;
  }

  // Migración: los títulos que vivían en pistas de video pasan a una pista de
  // texto dedicada, para que no se mezclen ni se superpongan con el video.
  const titleClipIds = (Object.values(state.clips) as Clip[])
    .filter((c) => c.text)
    .map((c) => c.id);
  if (titleClipIds.length > 0) {
    // ¿algún título está en una pista que no es de texto?
    const needsMigration = titleClipIds.some((id) => {
      const c = state.clips[id];
      return state.tracks[c.trackId]?.kind !== "text";
    });
    if (needsMigration) {
      // reutiliza o crea la pista de texto
      let textTrack = (Object.values(state.tracks) as Track[]).find((t) => t.kind === "text");
      if (!textTrack) {
        const tid = "text-track-" + Math.random().toString(36).slice(2, 9);
        textTrack = {
          id: tid, kind: "text", name: "Títulos",
          zIndex: 50, muted: false, locked: false, hidden: false,
          volume: 1, solo: false, clipIds: [],
        };
        state.tracks[tid] = textTrack;
        state.project.trackIds.push(tid);
      }
      for (const id of titleClipIds) {
        const c = state.clips[id];
        const from = state.tracks[c.trackId];
        if (from && from.kind !== "text") {
          from.clipIds = from.clipIds.filter((x) => x !== id);
          c.trackId = textTrack.id;
          textTrack.clipIds.push(id);
        }
      }
      textTrack.clipIds.sort((a, b) => state.clips[a].startTick - state.clips[b].startTick);

      // evita solapes: empuja cada título tras el anterior si se pisaban
      let cursor = 0;
      for (const id of textTrack.clipIds) {
        const c = state.clips[id];
        const dur = c.outTick - c.inTick;
        if (c.startTick < cursor) c.startTick = cursor;
        cursor = c.startTick + dur;
      }
    }
  }

  // Migración: las imágenes que vivían en pistas de video pasan a una pista de
  // imagen dedicada, para que tengan su propia línea de tiempo.
  const imageAssetIds = new Set(
    (Object.values(state.assets) as Asset[]).filter((a) => a.kind === "image").map((a) => a.id),
  );
  if (imageAssetIds.size > 0) {
    const imageClipIds = (Object.values(state.clips) as Clip[])
      .filter((c) => !c.text && imageAssetIds.has(c.assetId))
      .map((c) => c.id);
    const needsImgMigration = imageClipIds.some((id) => {
      const c = state.clips[id];
      return state.tracks[c.trackId]?.kind !== "image";
    });
    if (needsImgMigration) {
      let imgTrack = (Object.values(state.tracks) as Track[]).find((t) => t.kind === "image");
      if (!imgTrack) {
        const tid = "image-track-" + Math.random().toString(36).slice(2, 9);
        imgTrack = {
          id: tid, kind: "image", name: "Imágenes",
          zIndex: 20, muted: false, locked: false, hidden: false,
          volume: 1, solo: false, clipIds: [],
        };
        state.tracks[tid] = imgTrack;
        state.project.trackIds.push(tid);
      }
      for (const id of imageClipIds) {
        const c = state.clips[id];
        const from = state.tracks[c.trackId];
        if (from && from.kind !== "image") {
          from.clipIds = from.clipIds.filter((x) => x !== id);
          c.trackId = imgTrack.id;
          imgTrack.clipIds.push(id);
        }
      }
      imgTrack.clipIds.sort((a, b) => state.clips[a].startTick - state.clips[b].startTick);
    }
  }

  return state;
}


/** Construye los metadatos ligeros a partir del estado completo. */
function metaFrom(state: ProjectState, thumb?: string): ProjectMeta {
  return {
    id: state.project.id,
    name: state.project.name,
    updatedAt: Date.now(),
    width: state.project.width,
    height: state.project.height,
    durationTick: state.project.durationTick,
    thumb,
  };
}

/**
 * Guarda (o actualiza) un proyecto por su id, junto con sus metadatos. El
 * thumb es opcional: si no se pasa, se conserva el que ya hubiera.
 */
export async function saveProject(state: ProjectState, thumb?: string): Promise<void> {
  const db = await openDB();
  try {
    // conserva el thumb anterior si no se provee uno nuevo
    let keepThumb = thumb;
    if (keepThumb === undefined) {
      keepThumb = await new Promise<string | undefined>((resolve) => {
        const tx = db.transaction(META, "readonly");
        const req = tx.objectStore(META).get(state.project.id);
        req.onsuccess = () => resolve((req.result as ProjectMeta | undefined)?.thumb);
        req.onerror = () => resolve(undefined);
      });
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, META], "readwrite");
      tx.objectStore(STORE).put(state, state.project.id);
      tx.objectStore(META).put(metaFrom(state, keepThumb), state.project.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Lista los metadatos de todos los proyectos, del más reciente al más viejo. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDB();
  try {
    return await new Promise<ProjectMeta[]>((resolve, reject) => {
      const tx = db.transaction(META, "readonly");
      const req = tx.objectStore(META).getAll();
      req.onsuccess = () => {
        const all = (req.result as ProjectMeta[]) ?? [];
        all.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Carga un proyecto por id (migrando su esquema si hace falta). */
export async function loadProjectById(id: string): Promise<ProjectState | null> {
  const db = await openDB();
  try {
    return await new Promise<ProjectState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const result = req.result as ProjectState | undefined;
        resolve(result ? migrate(result) : null);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Elimina un proyecto y sus metadatos. */
export async function deleteProject(id: string): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, META], "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.objectStore(META).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Migración del esquema anterior (un único proyecto bajo la clave "current").
 * Si existe, lo reinserta bajo su propio id y borra la clave vieja. Devuelve el
 * estado migrado para poder abrirlo directamente, o null si no había nada.
 */
export async function migrateLegacyProject(): Promise<ProjectState | null> {
  const db = await openDB();
  let legacy: ProjectState | null = null;
  try {
    legacy = await new Promise<ProjectState | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(LEGACY_KEY);
      req.onsuccess = () => resolve((req.result as ProjectState | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
  if (!legacy) return null;
  const migrated = migrate(legacy);
  await saveProject(migrated);
  // borra la clave vieja
  const db2 = await openDB();
  try {
    await new Promise<void>((resolve) => {
      const tx = db2.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(LEGACY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db2.close();
  }
  return migrated;
}
