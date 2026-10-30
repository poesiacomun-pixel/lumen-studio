import { defineConfig, type Plugin } from "vite";

// COOP + COEP habilitan el "cross-origin isolation", requisito para
// SharedArrayBuffer (que usa onnxruntime/Whisper para multihilo) y para mover
// frames entre workers sin copias. Usamos COEP "credentialless" en vez de
// "require-corp" para poder descargar el modelo de Whisper desde Hugging Face
// sin que el aislamiento bloquee esos recursos de otro origen.
// IMPORTANTE: en producción hay que enviar estos MISMOS headers desde el
// servidor o CDN; aquí solo cubren el servidor de desarrollo.
const crossOriginIsolation: Plugin = {
  name: "cross-origin-isolation",
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      next();
    });
  },
};

export default defineConfig({
  plugins: [crossOriginIsolation],
  worker: { format: "es" },
  build: { target: "es2022" },
  // Transformers.js trae binarios wasm de onnxruntime; excluirlo del
  // prebundle de Vite evita problemas de resolución de esos assets.
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
