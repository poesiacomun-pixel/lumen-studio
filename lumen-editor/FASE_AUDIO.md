# Lumen Studio — Avance por fases

Editor de video web (WebCodecs + OPFS + Web Audio). Construido por fases
validadas con `tsc`. Acumula: UI fiel al diseño, audio completo, waveforms,
compositor de transformaciones, mezcla de audio, compositing multicapa
(reproducción y export), transiciones y texto/títulos.

## Cómo arrancar
```bash
npm install      # regenera node_modules para TU plataforma (imprescindible)
npm run dev      # servidor de desarrollo con headers COOP/COEP
```
> No copies `node_modules` entre Windows/Linux/Mac: los binarios de
> Vite/Rollup/esbuild son nativos por plataforma. Siempre `npm install` en destino.

## Diseño / UI
- Paleta fiel a la referencia (acento #6FB6AB, violeta #A39AC4, sage #A9BDB7,
  fondos #1A1A1E/#1E1E22/#151517, tipografía Inter).
- Shell de tres columnas: librería (Medios/Audio/Texto/Subtítulos), visor,
  inspector, timeline multipista.

## Audio
- `audioEngine.ts`: Web Audio, reloj maestro, mute/solo, volumen en vivo.
- `peaks.ts`: waveforms SVG. Importar música, separar audio.
- `export/audioMixer.ts`: mezcla TODAS las pistas de audio en el export (AAC).

## Compositor + multicapa + transiciones
- `compositor.ts`: `drawComposedFrame()` (transform, opacidad, fusión, transición).
- `media/clipDecoder.ts` + `playbackWorker.ts`: N capas por z-index en el visor.
- `export/exportLayerDecoder.ts` + `exportWorker.ts`: export multicapa por tiempo.
- 7 transiciones (crossfade, fade, wipe L/R/Up, slide L/R), en visor y export.

## Texto / títulos (NUEVO en esta entrega)
- Modelo: `TextContent` + campo opcional `text` en `Clip`. Si un clip tiene
  `text`, es una capa de texto (sin asset de video), posicionada por su transform.
- `captions/renderText.ts`: `drawTextClip()` compartido por visor y export
  (multilínea, alineación, color, negrita/cursiva, fondo, contorno).
- Store: comandos `addTextClip` y `updateTextClip`.
- Reproducción: el worker compone capas de texto intercaladas con video por
  z-index (protocolo `TextLayerMsg`), aplicando transform/opacidad.
- Export: `ExportTextLayer` en el request; el export worker dibuja el texto en el
  mismo bucle por tiempo. El MP4 = lo que ves (títulos incluidos).
- UI: pestaña "Texto" con "Añadir título"; panel completo en el inspector
  (contenido, tamaño, color, negrita/cursiva, alineación, fondo, contorno);
  el clip de texto se etiqueta y colorea distinto en la timeline.

## Arrastre entre pistas + posición editable (NUEVO en esta entrega)
- `moveClipToTrack` en el store: mueve un clip a otra pista validando
  compatibilidad (audio→audio; video/texto→video) y limpiando sus transiciones.
- Timeline: el arrastre "move" ahora detecta la pista bajo el cursor
  (`elementFromPoint` + `data-track`), resalta la pista destino compatible y, al
  soltar, mueve el clip a esa capa. Permite montar overlays/PiP directamente.
- Inspector: la posición X/Y del clip ahora es editable (inputs numéricos), ya no
  solo de lectura.

## Animación en el export + keyframes (NUEVO en esta entrega)
- El export ya NO congela el transform en el tick 0. `ExportLayer`/`ExportTextLayer`
  llevan el `transform`/`opacity`/`blendMode` CRUDOS (con keyframes); el export
  worker, que ya va frame a frame, evalúa la composición en el tick local de cada
  capa. Las animaciones de escala/posición/rotación/opacidad quedan en el MP4.
- `compositor.ts`: nuevo `evaluateCompose(transform, opacity, blend, localTick)`,
  PUNTO ÚNICO de evaluación compartido por la vista previa (controller) y el export.
  Se eliminó la lógica duplicada que vivía en `playback.ts`.
- Creación de keyframes (UI mínima usable):
  - `animated.ts`: `setKeyframe()` (inserta/actualiza, convierte estático→animado,
    siembra el valor previo en tick 0) y `simplify()`.
  - Store: comando `setClipKeyframe(clipId, prop, localTick, value)` para escala,
    rotación, opacidad, x e y.
  - Inspector: botón ◆ junto a Escala/Rotación/Opacidad que fija un keyframe con
    el valor actual en el tick del cursor (el inspector recibe `currentTick`).

## Ver y editar keyframes en la timeline (NUEVO en esta entrega)
- Los keyframes del clip SELECCIONADO se dibujan como diamantes sobre su barra,
  en la posición de su tick local. Un diamante por tick (agrupa las propiedades
  que tengan keyframe ahí).
- Interacción: clic lleva el playhead a ese keyframe (para editarlo); clic derecho
  lo elimina. Si tras borrar queda 0-1 keyframe, la propiedad vuelve a estática.
- `animated.ts`: nuevo `removeKeyframe()` (quita por tick y simplifica).
- Store: comando `removeClipKeyframe(clipId, prop, localTick)`.
- Cierra el ciclo de animacion: crear (inspector ◆) → ver/ir/borrar (timeline) →
  exportar (ya respetado en el MP4).

## Arrastrar keyframes en el tiempo (NUEVO en esta entrega)
- Los diamantes de keyframe ahora se ARRASTRAN horizontalmente para recolocarlos
  en el tiempo, limitados al rango del clip, con feedback visual en vivo.
- Un umbral de 3px distingue arrastre de clic: clic limpio = llevar el playhead al
  keyframe; clic derecho = borrar; arrastre = recolocar.
- `animated.ts`: nuevo `moveKeyframe(prop, fromTick, toTick)` (conserva valor y
  easing; si el destino ya tiene keyframe, lo sustituye).
- Store: comando `moveClipKeyframe(clipId, prop, fromTick, toTick)`.
- Ciclo de animacion COMPLETO: crear (inspector) → ver/ir/recolocar/borrar
  (timeline) → exportar (quemado en el MP4).

## Correccion de bugs de titulos (NUEVO en esta entrega)
Se corrigieron los tres problemas reportados al editar titulos:
- **Te sacaba del campo al escribir**: cada tecla disparaba un re-render completo
  del inspector, que destruia el textarea y perdia el foco. Ahora el campo de
  texto y el color usan `onLiveEdit` (refresca el visor SIN reconstruir el
  inspector), asi que el foco se conserva.
- **El texto no cambiaba en el video**: el contenido solo se enviaba al worker en
  `setLayers`. Nuevo mensaje `setTextLayers` + `controller.refreshText()`
  actualizan el texto en vivo y re-presentan: el cambio se ve al instante.
- **No se podia mover**: editar la posicion (u otro cambio estructural) ahora
  reconstruye la timeline via `afterEditAsync`, propagando la nueva posicion del
  titulo a las capas del worker.

## Interacciones con el raton (NUEVO en esta entrega)
- **Arrastrar el titulo en el visor**: una capa transparente (`PreviewInteractor`)
  se alinea con el rectangulo real del canvas; arrastrar el titulo seleccionado
  traduce el desplazamiento de pantalla a coordenadas del proyecto y actualiza su
  posicion X/Y en vivo. (El canvas lo pinta un worker, asi que no hay hit-testing
  de pixeles; se calcula la caja del titulo desde el modelo.)
- **Mover la timeline arrastrando**: arrastrar el fondo vacio de las pistas hace
  scroll horizontal (pan), con cursor grab/grabbing. No interfiere con arrastrar
  clips ni keyframes.
- **Zoom con la rueda**: Ctrl/Cmd + rueda acerca/aleja manteniendo el punto bajo
  el cursor anclado (`zoomBy` con ancla). Shift+rueda (o trackpad horizontal)
  desplaza la timeline.

## Correccion de play/pausa + easing por keyframe (NUEVO en esta entrega)

### Pausa/reproduccion
Se corrigieron varios problemas de la pausa:
- **El audio devolvia la posicion vieja tras pausar**: `audioEngine.pause()` no
  congelaba `anchorTick`, asi que `currentTick` saltaba al reanudar o hacer seek.
  Ahora congela la posicion actual antes de detener.
- **Play al final no reiniciaba**: si el cabezal estaba al final, pulsar play no
  hacia nada (entraba y salia del bucle). Ahora reinicia desde 0.
- **Salto al terminar el audio antes que el video**: el reloj de respaldo
  (`performance.now`) ahora se reancla cada frame mientras el audio es maestro,
  para continuar suave si el audio se agota antes.
- `pause()` limpia el rafId y refresca el frame una vez al congelarse.

### Easing por keyframe
- `animated.ts`: `setKeyframeEasing(prop, tick, easing)`.
- Store: comando `setClipKeyframeEasing(clipId, prop, localTick, easing)`.
- Timeline: clic derecho en un keyframe abre un menu contextual para elegir la
  curva (Lineal, Acelera, Desacelera, Suave, Mantener) o eliminarlo. Antes el
  clic derecho solo borraba; ahora ofrece las opciones. El easing por defecto
  sigue siendo "Suave" (easeInOut).

## Pausa fiable + atajos de teclado (NUEVO en esta entrega)

### Bug de la pausa intermitente (resuelto)
- Causa raiz: el icono del boton de play se reescribia con `innerHTML` en CADA
  frame (60 fps) durante la reproduccion. Eso destruia y recreaba el SVG interno
  del boton continuamente; al hacer clic en el CENTRO (sobre el SVG) el navegador
  perdia el evento porque el nodo se reemplazaba justo bajo el cursor. En las
  ORILLAS (sobre el boton mismo) si funcionaba. Por eso fallaba "a veces".
- Arreglo: el icono solo se actualiza cuando el estado play/pausa CAMBIA, no en
  cada frame. Ademas el boton hace blur() tras el clic para que Espacio no dispare
  el boton nativo y el atajo a la vez (doble toggle).

### Atajos de teclado
- Espacio: reproducir / pausar.
- Supr / Retroceso: borrar el clip seleccionado (limpia tambien el inspector).
- S: dividir el clip bajo el cabezal.
- Flecha izq/der: retroceder / avanzar un fotograma.
- Inicio / Fin: ir al principio / final.
- Ctrl/Cmd+Z deshacer, Ctrl/Cmd+Shift+Z (o Ctrl+Y) rehacer.
- Todos se desactivan cuando el foco esta en un campo de texto (input/textarea).

## Pista de titulos dedicada + pista de subtitulos editable (NUEVO)

### Titulos en su propia pista
- Nuevo `TrackKind: "text"`. Los titulos ya no se mezclan con el video: viven en
  una pista "Titulos" dedicada (zIndex alto, van por encima del video).
- `addTextClip(null, ...)` crea/usa esa pista automaticamente y EVITA solapes: si
  el hueco en el cabezal esta ocupado, coloca el titulo tras el ultimo.
- Reproduccion y export reconocen las pistas de texto (se componen como capas).
- Arrastre entre pistas y `moveClipToTrack` validan: los titulos solo van a la
  pista de texto, el video a video, el audio a audio.

### Subtitulos estilo CapCut (editables en la timeline)
- Una fila dedicada de "Subtitulos" muestra cada cue como un bloque:
  - Doble clic: edita el texto en sitio (input sobre el bloque).
  - Arrastrar el cuerpo: lo mueve. Tiradores laterales: ajustan inicio/fin.
  - Clic derecho: lo elimina. Boton "+": anade un subtitulo en el cabezal.
- Usa los comandos que ya existian (addCaption/updateCaption/removeCaption); los
  cambios se reflejan en el visor al instante (pushSubtitles en la sync).

## Orden fijo de pistas + migracion de titulos (NUEVO)
- La timeline ahora dibuja las pistas en un ORDEN VISUAL FIJO, sin importar el
  orden de creacion: Video -> Audio -> Subtitulos -> Titulos (de arriba a abajo).
- La pista de subtitulos se intercala automaticamente justo antes de los titulos
  (o al final si no hay titulos).
- Migracion: los titulos de proyectos antiguos que vivian en pistas de video se
  mueven solos a la pista de "Titulos" al cargar, y si se solapaban en el tiempo
  se desplazan para quedar secuenciales (no se pisan). Aplica al recargar la
  pagina (el autosave + loadProject corren la migracion).

## Pistas vacias ocultas + playhead de altura completa (NUEVO)

### Pistas vacias ocultas
- La timeline ya NO muestra pistas sin clips. Una pista aparece solo cuando tiene
  contenido (al importar un clip o anadir un titulo se crea ya con su clip).
- Excepcion: si el usuario crea una pista a proposito con los botones "Pista" o
  "Audio" de la toolbar, esa pista queda visible aunque vacia (placeholder) para
  poder arrastrarle contenido; deja de serlo al recibir su primer clip.

### Playhead de altura completa
- La linea de reproduccion usaba `bottom: 0` dentro del scroller, asi que su
  altura era la del area visible, no la del contenido: al hacer scroll vertical
  con muchas pistas, la linea "desaparecia" en las pistas de abajo.
- Ahora su altura se fija al `scrollHeight` (alto total del contenido) en cada
  actualizacion, de modo que cruza todas las pistas sin importar el scroll.

## Deshacer/rehacer en el visor + tiradores del titulo (NUEVO)

### Deshacer / rehacer reflejados en el visor
- Antes, deshacer o rehacer solo re-renderizaba la timeline y el inspector, pero
  NO reconstruia las capas del visor, asi que el cambio no se veia en el video.
- Ahora undo/redo (botones y atajos Ctrl/Cmd+Z, Shift+Z, Ctrl+Y) usan
  `afterEditAsync`, que reconstruye las capas: lo que ves en el visor refleja el
  estado tras deshacer/rehacer.

### Tiradores de escala y rotacion del titulo en el visor
- El recuadro de seleccion del titulo ahora trae tiradores:
  - Cuatro esquinas: arrastrar para ESCALAR (relativo al centro, 0.1x..3x).
  - Tirador superior (circulo): arrastrar para ROTAR (-180..180 deg).
  - El cuerpo se sigue arrastrando para MOVER.
- Todo en vivo y reflejado en el visor; el recuadro rota para acompañar al texto.

## Estilo por subtitulo individual (NUEVO)
- Cada subtitulo puede tener su propio estilo, que SOBRESCRIBE el global solo en
  los campos que cambies; el resto sigue al estilo global del proyecto.
- Modelo: `CaptionCue.style?: Partial<SubtitleStyle>`. Tambien viaja en el mensaje
  al worker (`SubtitleCueMsg.style`) y se incluye en la exportacion, asi que lo
  que ves se quema igual en el video final.
- Render: `drawSubtitle` fusiona `{ ...global, ...cue.style }` por cue.
- Comandos: `setCaptionStyle(id, patch)` (merge; borra el override si queda vacio)
  y `clearCaptionStyle(id)` (vuelve al estilo global).
- UI: al hacer CLIC en un subtitulo de la timeline se abre su panel en el
  inspector (color, tamano, negrita/cursiva, posicion, contorno) con un boton
  "Restablecer al estilo global". El doble clic sigue editando el texto, el
  arrastre lo mueve/recorta y el clic derecho lo elimina. El panel indica si el
  subtitulo usa estilo "global" o "personalizado".

## Estilo por subtitulo individual (COMPLETADO)
Cada subtitulo puede tener su propio estilo, sobrescribiendo el global solo para
el (como en CapCut). Flujo completo de extremo a extremo:
- Modelo: `CaptionCue.style?: Partial<SubtitleStyle>` (override opcional).
- Store: `setCaptionStyle(id, patch)` (fusiona) y `clearCaptionStyle(id)` (vuelve
  al global).
- Seleccion: clic simple en un bloque de la pista de subtitulos lo selecciona y
  abre su panel en el inspector (sin arrastre = clic).
- Inspector (panel "Subtitulo"): editar texto, color, tamano, negrita, cursiva,
  posicion (arriba/centro/abajo), contorno (color+grosor) y AHORA tambien el
  fondo (caja tras el texto: activar/desactivar + color). Indica si el subtitulo
  usa estilo "personalizado" o "global", con boton para restablecer al global.
- Render: `drawSubtitle` aplica `{...global, ...cue.style}`, asi que el visor Y el
  export respetan el override (pushSubtitles y export incluyen `style` por cue).

## Plantillas (presets) de estilo de titulo (NUEVO)
- Nuevo modulo `captions/titlePresets.ts` con 6 plantillas: Simple, Titular,
  Con caja, Acento, Sutil y Llamativo. Cada una define solo los campos de aspecto
  (tamano, color, negrita/cursiva, alineacion, fondo, contorno), NUNCA el texto,
  de modo que aplicar una plantilla conserva lo que el usuario escribio.
- En el inspector, al seleccionar un titulo aparece una rejilla "Plantillas"
  arriba del panel de texto. Un clic aplica el estilo (via updateTextClip).
- El render de titulos (renderText, compartido por visor y export) ya usaba todos
  esos campos, asi que el preset se refleja en el visor y al exportar.

## Tipografias para titulos y subtitulos (NUEVO)

### Catalogo (80 fuentes, sin copyright)
- Nuevo `model/fonts.ts` con 80 familias de Google Fonts, todas bajo licencia
  libre (SIL Open Font License 1.1 o Apache 2.0): se pueden usar y redistribuir
  sin coste. Dos grupos:
  - 40 DISPLAY (espectaculares, estilo redes/CapCut): Anton, Bebas Neue, Bungee y
    variantes, Bagel Fat One, Titan One, Luckiest Guy, Alfa Slab One, Abril
    Fatface, Monoton, Bangers, Honk, Modak, Press Start 2P, Black Ops One, etc.
  - 40 GENERICAS (variadas): sans (Inter, Poppins, Montserrat, DM Sans...), serif
    (Playfair Display, Merriweather, Lora, EB Garamond...), mono (JetBrains Mono,
    Space Mono...) y script (Pacifico, Dancing Script, Caveat).

### Carga de fuentes (documento + ambos workers)
- `media/fontLoader.ts`: carga el catalogo con la API FontFace. Como el canvas
  dibuja en workers (que tienen su PROPIO registro de fuentes), se carga en tres
  contextos: documento (UI/preview, ademas de inyectar la hoja de Google Fonts),
  worker de reproduccion (mensaje "loadFonts" tras init) y worker de exportacion
  (al inicio de run, para quemar el texto con la tipografia correcta).
- Tolerante a fallos: si una familia no carga (red, nombre), se omite y queda el
  fallback. Carga en tandas de 8 para no saturar la red.

### UI: secciones "Estilo" y "Tipo"
- En el inspector, el panel de TITULO ahora tiene dos secciones separadas:
  "Estilo" (las plantillas/presets) y "Tipo" (selector de tipografia).
- El panel de SUBTITULO tambien tiene "Tipo" (respeta el override por subtitulo).
- El selector agrupa en "Espectaculares" y "Genericas" (optgroup) y previsualiza
  cada opcion en su propia fuente. La fuente se guarda como stack con fallback.
- Los presets ya NO fijan la fuente: "Estilo" y "Tipo" son independientes, asi
  aplicar una plantilla conserva la tipografia elegida.

## Contorno de texto completo + duracion de transicion (NUEVO)

### Contorno del texto
- El render YA pintaba el contorno (strokeText con lineJoin redondeado, debajo
  del relleno) tanto en titulos como en subtitulos cuando outlineWidthPx > 0.
- Faltaba en la UI el COLOR de contorno del titulo (el grosor ya estaba; los
  subtitulos ya tenian ambos). Anadido: ahora el panel de titulo tiene color +
  grosor de contorno, igual que el de subtitulo.

### Duracion de transicion en la UI
- Las transiciones (7 tipos) ya permitian cambiar el tipo con clic. Ahora con
  CLIC DERECHO sobre el marcador de transicion se abre un menu para elegir su
  duracion: Rapida 0,3s / Media 0,5s / Estandar 1s / Lenta 1,5s / Muy lenta 2s.
  Usa el comando setTransitionDuration (que ya existia). El marcador refleja la
  nueva duracion (su ancho).

## Catalogo de fuentes recurado (NUEVO)
El usuario reporto que las fuentes anteriores se veian mal elegidas (demasiadas
"circenses": glitch, neon, pixel...). Confirmado por busqueda: los creadores usan
tipografias mucho mas sobrias. Se recuro el catalogo (sigue siendo 80, todas con
licencia libre OFL/Apache, sin duplicados):
- DISPLAY (40): condensadas de impacto (Anton, Bebas Neue, Oswald, Teko, Khand,
  Staatliches), sans pesadas de redes (Montserrat, Poppins, Sora, Outfit,
  Unbounded), serif editoriales (Playfair Display, Fraunces, DM Serif, Bodoni
  Moda, Marcellus), fat usables (Lilita One, Alfa Slab One, Abril Fatface,
  Bangers) y scripts elegantes para combos bold+cursiva (Pacifico, Great Vibes,
  Kaushan Script, Allura, Satisfy, Sacramento, Yellowtail).
- GENERICAS (40): sans legibles (Inter, Roboto, Lato, DM Sans, Figtree, Onest,
  Schibsted Grotesk), serif clasicas (Merriweather, Lora, EB Garamond, Libre
  Baskerville, Source Serif 4) y monoespaciadas (JetBrains Mono, Space Mono,
  Fira Code, IBM Plex Mono).
- Quitadas: Rubik Glitch/Wet Paint/Puddles/Spray Paint/Bubbles, Honk, Press Start
  2P, Faster One, Monoton, Bungee Spice/Shade/Inline, Climate Crisis, Tilt Prism,
  Modak, Knewave, Chango, Ultra, etc.

### Pesos correctos por fuente
- Nuevo flag `bold` en FontDef: marca las familias con peso 700. La URL de Google
  Fonts y el fontLoader piden `wght@400;700` solo a esas; las de un solo peso se
  piden sin sufijo (pedir un peso inexistente invalidaba la peticion y la fuente
  no cargaba). Asi las sans pesadas (Montserrat, Poppins...) tienen su bold y las
  single-weight (Anton, Bebas...) cargan sin error.

## Tiradores de escala/rotacion tambien para clips de video (NUEVO)
- El PreviewInteractor (recuadro con tiradores en el visor) ahora funciona tanto
  para titulos como para clips de VIDEO (no audio).
- Para video, la caja del recuadro es el lienzo completo escalado (el clip cubre
  el frame); las esquinas escalan (0.1x..3x), el circulo superior rota
  (-180..180) y el cuerpo mueve (paneo). Util para reencuadrar, hacer zoom o
  montar un efecto Ken Burns combinandolo con keyframes.
- onLiveEdit se adapta al tipo de clip: titulos -> refreshText (solo texto),
  video -> refreshCompose (recompone el frame con el nuevo transform). Asi el
  arrastre se ve en vivo en ambos casos.

## Importacion de imagenes fijas (NUEVO)
El AssetKind "image" ya existia declarado pero sin implementar; ahora funciona de
extremo a extremo:
- Importacion: importImageFile (ya guardaba la imagen en OPFS y leia sus
  dimensiones) ahora se invoca via dispatchFile, que detecta el tipo MIME
  (audio/image/video). El input acepta image/*. Se crea un clip de 5 s por
  defecto (ajustable con trim) en una pista de video.
- Visor (worker): las capas de imagen no usan el ClipDecoder de video; se cargan
  como ImageBitmap una vez (desde OPFS) y se dibujan en cada frame mientras el
  clip esta activo, con drawComposedFrame (mismo pipeline de transform/opacidad/
  fusion/transicion que el video).
- Export: el exportWorker carga los ImageBitmap y los compone por frame con
  evaluateCompose, igual que el video; las imagenes se queman al MP4 respetando
  escala/rotacion/posicion/keyframes y transiciones.
- Reutiliza todo lo existente: tiradores del visor, keyframes, transiciones y
  arrastre entre pistas funcionan con imagenes sin cambios adicionales.

## Miniaturas de imagen en la timeline (NUEVO)
- Los clips de imagen ahora muestran la propia imagen como fondo del bloque
  (background-image con cover), no solo el nombre. Asi se reconocen de un vistazo.
- El nombre y un icono de imagen se dibujan encima con gradiente + sombra para
  que sean legibles sobre cualquier miniatura.
- El objectURL de cada miniatura se cachea por asset (no se recrea por render) y
  se libera (revokeObjectURL) cuando el asset deja de existir, evitando fugas.
- Nuevo icono `image` en el set de iconos.

## Fix imagen no visible + pista de imagen dedicada (NUEVO)

### Bug: la imagen no se veia
- El rango temporal de la capa de imagen usaba `outTick`/`clipOutTick` (tick
  DENTRO del asset) como fin en la timeline. Si la imagen no empezaba en 0, caia
  fuera de su ventana de visibilidad y no se dibujaba. Corregido en visor y
  export: el fin = clipStartTick + (outTick - inTick).

### Imagenes en su propia pista
- Nuevo TrackKind "image". Al importar una imagen se crea/usa una pista
  "Imagenes" dedicada (ya no van a la pista de video).
- Orden visual de pistas: Video -> Imagenes -> Audio -> Subtitulos -> Titulos.
- Composicion (visor) y export incluyen las pistas de imagen.
- Arrastre y moveClipToTrack: las imagenes solo van a pistas de imagen, video a
  video, audio a audio, titulos a texto.
- Migracion: las imagenes de proyectos antiguos que estaban en pistas de video
  se mueven solas a una pista de imagen al recargar.

## Fix definitivo: la imagen no se veia en el visor (CAUSA RAIZ)
- El worker construye `layerOrder` (capas a pintar) y la filtraba con
  `.filter(l => decoders.has(l.clipId))`. Las imagenes NO usan ClipDecoder (usan
  ImageBitmap aparte), asi que el filtro las descartaba y el codigo de pintado de
  imagenes nunca se ejecutaba. El bitmap se cargaba pero la capa no entraba en la
  lista de pintado.
- Arreglo: el filtro ahora conserva `l.isImage || decoders.has(l.clipId)`. Ademas
  se repinta en cuanto el ImageBitmap termina de cargar (por si la lectura de
  OPFS tarda mas que el primer paint).
- Este era el bloqueo real; el fix anterior del rango temporal
  (clipStartTick + out - in) tambien era necesario pero no suficiente.

## Colocacion automatica al final + snapping al arrastrar (NUEVO)

### Importar coloca el clip tras el ultimo
- Al importar video, audio o imagen, el nuevo clip se coloca justo despues del
  ultimo clip de su pista (helper trackEndTick), en vez de en 0 (donde se
  encimaba) o en el cabezal. Asi se montan secuencias rapido.

### Snapping (enganche) al arrastrar
- Al mover un clip, si su borde (izquierdo o derecho) se acerca a < 8px de un
  punto de enganche, se pega a el. Puntos: bordes de los demas clips de la misma
  pista, el tick 0 y el cabezal de reproduccion.
- Una guia vertical verde aparece donde engancha, para sugerir visualmente que
  van a quedar contiguos. Se oculta al soltar.

## Fix: el video se congelaba al hacer scrub (NUEVO)
- Sintoma: al mover el cabezal, el audio seguia pero el video se quedaba estatico.
- Causa: en ClipDecoder, mientras un seek estaba en curso (`seeking = true`), las
  peticiones de prepare() siguientes se ignoraban. Al arrastrar rapido, el ultimo
  destino se perdia y el decoder quedaba en un tick viejo -> frame congelado.
- Arreglo (coalescing de seeks): si llega un prepare durante un seek, se guarda
  como `pendingSeekTs`; al terminar el seek en curso, doSeek atiende la peticion
  mas reciente (reseek o pump) y dispara onFrameReady para repintar. Asi el video
  sigue al cabezal durante el scrubbing.

## Snapping tambien al recortar (trim) (NUEVO)
- El enganche (snapping) ahora funciona tambien al recortar los bordes de un
  clip, no solo al moverlo. Helpers compartidos: snapPoints (bordes de otros
  clips de la pista, tick 0 y cabezal) y snapEdge (engancha un borde suelto).
- Al arrastrar el borde izquierdo (recortar inicio) o derecho (recortar fin), si
  el borde se acerca a < 8px de un punto, se pega a el y aparece la misma guia
  vertical verde. Asi es facil alinear cortes con otros clips o con el cabezal.
- snapClipStart (mover) se refactorizo para reutilizar snapPoints (sin duplicar).

## Fix scrub v2: el video se trababa tras varios toques (4 causas)
El fix anterior (coalescing) no bastaba. Encontradas y corregidas 4 causas en
ClipDecoder, que juntas explican "se traba tras algunos toques, al principio y
luego al final":
1. needSeek no detectaba un retroceso a un punto YA desalojado de la cola (solo
   miraba seekPointTs). Ahora tambien re-seekea si target < primer frame en cola.
2. evict era muy agresivo (dejaba 1 frame atras). Ahora conserva un colchon de 6
   frames hacia atras, para tolerar micro-retrocesos del cabezal sin re-seek.
3. El flag `seeking` podia quedar atascado en true si doSeek fallaba, bloqueando
   TODOS los seeks siguientes (traba permanente). Ahora se libera en try/finally.
4. doSeek se llamaba recursivamente al encadenar peticiones; con scrub rapido
   apilaba awaits. Reescrito como bucle iterativo que atiende siempre el ultimo
   destino pendiente.

## Scrub v3: revertido el cambio que rompia la reproduccion
El v2 empeoro las cosas (ni la reproduccion normal era fluida). Causa: el colchon
de evict (KEEP_BEHIND=6) llenaba la cola con frames viejos y, como pump para
cuando queue.length >= MAX_QUEUE(24), no quedaba espacio para decodificar por
delante -> reproduccion a tirones.

Decision conservadora:
- REVERTIDO el colchon de evict: vuelve a su forma original (deja ~1 frame atras),
  que reproducia fluido.
- CONSERVADO solo lo de bajo riesgo que NO toca el camino de reproduccion:
  - `seeking` en try/finally (evita la traba permanente si un seek falla).
  - doSeek iterativo con coalescing (atiende el ultimo destino en scrub rapido).
  - needSeek re-seekea si target < primer frame en cola (solo afecta a retroceso,
    no al avance de la reproduccion).
- Estos tres solo actuan en el camino de SEEK, no en el de play, asi que la
  reproduccion vuelve a ser fluida y el scrub no deberia trabarse permanentemente.

NOTA: el subsistema de decodificacion es delicado y se edita sin poder probar en
navegador. Conviene validar en maquina antes de mas cambios de scrub.

## ClipDecoder reescrito con el patron profesional de WebCodecs (NUEVO)
Tras investigar como lo hacen los editores de produccion (WebCodecs Fundamentals,
Diffusion Studio, VidStudio), se reescribio el ClipDecoder siguiendo el patron de
pipeline correcto, en vez de seguir parcheando:

Problemas del enfoque anterior:
- Trataba el decode como "pedir frame -> await frame", pero el VideoDecoder
  trabaja por LOTES y asincrono (hacen falta 3-5 chunks para el primer frame).
- Al vaciarse la cola sin mas chunks que "empujen" el decoder, los ultimos frames
  no salian -> "dura 4s y se traba".
- La bandera seeking podia atascarse -> traba permanente.

Nuevo diseno (interfaz publica intacta: load/prepare/frameAt/coversTick/dispose):
- Buffer de frames separado del decode; se sirve frameAt desde el buffer.
- fillBuffer(): decodifica por lotes (BATCH_DECODE_SIZE=12) con limite de cola del
  decoder (DECODE_QUEUE_LIMIT=16) y ventana de lookahead (1.5s). Solo repone tras
  consumir/avanzar, manteniendo frames por delante del playhead sin saturar.
- ensureDecoder(): si el decoder cae a estado no-"configured" (fallo/corrupto), lo
  recrea y reposiciona en el keyframe <= playhead. Elimina trabas permanentes sin
  banderas fragiles.
- seekTo(): descarta buffer, recoloca en keyframe anterior al destino y rellena;
  coalescing por numero de generacion (un seek viejo que termina se descarta).
- onDecodedFrame(): descarta frames pasados cerrandolos (libera memoria GPU, clave
  para no fugar), inserta ordenado (B-frames), recorta el buffer.
- Cierre disciplinado de VideoFrame en todos los caminos (evita fuga de GPU).

PENDIENTE VALIDAR EN NAVEGADOR: (a) reproduccion fluida desde el inicio y
sostenida; (b) scrub adelante/atras sin trabarse ni congelarse.

## ClipDecoder v2: simplificado y robusto (NUEVO)
La primera reescritura no reproducia (solo un frame al inicio). Causa: fillBuffer
se autollamaba desde el callback de frame y paraba la decodificacion segun una
ventana fija (lastRequestedTs + LOOKAHEAD) que no se reanudaba bien durante el
play. Reescrito mas simple y correcto:
- fill() decodifica mientras falten frames POR DELANTE del playhead
  (framesAhead() < TARGET_AHEAD=16) y la cola lo permita (DECODE_QUEUE_LIMIT=12),
  con un guard anti-bucle. Se re-evalua en cada prepare(), asi la reposicion es
  continua durante la reproduccion.
- onFrame() inserta ordenado (B-frames), conserva el mejor frame <= playhead como
  "actual" y cierra los demas pasados (libera GPU).
- prepare(): si no hay que saltar, dropPast() + fill(); si el target retrocede del
  keyframe actual o queda antes del buffer, seekTo() (con token para descartar
  seeks obsoletos).
- ensureDecoder() recrea el decoder si se cierra por un fallo y lo recoloca en el
  keyframe <= playhead. Sin banderas fragiles que se atasquen.
- Interfaz publica intacta (load/prepare/frameAt/coversTick/dispose).

DIAGNOSTICO: hay una bandera DEBUG en clipDecoder.ts. Si aun falla, ponla en true
y la consola (F12) volcara el estado (buffer, framesAhead, cursor, decodeQueueSize,
state) para localizar el problema con datos reales.

## Version de DIAGNOSTICO (logs activados)
El video sigue sin reproducir y ahora "no cambia al siguiente". Para dejar de
adivinar, esta entrega trae DOS conjuntos de logs ACTIVADOS por defecto:
- clipDecoder.ts: DEBUG=true -> en cada prepare vuelca {playheadTs, buffer,
  framesAhead, cursor, decodeQueueSize, state} y avisa de cada seek.
- playbackWorker.ts: DEBUG_WORKER=true -> en cada present vuelca, por capa,
  {clip, isImage, covers (si el clip cubre el tick), hasFrame (si frameAt devuelve
  algo)}.

QUE NECESITO QUE ME ENVIES (consola del navegador, F12 -> Console):
1. Carga un video y dale a play. Copia 10-15 lineas de [worker present] y
   [ClipDecoder].
2. Si tienes dos clips, mueve el cabezal hasta pasar del primero al segundo y
   copia las lineas de ese momento.
Con eso vere si el fallo es: (a) el decoder no llena el buffer (hasFrame=false),
(b) covers es false cuando deberia ser true (problema de rangos/tiempos), o
(c) un error que cierra el decoder.

Recordatorio: para quitar los logs luego, poner DEBUG=false en clipDecoder.ts y
DEBUG_WORKER=false en playbackWorker.ts.

## CAUSA RAIZ ENCONTRADA (gracias a la consola): keyframe requerido
La consola mostro el error real, repetido 95.104 veces:
  "Failed to execute 'decode' on 'VideoDecoder': A key frame is required after
   configure() or flush()."
El VideoDecoder EXIGE que el primer chunk tras configure()/flush() sea un keyframe.
Mi codigo a veces enviaba un chunk intermedio primero -> decode fallaba -> el buffer
nunca se llenaba -> trabado en el primer frame, reintentando sin fin. Las lineas
"[ClipDecoder] seek" repetidas eran un bucle de re-seeks fallidos.

Arreglo:
- Bandera needsKeyframe: se activa en setupDecoder() (tras configure) y en seekTo()
  (tras flush). Mientras este activa, fill() avanza el cursor hasta un keyframe y
  SOLO entonces decodifica; al enviar ese keyframe la desactiva. Garantiza que el
  primer decode siempre sea key.
- needSeek() reescrito para comparar el keyframe que cubre el target con el actual:
  si es el mismo, NO re-seekea. Esto elimina el bucle de seeks infinitos.

Los logs (DEBUG / DEBUG_WORKER = true) siguen ACTIVADOS para confirmar que el error
desaparecio. Una vez validado, ponerlos en false.

## Fix del bucle de seeks (modelo por indice de keyframe)
Progreso: el error de keyframe bajo de 95.104 a 4.442 y ya cambia de clip. Pero la
consola mostraba un BUCLE de "[ClipDecoder] seek" y el error de keyframe persistia.
Causa: needSeek comparaba timestamps de keyframe (con tolerancias +/-1) que podian
oscilar, y los seeks se solapaban (varios prepare durante un flush relanzaban seek).

Reescritura del modelo de seek (mas simple y sin oscilacion):
- Se rastrea currentKeyIdx = INDICE del keyframe cargado (entero exacto).
- needSeek(target) = (keyframeIndexFor(target) !== currentKeyIdx). Comparacion de
  enteros: dentro del mismo GOP nunca dispara; al cruzar a otro keyframe dispara
  una sola vez. Adios al bucle.
- seekTo con bandera `seeking` (evita solapes) + pendingSeek (coalescing): si llega
  otra peticion durante el flush, se atiende al terminar, en un bucle interno.
- needsKeyframe sigue garantizando que el primer decode tras configure/flush sea key.
- Eliminado currentKeyTs (ya no hace falta; todo va por indice).

Logs DEBUG/DEBUG_WORKER siguen ACTIVOS para confirmar que (a) desaparece el bucle de
seeks y (b) desaparece el error de keyframe. El log de seek ahora incluye kIdx y
curKeyIdx para verlo claro. Tras validar, poner ambos en false.

## Blindajes adicionales contra el error de keyframe (NUEVO)
La traza completa de la consola confirmo que el error sale del decode() en fill(),
via onPresent->prepare->fill. Combinado con el fix del bucle de seeks (que aun no
se habia probado), se anaden tres blindajes:
1. keyframeIndexFor() ahora GARANTIZA devolver el indice de un keyframe real: si no
   hay ninguno en/antes del target, usa el primer keyframe del video hacia adelante.
   Antes podia devolver 0 aunque chunks[0] no fuera key -> decode fallaba.
2. El callback `error` del VideoDecoder marca needsKeyframe=true, para que el
   proximo fill() recoloque en keyframe (cubre los errores ASINCRONOS que el
   try/catch alrededor de decode() no atrapa).
3. Throttle de errores en el worker: el mismo mensaje solo se reporta una vez y
   luego, como mucho, cada 2s. Evita los 140.000 errores identicos que tapaban la
   consola.

Logs DEBUG/DEBUG_WORKER siguen ACTIVOS. Esta version incluye TODO: fix de keyframe,
fix del bucle de seeks (modelo por indice) y estos tres blindajes.

## Fix de concurrencia flush/decode (los 30 errores residuales)
Gran avance: de 140.000 errores a 30 (el throttle + blindajes funcionaron). Los 30
restantes eran una VENTANA DE CONCURRENCIA al saltar entre clips (la consola mostro
3 capas activas):
- seekTo hacia await flush() y SOLO DESPUES marcaba needsKeyframe=true. Entre el
  await y esa linea, otra llamada a prepare/fill podia colarse y decodificar un
  no-keyframe -> error.
Arreglo:
- needsKeyframe = true se pone ANTES del flush.
- prepare() no toca el decoder si hay un seek en curso (seeking=true): solo registra
  el destino en pendingSeek; el seek lo atiende al terminar. Asi ningun fill externo
  decodifica durante el flush.

Con esto la ventana queda cerrada. Logs DEBUG/DEBUG_WORKER siguen activos; si los 30
bajan a 0 (o a un numero estable muy pequeno al saltar), apagar logs en la siguiente.

## URGENTE: fuga de memoria GPU que ponia Chrome en negro
Sintoma critico: la app dejaba Chrome entero en negro = saturacion de memoria GPU
por VideoFrames sin cerrar (cada frame ocupa memoria de la tarjeta grafica).

Fugas encontradas y cerradas:
1. setupDecoder() recreaba el VideoDecoder pero NO cerraba los frames del buffer
   anterior antes de perder la referencia. Con los errores en cadena, el decoder se
   recreaba muchas veces -> fuga masiva. Ahora cierra el buffer siempre que recrea.
2. El callback output podia recibir frames de un decoder YA reemplazado (o tras
   dispose) e insertarlos/abandonarlos. Ahora cada decoder tiene una "generacion";
   los frames de una generacion vieja o tras dispose se cierran y descartan.
3. dispose() marca disposed e invalida la generacion (ignora frames tardios).
4. Limites de memoria reducidos a un tercio: MAX_BUFFER 40->12, TARGET_AHEAD 16->8,
   DECODE_QUEUE_LIMIT 12->6. Con N capas el uso es N×MAX_BUFFER, asi que bajarlo es
   clave para no saturar la GPU con varios clips.

Logs de diagnostico DESACTIVADOS (DEBUG=false, DEBUG_WORKER=false): imprimir miles
de objetos tambien consume memoria y podia contribuir al cuelgue.

ADVERTENCIA: el subsistema de decodificacion se ha mostrado muy fragil editado a
ciegas (sin navegador). Si esta version sigue trabando o vuelve a poner Chrome en
negro, lo prudente es REVERTIR al decoder original (backup en /tmp) que reproducia
unos segundos sin tumbar el navegador, y reconsiderar el enfoque.

## Resuelto: Chrome ya no se pone en negro. Ahora a diagnosticar el PINTADO
La fuga de GPU esta resuelta (Chrome ya no colapsa) y en la consola YA NO hay
errores de decode ni de keyframe: el decodificador dejo de fallar. Pero el video
sigue trabado en el visor. Eso mueve el problema de DECODIFICACION a PINTADO: el
frame se decodifica pero no se actualiza en pantalla.

Esta version reactiva SOLO el log del worker (ligero), mejorado para mostrar el
timestamp del frame que se va a pintar por capa:
  [worker present] tick=NNN [{clip, isImage, covers, frameTs}]
- frameTs = timestamp (ms) del frame que devuelve frameAt para ese tick.

QUE NECESITO (consola, F12): dale a play y copiame 10-15 lineas [worker present].
Interpretacion:
- frameTs AVANZA con el tick -> el frame avanza; el fallo estaria en el dibujo a
  canvas (drawComposedFrame) -> mirar ahi.
- frameTs QUIETO (mismo numero) -> el buffer no avanza; mirar fill/frameAt.
- frameTs = null -> no hay frame; decodificacion silenciosa.
Con eso localizo el punto exacto sin adivinar.

## CAUSA RAIZ DE LA TRABA: el buffer se atascaba lleno de pasado
Las capturas con frameTs lo revelaron: el tick avanzaba (1432283->1433243->...)
pero frameTs se quedaba CLAVADO (1702). El video reproducia ~1s y se congelaba.
Coincide con "reproduce 1s solo al inicio".

Causa: fill() tenia como condicion de parada `buffer.length < MAX_BUFFER`. El buffer
se llenaba (12) de frames YA PASADOS que dropPast no limpiaba a tiempo, la condicion
se volvia falsa y fill DEJABA DE DECODIFICAR para siempre -> frame congelado.
Ademas insert() tiraba el frame mas FUTURO (pop) al exceder, justo el necesario.

Arreglo:
- fill() llama dropPast() al principio (libera lo consumido = hace sitio).
- La condicion de fill ya NO usa buffer.length; usa framesAhead() < TARGET_AHEAD.
  Asi siempre decodifica mientras falten frames POR DELANTE, sin bloquearse.
- insert() al exceder MAX_BUFFER tira el frame mas ANTIGUO (shift), no el futuro.
- Limites: MAX_BUFFER 20 (holgura), TARGET_AHEAD 8, DECODE_QUEUE_LIMIT 8.

Log DEBUG_WORKER sigue ACTIVO para confirmar que frameTs ahora AVANZA con el tick.
Si avanza y el video se ve fluido, en la siguiente se apaga el log.

## Investigacion: el "Decoding error" era por chunks NO CONTIGUOS
La doc de MDN confirma: VideoDecoder.decode lanza DataError ("chunk relies on other
frames") cuando se envia un chunk delta sin haber enviado antes los frames de los
que depende. Es decir: se estaban SALTANDO chunks en la secuencia. Por eso frameTs
avanzaba un rato (decodificacion contigua) y luego null (se rompia la cadena).

Arreglos (validados con la doc oficial de WebCodecs):
1. fill() ESTRICTAMENTE CONTIGUO: nunca salta un chunk. Si needsKeyframe y el cursor
   no esta en keyframe, REPOSICIONA al keyframe anterior (no avanza saltando). A
   partir de ahi envia todo en orden sin huecos.
2. currentKeyIdx se actualiza al cruzar un keyframe durante la decodificacion
   contigua, para que needSeek NO dispare re-seeks espurios en plena reproduccion
   (esos flushes a media reproduccion rompian la cadena de frames).
3. recoverDecoder(): ante un error usa reset()+configure() (no close), vacia buffer
   y reposiciona en el keyframe del playhead. El callback error asincrono marca
   needsKeyframe y ensureDecoder recrea si quedo closed.

Log DEBUG_WORKER activo para confirmar que frameTs ya NO salta a null. Si frameTs
avanza sostenido y no aparece "Decoding error", esta resuelto y se apagan logs.

## RESUELTO el Decoding error; ahora arreglado el decode REZAGADO
Analisis de los logs del usuario:
- BUENO: el "Decoding error" desaparecio (el fix de decodificacion contigua
  funciono). Solo quedan errores de extensiones del navegador.
- PROBLEMA NUEVO: frameTs se quedaba rezagado (p.ej. 567ms) mientras el tick subia
  mucho (tick 156270 ~= 1736ms). El decode iba MAS LENTO que la reproduccion e
  intentaba alcanzar el playhead frame a frame desde atras, sin lograrlo nunca.

Arreglo (resincronizacion):
- needSeek() reescrito para basarse en los TIMESTAMPS REALES del buffer (no en
  indices de cursor, que iban adelantados y descoordinaban la decision):
  1. target < primer frame del buffer -> re-seek (retroceso).
  2. el frame mas nuevo del buffer va >0.5s (RESYNC_GAP_US) por DETRAS del playhead
     y hay un keyframe entre medias -> SALTA a ese keyframe en vez de perseguir el
     playhead frame a frame. Asi el decode se reengancha cerca del cabezal.
- Quitada la actualizacion fragil de currentKeyIdx al cruzar keyframes en decode
  contiguo (descoordinaba needSeek). Ahora needSeek no depende de esa variable.
- RESYNC_GAP_US = 0.5s: umbral conservador para no re-seekear por desfases pequenos.

Log DEBUG_WORKER activo. Si frameTs ahora SIGUE al tick (sin quedarse rezagado) y
el video corre fluido, esta resuelto y se apagan logs.

## HITO: el video reproduce de inicio a fin. Arreglados scrub y 2o video
Analisis de logs: la reproduccion continua YA FUNCIONA (frameTs sigue al tick).
Quedaban dos problemas, ambos en el camino de SEEK:

1. Scrub (mover el cabezal) se congela:
   - paint() rellena el lienzo de negro y, si frameAt da null (buffer vaciado por el
     seek mientras repuebla), la capa de video no se dibuja -> negro/congelado.
   - Arreglo A: el worker guarda el ULTIMO frame de cada clip como ImageBitmap; si
     frameAt da null, redibuja ese ultimo frame en vez de dejar negro.
   - Arreglo B: seekTo usa reset() (SINCRONO, purga la cola al instante) en vez de
     flush() (async). Elimina la carrera donde frames del flush entraban al buffer
     despues de vaciarlo, y donde el buffer quedaba vacio durante el await.

2. El segundo video se detiene a los pocos segundos:
   - Mismo origen: el seek de resincronizacion (RESYNC_GAP_US) se quedaba a medias por
     la carrera del flush async. Con reset() sincrono el reenganche se completa y el
     2o clip sigue reproduciendo.

La reproduccion normal NO se toca (needSeek=false en play -> seekTo no se llama).
Limpieza: lastFrameBitmaps se cierra al descartar decoders (sin fugas).

Log DEBUG_WORKER activo. Si el scrub ya no se congela y el 2o video reproduce
completo, ESTA RESUELTO -> apagar logs en la siguiente.

## VIDEO RESUELTO Y ESTABLE (logs apagados)
El usuario confirma: reproduce perfecto de inicio a fin y el scrub (mover el cabezal)
ya no se traba. El subsistema de decodificacion de video queda ESTABLE tras toda la
saga (keyframe contiguo, resync por atraso, reset() sincrono en seek, respaldo de
ultimo frame para no parpadear).

Logs de diagnostico APAGADOS (DEBUG=false en clipDecoder.ts, DEBUG_WORKER=false en
playbackWorker.ts). La consola queda limpia.

Notas aclaradas al usuario:
- Los errores "AT-SDK disabled" y "CS WAX not initialized" son de una EXTENSION del
  navegador, no del editor. Ignorables.
- frameTs:"null" puntual al arrancar (tick bajo) es normal: el primer frame se esta
  decodificando; el respaldo de ultimo frame cubre ese instante.
- El "acomodo" de ~0.5s al abrir es el arranque normal (carga de proyecto, fuentes,
  decoders, miniaturas). Cosmetico. NO se toca por ahora para no arriesgar la
  estabilidad recien lograda del video; queda como mejora opcional futura.

## Arquitectura final del ClipDecoder (referencia)
- Buffer de frames por delante del playhead; fill() decodifica CONTIGUO desde
  keyframe (nunca salta chunks -> sin DataError).
- needSeek por timestamps reales del buffer: re-seek si target < buffer (retroceso)
  o si el buffer va >0.5s por detras del playhead (resync por atraso).
- seekTo con reset() sincrono (purga inmediata, sin carrera flush/buffer).
- ensureDecoder recrea si el decoder cae a closed; needsKeyframe garantiza arranque
  en key; generacion de decoder + dispose evitan frames huerfanos (sin fuga GPU).
- Worker conserva ultimo frame por clip (ImageBitmap) para no quedar en negro
  durante la repoblacion del buffer tras un seek.

## DIAGNÓSTICO: primer video se traba al regresar (scrub) — banderas DEBUG ON
Reporte del usuario: al regresar/scrub el PRIMER video se traba; el segundo
fluye y se reposiciona bien. Coincide con un bug histórico del decoder
("scrub congelado / 2º video se detenía: el seek vaciaba el buffer y dejaba un
hueco"). Por protocolo NO se tocó clipDecoder.ts ni playbackWorker.ts todavía.
Se activaron las banderas de depuración para capturar datos antes de cambiar nada:
- clipDecoder.ts: DEBUG = true
- playbackWorker.ts: DEBUG_WORKER = true
SIGUIENTE PASO: el usuario reproduce el fallo (regresar el primer video) con la
consola abierta (F12) y manda la captura. Con el volcado de buffer/frameTs se
localiza la causa. Tras diagnosticar, volver a poner ambas banderas en false.

## MP4 corrupto al exportar (hipótesis fuerte) + diagnóstico "me saca del proyecto"
1) MP4 EXPORTADO ILEGIBLE (ni VLC ni Windows lo abren; error 0xC00D36C4): es bug
   PREEXISTENTE del exporter (1ª vez que el usuario exporta). Causa probable: el
   VideoEncoder producía H.264 en Annex-B y el contenedor MP4 (mp4-muxer 5.2.2)
   necesita AVCC. Fix en exportWorker.ts: añadir avc:{format:"avc"} al
   VideoEncoderConfig (vía cast para no romper tipos si lib.dom no lo declara).
   HIPÓTESIS: no pude verificar contra los typings de mp4-muxer (sin node_modules).
   Si tras esto sigue ilegible, mirar si el muxer recibe el description/avcC en meta.
2) "ENTRO AL PROYECTO Y ME SACA" (siempre; se ve el editor un instante y vuelve a
   proyectos): NO se halló el rebote en el código leído (los 3 showHome son el
   inicial, el de state=null en onOpen, y el botón goHome). Se añadieron LOGS
   TEMPORALES ([nav] onOpen/loadProjectById/startEditor/showHome con stack) para
   ver la secuencia real. Pendiente: el usuario reproduce y manda la consola.
PENDIENTE DE VALIDAR EN NAVEGADOR:
- exportar y probar el MP4 (idealmente en VLC);
- entrar a un proyecto y copiar las líneas [nav] de la consola.
(typecheck no se pudo correr: sin node_modules y npm bloqueado.)

## FIX export: el diálogo Guardar como no abría (activación de usuario)
La versión anterior llamaba showSaveFilePicker DESPUÉS de await exporter.export()
(que tarda). Para entonces se había perdido la "activación de usuario" del clic, y
el navegador BLOQUEA el picker (SecurityError) -> no abría nada.
Fix en runExport(): pedir el destino ANTES de procesar, con el clic aún válido:
1) al pulsar Exportar se abre showSaveFilePicker de inmediato (si el navegador lo
   soporta) y se guarda el handle; cancelar -> "Exportación cancelada".
2) luego se procesa el video (exporter.export) y se escribe en el archivo elegido
   (createWritable/write/close).
3) si el navegador no soporta el picker, respaldo: descarga a Descargas.
Se eliminó el helper saveBlobToFile (ahora todo en runExport). Nuevo tipo
FileSystemWritableTarget para el handle.
PENDIENTE DE VALIDAR EN NAVEGADOR: al pulsar Exportar aparece YA el diálogo Guardar
como; tras elegir, procesa y guarda el MP4 ahí.
(typecheck no se pudo correr: sin node_modules y npm bloqueado.)

## Exportar: diálogo "Guardar como" para elegir carpeta (NUEVO)
Antes el export descargaba el .mp4 directo a la carpeta de Descargas sin preguntar
(a.click() clásico), por eso "no pedía guardar". Ahora usa la File System Access
API (showSaveFilePicker) para abrir el diálogo nativo "Guardar como" y elegir
carpeta y nombre. Nuevo helper saveBlobToFile(blob, nombre) en main.ts:
- si el navegador soporta showSaveFilePicker (Chrome/Edge): abre el diálogo,
  escribe el blob en el archivo elegido; si el usuario cancela -> "Exportación
  cancelada" (no error);
- si NO lo soporta (Firefox/Safari): cae a la descarga automática clásica.
Sugerencia de nombre: <video>-lumen.mp4, tipo video/mp4.
PENDIENTE DE VALIDAR EN NAVEGADOR: al exportar, aparece el diálogo Guardar como;
elegir carpeta guarda el MP4 ahí; cancelar no rompe nada.
(typecheck no se pudo correr: sin node_modules y npm bloqueado.)

## Ajustar imágenes en el visor: mover y redimensionar (NUEVO)
Los tiradores del visor (mover/escalar/rotar) funcionaban para vídeo y texto pero
las IMÁGENES estaban excluidas (la condición exigía kind === "video"). Como
imágenes y vídeos comparten el mismo modelo de transform y el compositor ya las
dibuja con drawComposedFrame (transform incluido), bastó habilitarlas en el
interactor. Cambios en src/ui/previewInteractor.ts:
- update() y el handler de pointerdown: nueva noción isVisual = vídeo O imagen
  (antes isVideo solo vídeo).
- el recuadro de selección de una imagen se ajusta a su PROPORCIÓN real (usa
  asset.width/height con baseScale = min(proj/iw, proj/ih), igual que el
  compositor), en vez de abarcar todo el lienzo. Así abraza la imagen visible.
El resto (rotar/escalar/mover con setClipRotation/Scale/Position) ya era genérico.
La selección de clips de imagen en la timeline ya funcionaba (onSelect genérico).
PENDIENTE DE VALIDAR EN NAVEGADOR: seleccionar una imagen en la timeline muestra el
recuadro con tiradores; se puede mover, escalar (esquinas) y rotar; se refleja en
el visor y se exporta igual.
(typecheck no se pudo correr: sin node_modules y npm bloqueado.)

## FIX: clic en la pestaña de transición no abría el panel (NUEVO)
Mismo patrón que el bug de los botones del riel: el handler de paneo de la timeline
(pointerdown sobre .tl-lanes) hacía setPointerCapture y se TRAGABA el clic de la
pestaña antes de su evento "click". El paneo ignoraba .tl-clip/.tl-kf/.tl-track-ctrls
pero NO .tl-transition. Fix en timeline.ts:
- el paneo ahora también ignora .tl-transition (closest), y
- el marcador hace stopPropagation en su pointerdown.
Ahora clic en la pestaña selecciona la transición y el Inspector muestra su panel.
PENDIENTE DE VALIDAR EN NAVEGADOR: clic en la pestaña verde abre el panel de
transición en el Inspector.
(typecheck no se pudo correr: sin node_modules y npm bloqueado.)

## FIX panel de transición: navegar categorías + quitar clic derecho (NUEVO)
1) BUG: solo se podía cambiar dentro de "Fundidos". renderTransition() forzaba la
   pestaña activa a la categoría del tipo ACTUAL en CADA render; al hacer clic en
   otra pestaña, como el tipo seguía siendo un fundido, lo devolvía a "fade".
   Fix: la sincronización pestaña<-tipo solo ocurre AL ABRIR (nuevo campo
   transOpenedId; se resetea en setSelectedTransition). En renders posteriores la
   pestaña no se toca -> se puede navegar libremente entre las 7 categorías.
2) Se quitó el handler de clic DERECHO (contextmenu) de la pestaña de transición:
   ahora se configura solo con clic normal (el clic derecho no tenía función propia).
PENDIENTE DE VALIDAR EN NAVEGADOR: en el panel de transición se puede cambiar entre
todas las categorías y elegir cualquiera de los 38 tipos; el clic normal abre el
panel; el clic derecho ya no hace nada especial.
(typecheck no se pudo correr: sin node_modules y npm bloqueado.)

## Configuración de transición en el Inspector (NUEVO)
Antes la config de la transición estaba escondida: clic en la pestaña ciclaba/abría
menú y la duración era clic DERECHO (poco descubrible). Ahora, al hacer clic (o
clic derecho) en la pestaña de transición, se SELECCIONA y el Inspector (panel
derecho) muestra su configuración, igual que clips y subtítulos:
- inspector.ts: nuevo estado selectedTransitionId + setSelectedTransition(),
  rama en render() y renderTransition(): pestañas por categoría (reusa .fx-tabs),
  lista de tipos (las 38), botones de duración (0.3/0.5/1/1.5/2 s) y botón
  "Quitar transición". Usa commands.setTransitionType/setTransitionDuration/
  removeTransition.
- timeline.ts: nuevo callback onSelectTransition; el clic en la pestaña ahora
  selecciona la transición (no abre menú). Se eliminaron showTransitionMenu y
  showTransitionTypeMenu (ya no se usan). transitionLabel sigue usando el catálogo.
- main.ts: onSelectTransition -> inspector.setSelectedTransition.
- index.html: estilos .tr-list/.tr-item/.tr-durs/.tr-dur/.insp-sub/.insp-del-btn.
CÓMO SE USA: seleccionar un clip con otro clip después -> botón de transición de la
barra (crea la pestaña) -> clic en la pestaña verde -> el Inspector muestra tipo y
duración.
PENDIENTE DE VALIDAR EN NAVEGADOR: clic en la pestaña abre el panel en el Inspector;
cambiar tipo y duración se refleja; "Quitar transición" la elimina.
(typecheck no se pudo correr: sin node_modules y npm bloqueado.)

## Catálogo de 38 transiciones de video + DEBUG apagado (NUEVO)
El usuario confirmó que el bug del decoder (cruce de clips) quedó resuelto, así que
se APAGARON las banderas: clipDecoder.ts DEBUG=false, playbackWorker.ts
DEBUG_WORKER=false.

Transiciones: ya existía un sistema (TransitionInstance, addTransition,
setTransitionType, compositor con crossfade/wipe/slide). Se amplió a 38 tipos:
- NUEVO src/model/transitions.ts: catálogo por categorías (Fundidos, Barridos,
  Deslizar, Empujar, Iris y formas, Barras y persianas, Zoom y movimiento).
  Helpers transitionById/transitionLabelOf, TRANSITION_SECTIONS.
- compositor.ts ampliado (mismo engine para visor y export):
  · transitionOpacity: + dissolve, fadeBlack/White, flash, blurMix.
  · transitionVeil (NUEVO): velo negro/blanco para fundidos a color/destello,
    pintado una vez en la capa "to" sobre el lienzo.
  · applyTransitionClip: + wipeDown, 4 diagonales, irisIn/Out, boxIn/Out,
    diamondIn/Out, barsH/V, splitH/V, checker (recortes Canvas 2D).
  · drawComposedFrame: + slideUp/Down, push (4 dir), whip, zoomIn/Out (escala +
    alpha), blurMix (ctx.filter blur). transScale aplicado a ctx.scale.
- UI (timeline.ts): el clic en la pestaña de transición ahora ABRE UN MENÚ con el
  catálogo por categorías (showTransitionTypeMenu) en vez de ciclar 7 tipos. Clic
  derecho sigue abriendo el menú de duración. transitionLabel usa el catálogo.
  La pestaña se reestiló como pildora clara (color de acento) acorde a la estética.
Sin tocar el decoder ni el worker de reproducción. Export usa el mismo
drawComposedFrame, así que las transiciones se queman igual.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) crear transición entre dos clips, clic en la pestaña: aparece el menú con ~38
   tipos por categoría; elegir varias y ver que se aplican en el visor;
2) exportar y confirmar que la transición se ve igual en el archivo;
3) la consola ya no está ruidosa (DEBUG off).
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado.)

## FIX v3: clip que entra se queda en frameTs=null (NO frame viejo, NINGÚN frame)
El log del usuario fue decisivo: el clip que entra muestra covers:true pero
frameTs:"null" de forma PERMANENTE (mismo tick repetido, siempre null). O sea el
decoder NO produce ningún frame, no es que sirva uno viejo.
Causa: con buffer vacío, fill() no decodificaba porque decodeCursor había quedado
al FINAL de los chunks (>= chunks.length). El fix v2 de needSeek miraba
chunks[cursor].ts, que con cursor fuera de rango cae a 0, y 0 > target era false
-> no forzaba seek -> fill no entra al while (cursor >= chunks.length) -> nunca
decodifica -> frameAt = null para siempre.
Fix v3 en needSeek (buffer vacío): si decodeCursor >= chunks.length -> seek.
(Además del caso cursorTs > target que ya estaba.) Así rebobina al keyframe del
target y vuelve a decodificar. onFrameReady -> paint repinta cuando el frame sale.
DEBUG sigue en true. Pedir al usuario el detalle de [ClipDecoder] prepare (cursor,
buffer, state) si aún fallara.
PENDIENTE DE VALIDAR EN NAVEGADOR: clic/arrastre cruzando clips ya muestra frame
(no se queda en negro/congelado con frameTs null).

## FIX v2: congelado al cruzar clips (clic Y arrastre) — dos causas
El fix anterior (fill con playhead) no bastaba para el retorno por CLIC. Hay DOS
caminos distintos, ambos por un decoder reactivado tras estar inactivo:

A) RETORNO POR CLIC cruzando clips (clipDecoder.ts needSeek):
   Si el decoder del clip destino tenía el BUFFER VACÍO (estuvo inactivo viendo
   otro clip) y su decodeCursor quedó al FINAL, needSeek devolvía false (no seek) y
   fill() seguía desde el cursor viejo, sin alcanzar el target -> congelado.
   Fix: con buffer vacío, si cursorTs > target, forzar seek (rebobina al keyframe
   correcto). No rompe el arranque inicial ni saltar adelante con buffer vacío.

B) ARRASTRE CONTINUO cruzando clips (playbackWorker.ts onPresent):
   El arrastre dispara muchos present() casi a la vez; sus await resuelven fuera de
   orden y un present de un tick viejo podía pintar DESPUÉS del nuevo, dejando
   pegado el frame del 1er clip. Fix: contador presentGen; si al terminar el await
   ya llegó un present más reciente, este NO pinta (return). Solo pinta el más nuevo.

DEBUG/DEBUG_WORKER siguen en true. Si AMBOS casos quedan validados, apagarlos.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) clic hacia atrás cruzando del 2º al 1º (y 3º->1º, 4º->2º): frame correcto;
2) arrastre continuo del 1º al 2º y de vuelta: sin congelarse;
3) reproducción normal y saltos dentro de un mismo clip siguen fluidos.

## FIX: 1er clip se congela al regresar del 2º clip al 1º
Síntoma (muy acotado por el usuario): SOLO al cruzar hacia atrás del 2º clip al 1º
se congela el 1er video; en cualquier otra condición va fluido.
Causa raíz (confirmada por lectura del código): el worker solo llama prepare() a
las capas que cubren el tick actual. Mientras se reproduce el 2º clip, el decoder
del 1º queda INACTIVO con su decodeCursor al FINAL del clip. Al volver al 1º, en
fill() con needsKeyframe, el keyframe se elegía a partir de decodeCursor (el final)
en vez del playhead -> arrancaba a decodificar desde el final y nunca alcanzaba el
target anterior: frame congelado.
Fix en clipDecoder.ts fill(): cuando needsKeyframe, el keyframe se elige según
this.playheadTs (destino real). Solo se reutiliza el cursor si ya está en un
keyframe Y su ts <= playhead. No afecta arranque inicial, seekTo ni la
reproducción normal hacia adelante (ahí needsKeyframe es false).
DEBUG/DEBUG_WORKER siguen en true. Si esto y el fix anterior quedan validados,
ponerlos en false en la próxima entrega.
PENDIENTE DE VALIDAR EN NAVEGADOR: reproducir el 2º clip, regresar cruzando al 1º
a un punto intermedio; el 1º debe mostrar el frame correcto, no congelarse.

## FIX (hipótesis): frame viejo al regresar a punto intermedio del 1er video
Síntoma confirmado por el usuario: al regresar (scrub atrás) a un punto INTERMEDIO
del primer video, se queda un FRAME VIEJO aunque el tiempo avanza (el decoder no
entrega frame nuevo). El segundo clip va bien. Es un bug reproducible del decoder
(autorizado a tocar, NO a ciegas).
Diagnóstico: needSeek() solo forzaba re-seek si el target quedaba ANTES del primer
frame del buffer (target < oldest). Si el target caía DENTRO del rango del buffer
pero su frame ya no estaba (solo quedaban frames lejanos por detrás), frameAt()
servía el mejor frame <= target, que podía ser muy viejo -> imagen congelada.
Fix en clipDecoder.ts (cambio mínimo y conservador): nueva condición 1b en
needSeek(): si target está en [oldest,newest] pero el mejor frame disponible queda
>STALE_GAP_US (0.25s) por detrás y hay un keyframe más cercano al target, fuerza
re-seek. No altera la reproducción hacia adelante ni el manejo de keyframes/memoria.
NOTA: es una HIPÓTESIS basada en el síntoma + lectura del código; el log completo
de consola se cortó en la captura. DEBUG/DEBUG_WORKER siguen en TRUE por si hay que
afinar. Si queda resuelto, ponerlos en false en la siguiente entrega.
PENDIENTE DE VALIDAR EN NAVEGADOR: regresar a un punto intermedio del primer video
ya muestra el frame correcto (no congelado). Si falla, mandar log de consola.

## Pantalla completa del visor con controles embebidos (NUEVO)
Botón de pantalla completa (icons.fullscreen) en la barra del visor + atajo F.
Usa la Fullscreen API sobre #stage-view (requestFullscreen/exitFullscreen).
En pantalla completa aparecen CONTROLES EMBEBIDOS sobre el video:
- botón grande de play/pausa (#fs-play) que llama controller.toggle();
- barra de progreso (#fs-seek) arrastrable/clicable para hacer seek
  (controller.seek), con relleno + perilla y tiempos actual/total;
- botón para salir (#fs-exit).
Los controles aparecen al mover el ratón y se ocultan tras 2.5 s de quietud
(clase .show-controls). onTick alimenta updateFsControls() (solo si hay
fullscreenElement). fullscreenchange ajusta el icono del botón y recoloca el
visor. El recuadro de edición de títulos se oculta en fullscreen.
Iconos nuevos: fullscreen, fullscreenExit (icons.ts).
NO se tocó el decoder ni el playbackWorker: el play/seek embebidos reutilizan el
controller existente. El canvas (OffscreenCanvas) se escala con max-width/height
100vw/vh manteniendo proporción.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) el botón (y F) entra/sale de pantalla completa;
2) el play embebido reproduce/pausa y su icono cambia;
3) la barra hace seek al arrastrar/click y refleja el avance;
4) los controles se ocultan solos y vuelven al mover el ratón;
5) al salir, el visor vuelve a la normalidad.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado.)

## Paneles redimensionables (NUEVO)
Se pueden redimensionar arrastrando divisores (gutters) entre paneles, para dar
más espacio a lo que se necesite:
- biblioteca (izquierda): ancho 200–520px
- inspector (derecha): ancho 220–560px
- timeline (abajo): alto 160–640px
Implementación: src/ui/resizers.ts (NUEVO) con setupResizers(root, onResize).
Gutters añadidos en el shell (main.ts): .gutter-col entre paneles, .gutter-row
sobre la timeline; estilos .gutter en index.html. Cada gutter:
- arrastra para cambiar el tamaño (col-resize / row-resize),
- doble clic restablece al tamaño por defecto,
- el tamaño se persiste en localStorage (lumen.panel.*) y se restaura al abrir.
onResize re-actualiza el recuadro del visor (previewInteractor.update) y la
timeline (timeline.render). min de la timeline alineado con el CSS (160px).
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) arrastrar cada divisor redimensiona el panel correspondiente;
2) el tamaño se conserva tras recargar;
3) doble clic en un divisor lo restablece;
4) el visor y la timeline se ven bien tras redimensionar.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado.)

## Fix: papelera del riel de pista no respondía (NUEVO)
Los botones DENTRO del riel de cada pista (papelera para eliminar la pista) no
hacían nada, aunque el de la barra superior sí. Causa: el handler de paneo
(pointerdown sobre .tl-lanes) hacía setPointerCapture y se TRAGABA el clic antes
de que el botón recibiera su evento "click". Solo ignoraba .tl-clip y .tl-kf, no
el riel. Fix en timeline.ts:
- el paneo ahora también ignora .tl-track-ctrls (closest), y
- cada riel (pista normal y subtítulos) hace stopPropagation en su pointerdown.
La confirmación y removeTrack ya estaban; ahora el clic por fin llega.
PENDIENTE DE VALIDAR EN NAVEGADOR: la papelera del riel de cada pista pide
confirmación y elimina la pista; Ctrl+Z la recupera.

## Eliminar pista completa + solo mostrar pistas en uso (NUEVO)

### Por qué "no eliminaba nada"
clearTrack solo vaciaba los clips pero CONSERVABA la pista vacía, así que la fila
seguía visible y parecía que no pasaba nada. Reemplazado por removeTrack(trackId)
(store.ts): borra los clips, sus transiciones, la pista del estado Y su id de
project.trackIds. La pista desaparece por completo. Reversible con Ctrl+Z.

### Solo se muestran las pistas con contenido
- Se quitó el sistema de "placeholders" (emptyVisibleTracks) y el método
  addEmptyTrack. Ahora la regla es simple: una pista sin clips no se pinta
  (timeline.ts: if (track.clipIds.length === 0) continue).
- Se quitaron los botones "Pista" y "Audio" de la barra superior de la timeline
  (creaban pistas vacías a propósito). Las pistas aparecen solas al importar
  audio/imagen/vídeo o añadir un título (se crean ya con su primer clip).
- La pista de subtítulos tampoco se pinta si no hay subtítulos (se generan desde
  el panel lateral "Subtítulos").

### Papelera por pista
El botón papelera del riel de cada pista ahora elimina la pista entera (antes
"vaciar"), con confirm() y Ctrl+Z. Audio conserva mute/solo/volumen.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) la papelera de cada pista la elimina por completo (y Ctrl+Z la recupera);
2) ya no aparecen pistas vacías; al importar algo, su pista aparece sola;
3) ya no están los botones "Pista"/"Audio" arriba.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado.)

## Riel de controles fijo + eliminar por pista (NUEVO, opción A)

### Riel fijo a la izquierda (como CapCut/Premiere)
Antes los controles de pista flotaban (position:absolute) ENCIMA de los clips, se
veían mezclados y feos. Ahora hay un RIEL FIJO de 132px a la izquierda (constante
Timeline.RAIL_W) donde vive el nombre y los botones de cada pista; se queda pegado
al hacer scroll horizontal (position:sticky; left:0; z-index alto; fondo opaco).
Para que las coordenadas sigan cuadrando se separaron 3 conversiones:
- tickToPx(t): POSICIÓN, ahora suma RAIL_W (clips, playhead, marcas, seek).
- tickToWidth(dur): ANCHO de una duración, SIN offset (todos los style.width).
- pxToTickDelta(px): DISTANCIA/delta, SIN offset (arrastre de clips, snapping).
- pxToTick(px): posición absoluta del ratón, resta RAIL_W (seek, zoom anchor).
El ruler lleva un tapón de esquina (.tl-ruler-corner) sobre la zona del riel.
RIESGO: tocó el cálculo de coordenadas de toda la timeline (arrastre, recorte,
snapping, playhead, zoom). Revisado a mano pero NO probado en navegador: hay que
verificar que arrastrar/recortar clips, el snapping y el cabezal siguen exactos.

### Eliminar contenido en TODAS las pistas (con confirmación)
Antes solo audio tenía controles. Ahora el riel de CADA pista (vídeo, imagen,
texto, audio) tiene botón papelera que vacía su contenido, con confirm() y
reversible con Ctrl+Z. Nuevo comando store.clearTrack(trackId) (borra los clips de
la pista y sus transiciones, conserva la pista). Audio conserva mute/solo/volumen.

### Botón "eliminar todos los subtítulos"
El riel de subtítulos se reorganizó (+, formato, papelera) dentro del riel fijo.
El borrado vuelve a llevar confirm() (lo pidió el usuario) y usa clearCaptions().
La causa de que "no funcionara" era casi seguro que el botón quedaba TAPADO por un
clip al estar el control flotando encima; con el riel fijo el botón ya es accesible.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) que el riel se vea ordenado y NO tape los clips, y se quede fijo al hacer scroll;
2) arrastrar/recortar clips, snapping y cabezal siguen exactos (lo más importante);
3) papelera por pista borra su contenido (con confirmación) y Ctrl+Z lo recupera;
4) papelera de subtítulos ya funciona.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado.)

## Subtítulos: más precisión en español + primer subtítulo alineado (NUEVO)

### Mejor predicción (modelos más grandes)
La precisión de palabras la determina sobre todo el MODELO. Antes solo Tiny/Base
(los que más fallan). Selector de modelo ampliado en main.ts:
- Tiny (~75 MB), Base (~145 MB, por defecto), Small (~250 MB, mejor en español),
  Large v3 Turbo (~800 MB, el más preciso, lento sin WebGPU).
transcribeWorker.ts: para modelos grandes (small/medium/large) se cargan pesos
CUANTIZADOS (dtype: encoder fp32 + decoder q4) para que la descarga/memoria sean
viables en el navegador. Los pequeños siguen en fp32.
NOTA HONESTA: los modelos grandes descargan cientos de MB la primera vez y, sin
GPU (WebGPU), pueden tardar bastante. Es un compromiso calidad/velocidad que el
usuario elige según su equipo. Los nombres exactos de modelo (onnx-community/
whisper-small, whisper-large-v3-turbo) deben verificarse en el navegador: si
alguno no carga, se revierte a Base.

### El primer subtítulo ya no arranca en el segundo 0
Whisper reporta el primer segmento desde ~0 aunque la voz empiece después.
transcribeWorker.ts: detectSpeechStart() mide la energía (RMS) del audio en
ventanas de 20 ms y encuentra dónde empieza realmente la voz (umbral = 8% del
pico, exige 60 ms seguidos para ignorar chasquidos). buildSegments(chunks,
speechStart) desplaza el inicio del PRIMER subtítulo a ese punto (sin pasarse del
final del segmento). El resto de tiempos no se tocan.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) probar Small / Large v3 Turbo y comparar precisión (ojo a la descarga inicial);
2) confirmar que el primer subtítulo aparece cuando empieza la voz, no en 0:00.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado.)

## Pantalla de inicio (proyectos) + guardado (NUEVO, cambio grande)

NOTA: es una app WEB, no de escritorio, así que NO puede crear una carpeta en el
sistema de archivos del usuario. La "carpeta propia" del software es el
almacenamiento persistente del navegador: IndexedDB (estado del proyecto) + OPFS
(medios). Es lo que ya usaba el proyecto.

### Multi-proyecto (storage/projectStore.ts reescrito)
Antes guardaba UN solo proyecto bajo la clave "current". Ahora:
- DB version 2 con 2 object stores: "projects" (estado completo, clave =
  project.id) y "meta" (metadatos ligeros para la galería).
- Nuevas funciones: saveProject(state, thumb?), listProjects(), loadProjectById(id),
  deleteProject(id), migrateLegacyProject() (migra el viejo "current" una vez).
- migrate() (relleno de campos de esquemas viejos) se conserva intacto.
- Tipo ProjectMeta { id, name, updatedAt, width, height, durationTick, thumb? }.

### Pantalla de inicio (ui/projectsScreen.ts NUEVO)
- Título grande "Lumen Studio", tarjetas de proyectos recientes (nombre, dims,
  "hace X", duración) y un recuadro punteado "+ Nuevo proyecto".
- Cada tarjeta: abrir al clic, botón papelera para eliminar (con confirm).
- Preview estático: por ahora muestra un placeholder (icono). LIMITACIÓN REAL: el
  canvas del visor está transferido a un worker (OffscreenCanvas), así que el hilo
  principal no puede leer sus píxeles con toDataURL. captureThumb() devuelve
  undefined por ahora; mejorable pidiendo el frame al worker (no se tocó el worker).

### Flujo y guardado (main.ts reestructurado)
- boot() ahora arranca en la home (showHome()). startEditor(state) monta el editor
  con el proyecto elegido (antes todo vivía dentro de boot()).
- Botón "Guardar" en el header + atajo Ctrl/⌘+S (doSave()).
- Autosave con rebote (800 ms tras cada cambio) Y autosave de seguridad cada 10 min.
- beforeunload: si hay cambios sin guardar (dirty), intenta guardar y avisa al salir.
- Botón "volver a proyectos" (home-btn): si hay cambios sin guardar, abre un diálogo
  "¿Guardar tu proyecto?" (Guardar y salir / Salir sin guardar / Cancelar).
  Al salir limpia interval y beforeunload para no acumular listeners.
Estilos nuevos en index.html: .home*, .pj-*, .save-dialog*, .btn-ghost.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) al abrir la app debe verse la galería (con tu proyecto anterior ya migrado);
2) "+ Nuevo proyecto" crea y entra al editor;
3) botón Guardar / Ctrl+S marca "Guardado ✓"; cerrar pestaña con cambios avisa;
4) volver a proyectos con cambios muestra el diálogo de guardar;
5) eliminar un proyecto desde su tarjeta.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado; el usuario confirmó EXIT 0 en entregas anteriores.)

## Fix transcripción + borrar todos + borrar medios (NUEVO)

### Error "Model outputs must contain cross attentions"
return_timestamps: "word" exige que el modelo se exportara con
output_attentions=True; los onnx-community/whisper-* públicos NO lo traen, así
que la transcripción fallaba siempre. Solución: se volvió a return_timestamps:
true (segmento/frase, compatible) y AHORA TROCEAMOS NOSOTROS en transcribeWorker.ts:
- splitIntoLines(): parte cada frase en sub-líneas de ~42 chars / ~7 palabras,
  cortando tras puntuación.
- buildSegments(): reparte el intervalo [start,end] de la frase entre sus
  sub-líneas proporcional a su nº de caracteres. Sync aproximado dentro de la
  frase (no por palabra, que el modelo no soporta) pero correcto frase a frase.

### Botón "eliminar todos los subtítulos" no funcionaba
Causa probable: confirm() suprimido en algunos contextos devolvía false y
cancelaba el borrado. Se quitó confirm(); ahora borra directo con un comando
dedicado commands.clearCaptions() (store.ts). Reversible con Ctrl+Z.

### Medios borrados seguían apareciendo (p.ej. en selector de subtítulos)
No existía forma de borrar un ASSET: el usuario solo borraba el clip, y el asset
quedaba en st.assets -> seguía en el selector. Añadido:
- store.ts commands.removeAsset(id): borra el asset Y todos sus clips (limpiando
  pistas y transiciones), luego recomputeDuration.
- main.ts: cada media-card lleva ahora un botón papelera (.media-del) que llama
  removeAsset + afterEditAsync + renderLibrary.
- index.html: estilos .media-del (aparece al pasar el ratón sobre la card).
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) generar subtítulos: ya NO debe dar el error y deben salir en líneas cortas;
2) botón papelera de subtítulos: borra todos;
3) borrar un medio desde su card: desaparece de la biblioteca y del selector,
   y se van sus clips de la timeline.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado; el usuario confirmó EXIT 0 en entregas anteriores.)

## Subtítulos: sync por palabra + botones de pista (NUEVO)

### Mejor sincronización y fin de "textos enormes"
Antes cada chunk de Whisper (a veces una frase de hasta 30 s) se volvía UN cue
gigante y mal sincronizado. Ahora:
- transcribeWorker.ts pide return_timestamps: "word" (timestamps por PALABRA).
- Nueva función buildSegments() reagrupa palabras en subtítulos cortos tipo
  CapCut: corta al superar ~42 caracteres o ~7 palabras, o ~3.5 s de duración,
  o tras puntuación fuerte (. ? ! …), o si hay un silencio >0.6 s entre palabras.
  Esto da líneas legibles y bien pegadas al audio.
Constantes ajustables al inicio del worker: MAX_CHARS, MAX_WORDS, MAX_DUR_S, GAP_S.

### Botón "eliminar todos" y "cambiar formato a todos"
En los controles de la pista de Subtítulos (timeline.ts, paintSubtitleTrack),
junto al botón "+", ahora aparecen (solo si hay subtítulos):
- Papelera (data-sub="clear"): elimina TODOS los subtítulos de una vez
  (setCaptions([])), con confirm() de seguridad. Recuerda que Ctrl+Z lo deshace.
- Formato (data-sub="format", icono texto): abre un menú (showSubtitleFormatMenu)
  con presets (Limpio, Con caja, Contorno, Llamativo, Acento, Sutil) que aplican
  un Partial<SubtitleStyle> al estilo GLOBAL via setSubtitleStyle -> cambia el
  formato de TODOS los subtítulos a la vez. onEdit() reempuja al visor.
Nuevo archivo: src/captions/subtitlePresets.ts (SUBTITLE_PRESETS).
Reutiliza estilos CSS existentes (.tl-tbtn, .tl-kf-menu). Sin CSS nuevo.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) regenerar subtítulos: deben salir en líneas cortas y bien sincronizadas;
2) botón papelera: borra todos (probar Ctrl+Z);
3) botón formato: el menú cambia el aspecto de todos los subtítulos.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y npm
bloqueado; el usuario confirmó EXIT 0 en su máquina para la entrega anterior.)

## Subtítulos en español + reproducción con solo audio (NUEVO)

### Idioma español (antes salían en inglés)
El Transcriber aceptaba `language` pero runTranscription nunca lo pasaba, así que
Whisper autodetectaba y a veces TRADUCÍA al inglés. Arreglos:
- main.ts: runTranscription ahora llama transcribe(file, { model, language:
  "spanish" }, ...). (Whisper usa nombres de idioma en inglés; "spanish" cubre el
  español. El modelo NO distingue variantes regionales, así que sale español
  neutro, no "mexicano" con modismos; es el límite del modelo.)
- transcribeMessages.ts: ToAsr gana campo task?: "transcribe" | "translate".
- transcribeWorker.ts: pasa task: msg.task ?? "transcribe" a Whisper. Sin task
  explícito, algunos modelos traducen al inglés (causa real del bug).
- transcriber.ts: arma el mensaje con task: "transcribe".

### Reproducción con SOLO audio (antes pantalla negra congelada)
setTimeline solo recibe clips VISUALES y de ahí salía durationTick; con solo
audio quedaba en 0 y play() salía temprano (no avanzaba). Fix en playback.ts
setProject(): recalcula durationTick = max(actual, fin del clip más tardío de
TODOS los clips del proyecto) usando clipDuration() del modelo. Así el reloj de
audio avanza y el worker (que ya pinta #000 de fondo cada frame) muestra pantalla
negra mientras suena el audio. NO se tocó el decoder ni el playbackWorker.
PENDIENTE DE VALIDAR EN NAVEGADOR:
1) generar subtítulos: deben salir en español;
2) proyecto con solo audio: debe reproducir de inicio a fin en negro, con la barra
   de tiempo avanzando, y detenerse al final.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y registro
npm bloqueado; el usuario confirmó EXIT 0 en su máquina para la entrega anterior.)

## Selección de fuente de audio para subtítulos (NUEVO)
La pestaña «Subtítulos» ya generaba automáticos con Whisper, pero tomaba el
primer asset video/con-audio de forma arbitraria. Ahora:
- Lista TODAS las fuentes con audio (videos con hasAudio + audios) en la
  variable audioSources.
- Default inteligente: si hay un clip SELECCIONADO en la timeline cuyo asset
  tenga audio, esa es la fuente por defecto; si no, cuando solo hay UNA fuente
  se usa esa directamente (sin selector); si hay varias, se muestra un <select>
  (#cap-source) para elegir, preseleccionando el default.
- El texto de ayuda refleja el caso: sin fuentes / elige fuente / "Se usará el
  audio de «X»".
- Si no hay ninguna fuente, el botón "Generar automáticos" queda deshabilitado.
- runTranscription recibe el opfsPath de la fuente elegida (o el default).
Todo en src/main.ts, dentro de renderLibrary() (rama activeTab === "captions").
Sin imports nuevos. PENDIENTE DE VALIDAR EN NAVEGADOR:
1) con un solo audio/video: que use ese y muestre "Se usará el audio de «X»";
2) con varios: que aparezca el selector y respete la elección;
3) con un clip seleccionado: que el selector arranque en su asset.
(typecheck no se pudo correr en el entorno del agente: sin node_modules y
registro npm bloqueado; validar con tsc --noEmit en tu maquina.)

## Insignia de efecto en la timeline (NUEVO)
Sobre cada bloque de clip VISUAL (video/imagen) que tenga un efecto aplicado
(clip.effectId definido) se muestra una insignia tipo pildora en la esquina
inferior derecha: icono sparkles + nombre del efecto (effectById(id).label).
- Solo aparece si el clip tiene efecto; clips sin efecto no muestran nada.
- No aparece en clips de audio ni de texto (isVisual = !isText && !isAudio).
- Clic en la insignia QUITA el efecto: dispatch(setClipEffect(clipId, null)) +
  onEdit() + render(). Al pasar el raton, la pildora se tine de rojo y cambia
  el texto a "Quitar" para dejar claro que es destructiva.
- pointerdown hace stopPropagation para no iniciar el arrastre del clip al tocarla.
Implementado en src/timeline/timeline.ts (HTML del clip + handler + CSS .tl-fx).
Import nuevo: effectById desde ../model/videoEffects.
PENDIENTE DE VALIDAR EN NAVEGADOR: que la insignia se vea bien y que el clic la
elimine. (typecheck no se pudo correr en el entorno del agente: sin node_modules
y registro npm bloqueado; validar con tsc --noEmit en tu maquina.)

## Pendiente (siguientes fases, NO criticas)
- (Opcional) Suavizar el "acomodo" visual del arranque.
- Duracion de transicion arrastrando el borde del marcador (hoy por menu).
- Thumbnails tambien para clips de video (imagen ya tiene).
- Mantener proporcion al escalar con tecla modificadora.
