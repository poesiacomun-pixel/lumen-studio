# Lumen Studio

[English](#english) | [Español](#español)

## English

A video editor that runs entirely in the browser: multitrack timeline, titles and subtitles, transitions, effects, keyframes, and MP4 export, with no processing server. It uses WebCodecs to decode and encode video, Web Audio for sound, and OPFS to store projects in the browser itself.

### Features

- Import video, audio, and images.
- Multitrack timeline with video, image, audio, title, and subtitle tracks; drag clips between tracks, trim them, and snap them into place.
- Viewer with handles to move, scale, and rotate clips, images, and titles.
- Keyframes with per-keyframe easing, visible and draggable on the timeline.
- Titles with style presets, a font catalog, and text outlines.
- Subtitles editable on the timeline, with per-subtitle styling and automatic in-browser transcription using Whisper (Transformers.js).
- A catalog of 38 video transitions and color effects (black and white, vintage, cinematic, color tones, aesthetic).
- Audio with waveforms, mute/solo, and volume; all tracks are mixed on export.
- MP4 export (H.264 + AAC) with a "Save as" dialog.
- Undo/redo and keyboard shortcuts.
- Projects screen, with projects saved in the browser (OPFS).

### Structure

```
LumenCreator/
├── lumen-editor/                    Main app (Vite + TypeScript)
│   ├── src/
│   │   ├── captions/                Titles, subtitles, and transcription (Whisper)
│   │   ├── export/                  MP4 export and audio mixing
│   │   ├── media/                   Import, decoding, playback, and compositor
│   │   ├── model/                   Types, time, animation, transitions, effects, and fonts
│   │   ├── runtime/                 Browser capability detection
│   │   ├── state/                   Editor state and commands
│   │   ├── storage/                 Project persistence in OPFS
│   │   ├── timeline/                Multitrack timeline
│   │   ├── types/                   mp4box types
│   │   ├── ui/                      Inspector, viewer, projects screen, and icons
│   │   └── main.ts                  Entry point
│   ├── FASE_AUDIO.md                Phase-by-phase development log (in Spanish)
│   └── index.html
└── Lumen_Editor_(standalone).html   Bundled single-file HTML version
```

### Getting started

Requirements: Node.js 18 or later and a browser with WebCodecs support (the project has been tested in Chrome).

```bash
cd lumen-editor
npm install
npm run dev
```

`npm install` rebuilds `node_modules` for your system; don't copy that folder between machines. The dev server sends the COOP/COEP headers that multithreaded transcription needs; in production, your server must send the same headers.

To build: `npm run build` (type-checks with `tsc` and outputs `dist/`).

### Roadmap

- Change a transition's duration by dragging the edge of its marker (currently done from a menu).
- Thumbnails for video clips too (images already have them).
- Keep the aspect ratio when scaling with a modifier key.
- (Optional) Smooth out the visual layout shift on startup.
- Validate in the browser the recent changes marked as pending in `FASE_AUDIO.md`.

---

## Español

Editor de video que funciona completo en el navegador: timeline multipista, títulos y subtítulos, transiciones, efectos, keyframes y exportación a MP4, sin servidor de procesamiento. Usa WebCodecs para decodificar y codificar video, Web Audio para el audio y OPFS para guardar los proyectos en el propio navegador.

### Funciones

- Importación de video, audio e imágenes.
- Timeline multipista con pistas de video, imagen, audio, títulos y subtítulos; arrastre entre pistas, recorte y *snapping*.
- Visor con tiradores para mover, escalar y rotar clips, imágenes y títulos.
- Keyframes con *easing* por keyframe, visibles y arrastrables en la timeline.
- Títulos con plantillas de estilo, catálogo de tipografías y contorno.
- Subtítulos editables en la timeline, con estilo por subtítulo y transcripción automática en el navegador con Whisper (Transformers.js).
- Catálogo de 38 transiciones de video y efectos de color (blanco y negro, vintage, cinematográfico, tonos de color, estético).
- Audio con formas de onda, mute/solo y volumen; mezcla de todas las pistas al exportar.
- Exportación a MP4 (H.264 + AAC) con diálogo "Guardar como".
- Deshacer/rehacer y atajos de teclado.
- Pantalla de proyectos, guardados en el navegador (OPFS).

### Estructura

```
LumenCreator/
├── lumen-editor/                    Aplicación principal (Vite + TypeScript)
│   ├── src/
│   │   ├── captions/                Títulos, subtítulos y transcripción (Whisper)
│   │   ├── export/                  Exportación a MP4 y mezcla de audio
│   │   ├── media/                   Importación, decodificación, reproducción y compositor
│   │   ├── model/                   Tipos, tiempo, animación, transiciones, efectos y fuentes
│   │   ├── runtime/                 Detección de capacidades del navegador
│   │   ├── state/                   Estado del editor y comandos
│   │   ├── storage/                 Persistencia de proyectos en OPFS
│   │   ├── timeline/                Timeline multipista
│   │   ├── types/                   Tipos de mp4box
│   │   ├── ui/                      Inspector, visor, pantalla de proyectos e iconos
│   │   └── main.ts                  Punto de entrada
│   ├── FASE_AUDIO.md                Bitácora de avance por fases
│   └── index.html
└── Lumen_Editor_(standalone).html   Versión empaquetada en un solo archivo HTML
```

### Cómo ejecutarlo

Requisitos: Node.js 18 o superior y un navegador con WebCodecs (el proyecto se ha probado en Chrome).

```bash
cd lumen-editor
npm install
npm run dev
```

`npm install` regenera `node_modules` para tu sistema; no copies esa carpeta entre equipos. El servidor de desarrollo envía los encabezados COOP/COEP que necesita la transcripción multihilo; en producción, el servidor debe enviar los mismos.

Para compilar: `npm run build` (revisa los tipos con `tsc` y genera `dist/`).

### Pendientes

- Cambiar la duración de una transición arrastrando el borde del marcador (hoy se hace por menú).
- Miniaturas también para los clips de video (las imágenes ya las tienen).
- Mantener la proporción al escalar con una tecla modificadora.
- (Opcional) Suavizar el acomodo visual al arrancar.
- Validar en el navegador los cambios recientes marcados como pendientes en `FASE_AUDIO.md`.
