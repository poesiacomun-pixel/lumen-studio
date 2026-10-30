// Decodifica el audio de un archivo y lo entrega como PCM mono a 16 kHz, que es
// exactamente lo que Whisper espera. Sin este remuestreo, la transcripción sale
// como ruido. Se hace en el hilo principal porque AudioContext no está
// disponible dentro de los workers.

const TARGET_RATE = 16000;

export async function extractMonoPCM16k(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();

  // Al fijar sampleRate en el AudioContext, decodeAudioData ya remuestrea a 16 kHz.
  const ctx = new AudioContext({ sampleRate: TARGET_RATE });
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }

  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  // mezcla a mono promediando los canales
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  return mono;
}
