import { pipeline } from "@huggingface/transformers";
import type { ToAsr, FromAsr, AsrSegment } from "./transcribeMessages";

const sw = self as unknown as {
  postMessage(msg: FromAsr): void;
  onmessage: ((e: MessageEvent<ToAsr>) => void) | null;
};

// El pipeline se carga una sola vez (los pesos se cachean en el navegador).
// No fijamos device: dejamos que Transformers.js elija WebGPU o WASM según el
// equipo, que es lo más robusto en móvil.
let transcriber: unknown = null;
let loadedModel = "";

interface RawChunk {
  text: string;
  timestamp: [number, number | null];
}
interface RawOutput {
  text: string;
  chunks?: RawChunk[];
}
type TranscriberFn = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<RawOutput>;

function post(msg: FromAsr): void {
  sw.postMessage(msg);
}

async function run(msg: ToAsr): Promise<void> {
  try {
    if (!transcriber || loadedModel !== msg.model) {
      const big = /small|medium|large/.test(msg.model);
      const pipeOpts: Record<string, unknown> = {
        progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
          if (p?.status === "progress") {
            post({
              type: "progress",
              phase: "model",
              progress: Math.round(p.progress ?? 0),
              file: p.file,
            });
          }
        },
      };
      // pesos cuantizados solo para los modelos grandes (viabilidad en navegador)
      if (big) pipeOpts.dtype = { encoder_model: "fp32", decoder_model_merged: "q4" };
      transcriber = await pipeline(
        "automatic-speech-recognition",
        msg.model,
        pipeOpts as Parameters<typeof pipeline>[2],
      );
      loadedModel = msg.model;
    }

    post({ type: "progress", phase: "transcribing", progress: 0 });

    const fn = transcriber as TranscriberFn;
    const output = await fn(msg.audio, {
      // Timestamps a nivel de SEGMENTO/frase. NO usamos "word": requiere que el
      // modelo se haya exportado con cross-attentions (output_attentions=True), y
      // los modelos onnx-community/whisper-* públicos no lo traen -> lanzaban
      // "Model outputs must contain cross attentions". Troceamos nosotros abajo.
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: msg.language,
      // "transcribe" mantiene el idioma original; sin esto Whisper a veces
      // traduce al inglés (task por defecto ambiguo en algunos modelos).
      task: msg.task ?? "transcribe",
    });

    const segments = buildSegments(output.chunks ?? [], detectSpeechStart(msg.audio));
    post({ type: "result", segments });
  } catch (e) {
    post({ type: "error", message: (e as Error).message });
  }
}

/**
 * Encuentra el segundo en el que empieza la voz, midiendo la energía (RMS) en
 * ventanas cortas. Whisper suele reportar el primer segmento desde 0 aunque haya
 * silencio inicial; con esto desplazamos el primer subtítulo a donde de verdad
 * arranca el habla. Devuelve 0 si no detecta silencio inicial claro.
 */
const SAMPLE_RATE = 16000;
function detectSpeechStart(audio: Float32Array): number {
  const win = Math.floor(SAMPLE_RATE * 0.02); // ventanas de 20 ms
  if (win <= 0 || audio.length === 0) return 0;
  // umbral relativo al pico del audio (robusto ante volúmenes distintos)
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    const a = Math.abs(audio[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-4) return 0; // audio prácticamente mudo
  const thresh = peak * 0.08; // 8% del pico = empieza a haber voz
  let voicedWindows = 0;
  for (let start = 0; start + win <= audio.length; start += win) {
    let sum = 0;
    for (let i = start; i < start + win; i++) sum += audio[i] * audio[i];
    const rms = Math.sqrt(sum / win);
    if (rms >= thresh) {
      voicedWindows++;
      // exige 3 ventanas seguidas con energía (60 ms) para evitar chasquidos
      if (voicedWindows >= 3) {
        const speechSample = start - win * 2; // inicio de la racha
        return Math.max(0, speechSample / SAMPLE_RATE);
      }
    } else {
      voicedWindows = 0;
    }
  }
  return 0;
}

/**
 * Trocea los segmentos de frase de Whisper en subtítulos cortos tipo CapCut.
 * Como solo tenemos el tiempo de inicio/fin de toda la frase (no por palabra),
 * repartimos ese intervalo entre las sub-líneas de forma proporcional al número
 * de caracteres de cada una. Reglas de corte por sub-línea:
 *  - ~42 caracteres o ~7 palabras como máximo,
 *  - se prefiere cortar tras puntuación fuerte (. ? ! … , ;) si ya hay algo.
 */
const MAX_CHARS = 42;
const MAX_WORDS = 7;

function splitIntoLines(text: string): string[] {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length > 0) { lines.push(cur.join(" ")); cur = []; }
  };
  for (const w of words) {
    const tentative = cur.length === 0 ? w : cur.join(" ") + " " + w;
    cur.push(w);
    const endsPunct = /[.?!…,;:]$/.test(w);
    if (tentative.length >= MAX_CHARS || cur.length >= MAX_WORDS || endsPunct) {
      flush();
    }
  }
  flush();
  return lines;
}

function buildSegments(chunks: RawChunk[], speechStart = 0): AsrSegment[] {
  const out: AsrSegment[] = [];
  let first = true;
  for (const c of chunks) {
    const text = c.text.trim();
    if (text.length === 0) continue;
    let start = c.timestamp[0] ?? (out.length ? out[out.length - 1].end : 0);
    const end = c.timestamp[1] ?? start + Math.max(1, text.length * 0.06);
    // El primer segmento de Whisper suele venir desde ~0 aunque la voz empiece
    // después: si detectamos un inicio de voz más tardío, lo usamos (sin pasarnos
    // del final del segmento ni dejar menos de 0.3 s de duración).
    if (first) {
      first = false;
      if (speechStart > start && speechStart < end - 0.3) start = speechStart;
    }
    const span = Math.max(0.3, end - start);

    const lines = splitIntoLines(text);
    if (lines.length <= 1) {
      out.push({ text, start, end: Math.max(end, start + 0.3) });
      continue;
    }
    // Reparte el intervalo proporcional a la longitud de cada sub-línea.
    const totalChars = lines.reduce((n, l) => n + l.length, 0) || 1;
    let cursor = start;
    for (const line of lines) {
      const frac = line.length / totalChars;
      const lineEnd = Math.min(end, cursor + span * frac);
      out.push({ text: line, start: cursor, end: Math.max(lineEnd, cursor + 0.3) });
      cursor = lineEnd;
    }
  }
  return out;
}

sw.onmessage = (e: MessageEvent<ToAsr>) => {
  if (e.data.type === "transcribe") void run(e.data);
};
