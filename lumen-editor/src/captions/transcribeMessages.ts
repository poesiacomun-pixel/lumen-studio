// Protocolo entre el hilo principal y el worker de transcripción (Whisper).
// El audio ya viaja decodificado a 16 kHz mono (Float32) para que Whisper lo
// procese directamente.

export interface ToAsr {
  type: "transcribe";
  audio: Float32Array; // PCM mono 16 kHz
  model: string; // p.ej. "onnx-community/whisper-base"
  language?: string; // p.ej. "spanish"; ausente = autodetección
  task?: "transcribe" | "translate"; // "transcribe" = mismo idioma; "translate" = a inglés
}

export interface AsrSegment {
  text: string;
  start: number; // segundos
  end: number; // segundos
}

export type FromAsr =
  | { type: "progress"; phase: "model" | "transcribing"; progress: number; file?: string }
  | { type: "result"; segments: AsrSegment[] }
  | { type: "error"; message: string };
