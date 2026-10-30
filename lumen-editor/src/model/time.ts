// Tiempo en ticks enteros para evitar el drift del punto flotante.
// 90000 es divisible por las tasas de cuadro comunes (24, 25, 30, 60) y
// representa NTSC (30000/1001) de forma exacta.

export const TICKS_PER_SECOND = 90_000;

/** Tiempo en ticks. Convención: todo campo temporal del modelo es entero. */
export type Ticks = number;

/** Cuadros por segundo. P.ej. 24, 25, 30, 60. NTSC: 30000/1001 ≈ 29.97 */
export type Fps = number;

export function secondsToTicks(seconds: number): Ticks {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(tick: Ticks): number {
  return tick / TICKS_PER_SECOND;
}

export function ticksPerFrame(fps: Fps): number {
  return TICKS_PER_SECOND / fps;
}

export function framesToTicks(frames: number, fps: Fps): Ticks {
  return Math.round((frames * TICKS_PER_SECOND) / fps);
}

export function ticksToFrame(tick: Ticks, fps: Fps): number {
  return Math.floor((tick * fps) / TICKS_PER_SECOND);
}

/** Alinea un tick al borde de cuadro más cercano (útil para snapping). */
export function snapToFrame(tick: Ticks, fps: Fps): Ticks {
  const tpf = ticksPerFrame(fps);
  return Math.round(Math.round(tick / tpf) * tpf);
}

/** Formatea como HH:MM:SS:FF (timecode). */
export function formatTimecode(tick: Ticks, fps: Fps): string {
  const rounded = Math.round(fps);
  const totalFrames = ticksToFrame(tick, fps);
  const f = totalFrames % rounded;
  const totalSeconds = Math.floor(totalFrames / rounded);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}
