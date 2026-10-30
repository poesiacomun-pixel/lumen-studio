import { extractMonoPCM16k } from "./audio";
import { secondsToTicks } from "../model/time";
import type { CaptionCue } from "../model/types";
import type { ToAsr, FromAsr } from "./transcribeMessages";

export interface TranscribeProgress {
  phase: "audio" | "model" | "transcribing" | "done";
  progress: number;
  label: string;
}

export interface TranscribeOptions {
  model?: string;
  language?: string;
}

/**
 * Orquesta la transcripción automática: decodifica el audio a 16 kHz mono en el
 * hilo principal y se lo pasa al worker de Whisper, que devuelve los segmentos.
 * Cada segmento se convierte en un CaptionCue listo para `setCaptions`.
 */
export class Transcriber {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      new URL("./transcribeWorker.ts", import.meta.url),
      { type: "module" },
    );
  }

  async transcribe(
    file: File,
    opts: TranscribeOptions,
    onProgress: (p: TranscribeProgress) => void,
  ): Promise<CaptionCue[]> {
    onProgress({ phase: "audio", progress: 0, label: "Extrayendo audio…" });
    const audio = await extractMonoPCM16k(file);

    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent<FromAsr>) => {
        const m = e.data;
        if (m.type === "progress") {
          if (m.phase === "model") {
            onProgress({
              phase: "model",
              progress: m.progress,
              label: `Descargando modelo… ${m.progress}%`,
            });
          } else {
            onProgress({ phase: "transcribing", progress: 0, label: "Transcribiendo…" });
          }
        } else if (m.type === "result") {
          cleanup();
          onProgress({ phase: "done", progress: 100, label: "Listo" });
          resolve(
            m.segments.map((s) => ({
              id: crypto.randomUUID(),
              startTick: secondsToTicks(s.start),
              endTick: secondsToTicks(s.end),
              text: s.text,
            })),
          );
        } else if (m.type === "error") {
          cleanup();
          reject(new Error(m.message));
        }
      };
      const cleanup = () => this.worker.removeEventListener("message", onMsg);
      this.worker.addEventListener("message", onMsg);

      const msg: ToAsr = {
        type: "transcribe",
        audio,
        model: opts.model ?? "onnx-community/whisper-base",
        language: opts.language,
        task: "transcribe",
      };
      // transferimos el buffer del audio para no copiarlo
      this.worker.postMessage(msg, [audio.buffer]);
    });
  }
}
