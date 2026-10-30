import { mixProjectAudio } from "./audioMixer";
import { clipDuration } from "../model/types";
import type { SubtitleStyle, ProjectState } from "../model/types";
import type { SubtitleCueMsg } from "../media/playbackMessages";
import type { ExportRequest, ExportLayer, ExportTextLayer, ExportTransition, FromExport } from "./exportMessages";

export interface ExportProgress {
  phase: "audio-prep" | "video" | "audio" | "muxing" | "done";
  progress: number;
  label: string;
}

export class Exporter {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      new URL("./exportWorker.ts", import.meta.url),
      { type: "module" },
    );
  }

  /**
   * Exporta el proyecto completo: todas las capas de video se componen por
   * z-index (igual que el visor) y todo el audio se mezcla. `style`/`cues`
   * controlan los subtítulos quemados.
   */
  async export(
    state: ProjectState,
    style: SubtitleStyle,
    cues: SubtitleCueMsg[],
    fps: number,
    onProgress: (p: ExportProgress) => void,
  ): Promise<Blob> {
    onProgress({ phase: "audio-prep", progress: 0, label: "Mezclando audio…" });
    const audio = await mixProjectAudio(state, state.project.durationTick);

    // pre-roll por clip (clip "to" de una transición se decodifica antes)
    const preRoll: Record<string, number> = {};
    for (const tr of Object.values(state.transitions)) {
      preRoll[tr.toClipId] = Math.max(preRoll[tr.toClipId] ?? 0, tr.durationTick);
    }

    // construye las capas de video y de texto (pistas de video no ocultas)
    const layers: ExportLayer[] = [];
    const textLayers: ExportTextLayer[] = [];
    for (const trackId of state.project.trackIds) {
      const track = state.tracks[trackId];
      if (!track || (track.kind !== "video" && track.kind !== "text" && track.kind !== "image") || track.hidden) continue;
      for (const clipId of track.clipIds) {
        const clip = state.clips[clipId];
        if (!clip) continue;
        if (clip.text) {
          textLayers.push({
            clipId: clip.id,
            zIndex: track.zIndex,
            startTick: clip.startTick,
            endTick: clip.startTick + clipDuration(clip),
            content: clip.text,
            transform: clip.transform,
            opacity: clip.opacity,
            blendMode: clip.blendMode,
          });
          continue;
        }
        const asset = state.assets[clip.assetId];
        if (!asset || (asset.kind !== "video" && asset.kind !== "image")) continue;
        layers.push({
          clipId: clip.id,
          opfsPath: asset.opfsPath,
          codec: asset.codec ?? "",
          width: asset.width ?? state.project.width,
          height: asset.height ?? state.project.height,
          zIndex: track.zIndex,
          clipStartTick: clip.startTick,
          clipInTick: clip.inTick,
          clipOutTick: clip.outTick,
          speed: clip.speed,
          preRollTick: preRoll[clip.id] ?? 0,
          transform: clip.transform,
          opacity: clip.opacity,
          blendMode: clip.blendMode,
          effectId: clip.effectId,
          isImage: asset.kind === "image",
        });
      }
    }

    // transiciones a quemar
    const transitions: ExportTransition[] = [];
    for (const tr of Object.values(state.transitions)) {
      const to = state.clips[tr.toClipId];
      if (!to) continue;
      transitions.push({
        type: tr.type,
        fromClipId: tr.fromClipId,
        toClipId: tr.toClipId,
        boundaryTick: to.startTick,
        durationTick: tr.durationTick,
      });
    }

    return new Promise<Blob>((resolve, reject) => {
      const onMsg = (e: MessageEvent<FromExport>) => {
        const m = e.data;
        if (m.type === "progress") {
          const label =
            m.phase === "video"
              ? `Codificando video… ${m.progress}%`
              : m.phase === "audio"
                ? `Codificando audio… ${m.progress}%`
                : "Empaquetando MP4…";
          onProgress({ phase: m.phase, progress: m.progress, label });
        } else if (m.type === "done") {
          cleanup();
          onProgress({ phase: "done", progress: 100, label: "Listo" });
          resolve(new Blob([m.buffer], { type: "video/mp4" }));
        } else if (m.type === "error") {
          cleanup();
          reject(new Error(m.message));
        }
      };
      const cleanup = () => this.worker.removeEventListener("message", onMsg);
      this.worker.addEventListener("message", onMsg);

      const req: ExportRequest = {
        type: "export",
        width: state.project.width,
        height: state.project.height,
        fps,
        durationTick: state.project.durationTick,
        layers,
        textLayers,
        transitions,
        cues,
        style,
        bitrate: 8_000_000,
        audio: audio ?? undefined,
      };
      const transfer = audio ? audio.channels.map((c) => c.buffer) : [];
      this.worker.postMessage(req, transfer);
    });
  }
}
