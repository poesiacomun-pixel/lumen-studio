// Wrapper mínimo sobre VideoDecoder (WebCodecs). Para el Hito 1 decodificamos
// un lote de chunks y nos quedamos con los primeros frames. En fases siguientes
// esto vivirá en un worker y decodificará bajo demanda alrededor del playhead.

export async function decodeFrames(
  config: VideoDecoderConfig,
  chunks: EncodedVideoChunk[],
  maxFrames = 1,
): Promise<VideoFrame[]> {
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(`El navegador no soporta este códec: ${config.codec}`);
  }

  const frames: VideoFrame[] = [];
  let decodeError: unknown = null;

  const decoder = new VideoDecoder({
    output: (frame) => frames.push(frame),
    error: (e) => {
      decodeError = e;
    },
  });

  decoder.configure(config);
  for (const chunk of chunks) decoder.decode(chunk);
  // flush() espera a que se emitan todos los frames de los chunks encolados.
  await decoder.flush().catch((e) => {
    decodeError = e;
  });
  decoder.close();

  if (decodeError) throw decodeError;

  // Nos quedamos con los primeros maxFrames y cerramos el resto (la memoria
  // GPU de un VideoFrame no se libera sola: hay que llamar a close()).
  const keep = frames.slice(0, maxFrames);
  for (const extra of frames.slice(maxFrames)) extra.close();
  return keep;
}
