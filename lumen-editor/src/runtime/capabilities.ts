// Detección de capacidades en tiempo de ejecución. En móvil esto NO es
// opcional: decide si el dispositivo puede correr el editor y con qué motor
// de render. El UA solo da pistas; la verdad la da la detección de features.

export type RendererKind = "webgpu" | "webgl2" | "none";

export interface Capabilities {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  offscreenCanvas: boolean;
  opfs: boolean;
  webcodecs: { video: boolean; audio: boolean };
  webgpu: boolean;
  webgl2: boolean;
  renderer: RendererKind;
  isAndroid: boolean;
  isChromium: boolean;
  supported: boolean; // ¿se puede correr el editor aquí?
  blockers: string[]; // razones por las que no, si aplica
}

// WebGPU aún no está en los tipos por defecto de TS; tipamos lo mínimo aquí.
// Más adelante conviene añadir el paquete @webgpu/types para el compositor.
type MinimalGPU = { requestAdapter(): Promise<unknown> };

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: MinimalGPU }).gpu;
  if (!gpu) return false;
  try {
    // navigator.gpu puede existir pero no devolver adaptador (GPU no apta).
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

export async function detectCapabilities(): Promise<Capabilities> {
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isChromium =
    /Chrome|Chromium|Edg|SamsungBrowser/i.test(ua) && !/Firefox|FxiOS/i.test(ua);

  const crossOriginIsolated = self.crossOriginIsolated === true;
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const offscreenCanvas = typeof OffscreenCanvas !== "undefined";
  const opfs = !!navigator.storage?.getDirectory;

  const webcodecs = {
    video:
      typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined",
    audio:
      typeof AudioDecoder !== "undefined" && typeof AudioEncoder !== "undefined",
  };

  const webgpu = await hasWebGPU();
  const webgl2 = hasWebGL2();
  const renderer: RendererKind = webgpu ? "webgpu" : webgl2 ? "webgl2" : "none";

  const blockers: string[] = [];
  if (!webcodecs.video)
    blockers.push("Este navegador no soporta WebCodecs (usa Chrome en Android).");
  if (renderer === "none")
    blockers.push("No hay WebGPU ni WebGL2 para el compositor.");
  if (!opfs) blockers.push("El almacenamiento OPFS no está disponible.");
  if (!crossOriginIsolated)
    blockers.push("La página no está aislada (faltan headers COOP/COEP).");

  return {
    crossOriginIsolated, sharedArrayBuffer, offscreenCanvas, opfs,
    webcodecs, webgpu, webgl2, renderer, isAndroid, isChromium,
    supported: blockers.length === 0,
    blockers,
  };
}
