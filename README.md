# Lumen Studio

Editor de video que funciona completo en el navegador: timeline multipista, títulos y subtítulos, transiciones, efectos, keyframes y exportación a MP4, sin servidor de procesamiento. Usa WebCodecs para decodificar y codificar video, Web Audio para el audio y OPFS para guardar los proyectos en el propio navegador.

## Funciones

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

## Estructura

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

## Cómo ejecutarlo

Requisitos: Node.js 18 o superior y un navegador con WebCodecs (el proyecto se ha probado en Chrome).

```bash
cd lumen-editor
npm install
npm run dev
```

`npm install` regenera `node_modules` para tu sistema; no copies esa carpeta entre equipos. El servidor de desarrollo envía los encabezados COOP/COEP que necesita la transcripción multihilo; en producción, el servidor debe enviar los mismos.

Para compilar: `npm run build` (revisa los tipos con `tsc` y genera `dist/`).

## Pendientes

- Cambiar la duración de una transición arrastrando el borde del marcador (hoy se hace por menú).
- Miniaturas también para los clips de video (las imágenes ya las tienen).
- Mantener la proporción al escalar con una tecla modificadora.
- (Opcional) Suavizar el acomodo visual al arrancar.
- Validar en el navegador los cambios recientes marcados como pendientes en `FASE_AUDIO.md`.
