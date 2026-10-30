import type { Animated, Easing, Transform } from "./types";
import type { Ticks } from "./time";

const EASERS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  hold: () => 0, // mantiene el valor del keyframe previo hasta el siguiente
};

export function makeStatic(value: number): Animated {
  return { kind: "static", value };
}

/**
 * Inserta o actualiza un keyframe en `tick` con `value`. Convierte una propiedad
 * estática en animada (sembrando el valor previo en tick 0 si hace falta para no
 * perder el estado actual). Devuelve una nueva propiedad animada; los keyframes
 * quedan ordenados por tick. `idFor` genera el id del nuevo keyframe.
 */
export function setKeyframe(
  prop: Animated,
  tick: Ticks,
  value: number,
  easing: Easing,
  idFor: () => string,
): Animated {
  const kfs = prop.kind === "animated"
    ? prop.keyframes.map((k) => ({ ...k }))
    : (tick === 0 ? [] : [{ id: idFor(), tick: 0 as Ticks, value: prop.value, easing }]);

  const existing = kfs.find((k) => k.tick === tick);
  if (existing) {
    existing.value = value;
    existing.easing = easing;
  } else {
    kfs.push({ id: idFor(), tick, value, easing });
  }
  kfs.sort((a, b) => a.tick - b.tick);
  return { kind: "animated", keyframes: kfs };
}

/** Si una propiedad animada tiene 0 o 1 keyframe, la colapsa a estática. */
export function simplify(prop: Animated): Animated {
  if (prop.kind === "static") return prop;
  if (prop.keyframes.length === 0) return makeStatic(0);
  if (prop.keyframes.length === 1) return makeStatic(prop.keyframes[0].value);
  return prop;
}

/** Cambia la curva de easing del keyframe en `tick` (hacia el siguiente). */
export function setKeyframeEasing(prop: Animated, tick: Ticks, easing: Easing): Animated {
  if (prop.kind === "static") return prop;
  const kfs = prop.keyframes.map((k) => (k.tick === tick ? { ...k, easing } : k));
  return { kind: "animated", keyframes: kfs };
}

/**
 * Elimina el keyframe en `tick`. Si tras quitarlo queda 0 o 1 keyframe, la
 * propiedad vuelve a ser estática (conservando el último valor).
 */
export function removeKeyframe(prop: Animated, tick: Ticks): Animated {
  if (prop.kind === "static") return prop;
  const kfs = prop.keyframes.filter((k) => k.tick !== tick);
  return simplify({ kind: "animated", keyframes: kfs });
}

/**
 * Reubica el keyframe que está en `fromTick` a `toTick`, conservando su valor y
 * easing. Si en `toTick` ya hay otro keyframe, lo sustituye (fusión). Mantiene el
 * orden por tick. Si no hay keyframe en `fromTick`, devuelve la propiedad igual.
 */
export function moveKeyframe(prop: Animated, fromTick: Ticks, toTick: Ticks): Animated {
  if (prop.kind === "static") return prop;
  const src = prop.keyframes.find((k) => k.tick === fromTick);
  if (!src) return prop;
  const kfs = prop.keyframes
    .filter((k) => k.tick !== fromTick && k.tick !== toTick)
    .concat({ ...src, tick: toTick });
  kfs.sort((a, b) => a.tick - b.tick);
  return { kind: "animated", keyframes: kfs };
}

/**
 * Evalúa una propiedad (constante o animada) en un instante dado.
 * Esta es la única función que el motor necesita para resolver cualquier
 * parámetro animable: transform, opacidad, parámetros de efectos, etc.
 */
export function evaluate(prop: Animated, tick: Ticks): number {
  if (prop.kind === "static") return prop.value;

  const kfs = prop.keyframes;
  if (kfs.length === 0) return 0;
  if (tick <= kfs[0].tick) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (tick >= last.tick) return last.value;

  // localizar el par de keyframes que rodea a `tick`
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].tick <= tick) i++;
  const a = kfs[i];
  const b = kfs[i + 1];
  const span = b.tick - a.tick;
  const localT = span === 0 ? 0 : (tick - a.tick) / span;
  const eased = EASERS[a.easing](localT);
  return a.value + (b.value - a.value) * eased;
}

export function defaultTransform(): Transform {
  return {
    x: makeStatic(0),
    y: makeStatic(0),
    scaleX: makeStatic(1),
    scaleY: makeStatic(1),
    rotation: makeStatic(0),
    anchorX: makeStatic(0.5),
    anchorY: makeStatic(0.5),
  };
}
