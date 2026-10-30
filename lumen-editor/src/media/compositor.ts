import type { ComposeMsg, TransitionMsg } from "../media/playbackMessages";
import type { Transform, Animated, BlendMode } from "../model/types";
import { evaluate } from "../model/animated";
import { effectById } from "../model/videoEffects";

const BLEND_CSS: Record<ComposeMsg["blendMode"], GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  add: "lighter",
};

export function defaultCompose(): ComposeMsg {
  return {
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    anchorX: 0.5, anchorY: 0.5, opacity: 1, blendMode: "normal",
    effectId: undefined,
  };
}

/**
 * Evalúa un transform animable (con keyframes), su opacidad y su modo de fusión
 * en un instante local del clip, produciendo el `ComposeMsg` listo para dibujar.
 * Compartido por la vista previa y la exportación, de modo que las animaciones de
 * transform/opacidad se ven igual en el visor y en el archivo final.
 */
export function evaluateCompose(
  transform: Transform,
  opacity: Animated,
  blendMode: BlendMode,
  localTick: number,
  effectId?: string,
): ComposeMsg {
  return {
    x: evaluate(transform.x, localTick),
    y: evaluate(transform.y, localTick),
    scaleX: evaluate(transform.scaleX, localTick),
    scaleY: evaluate(transform.scaleY, localTick),
    rotation: evaluate(transform.rotation, localTick),
    anchorX: evaluate(transform.anchorX, localTick),
    anchorY: evaluate(transform.anchorY, localTick),
    opacity: evaluate(opacity, localTick),
    blendMode,
    effectId,
  };
}

/**
 * Multiplicador de opacidad de la capa según la transición. Para los efectos de
 * tipo "fundido", la opacidad del saliente baja y la del entrante sube.
 */
function transitionOpacity(tr: TransitionMsg): number {
  const p = Math.max(0, Math.min(1, tr.progress));
  switch (tr.type) {
    case "crossfade":
    case "fade":
    case "dissolve":
    case "blurMix":
      return tr.role === "from" ? 1 - p : p;
    case "fadeBlack":
    case "fadeWhite":
      // a medio camino el frame se desvanece del todo (el velo lo cubre)
      return tr.role === "from" ? Math.max(0, 1 - p * 2) : Math.max(0, p * 2 - 1);
    case "flash":
      // destello: ambos visibles, el velo blanco hace el corte
      return tr.role === "from" ? 1 - p : p;
    default:
      return 1; // wipe/slide/iris/etc. no cambian opacidad (usan recorte/posición)
  }
}

/** Color de velo para fundidos a color/destello, o null si no aplica. */
function transitionVeil(tr: TransitionMsg): { color: string; alpha: number } | null {
  const p = Math.max(0, Math.min(1, tr.progress));
  if (tr.type === "fadeBlack") {
    const a = 1 - Math.abs(p - 0.5) * 2; // pico de opacidad en el medio
    return { color: "#000000", alpha: a };
  }
  if (tr.type === "fadeWhite" || tr.type === "flash") {
    const a = 1 - Math.abs(p - 0.5) * 2;
    return { color: "#ffffff", alpha: tr.type === "flash" ? a * 0.85 : a };
  }
  return null;
}

/**
 * Define una región de recorte en el lienzo para los efectos de barrido/deslizado.
 * Devuelve true si aplicó un clip (el llamador debe haber hecho ctx.save()).
 */
function applyTransitionClip(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  tr: TransitionMsg,
): void {
  const p = Math.max(0, Math.min(1, tr.progress));
  // el entrante se revela; el saliente se oculta en complemento
  const reveal = tr.role === "to" ? p : 1 - p;
  const isTo = tr.role === "to";
  ctx.beginPath();
  switch (tr.type) {
    case "wipeLeft": {
      const x = isTo ? 0 : w * (1 - reveal);
      ctx.rect(x, 0, w * reveal, h); ctx.clip(); break;
    }
    case "wipeRight": {
      const x = isTo ? w * (1 - reveal) : 0;
      ctx.rect(x, 0, w * reveal, h); ctx.clip(); break;
    }
    case "wipeUp": {
      const y = isTo ? h * (1 - reveal) : 0;
      ctx.rect(0, y, w, h * reveal); ctx.clip(); break;
    }
    case "wipeDown": {
      const y = isTo ? 0 : h * (1 - reveal);
      ctx.rect(0, y, w, h * reveal); ctx.clip(); break;
    }
    case "wipeTL": case "wipeTR": case "wipeBL": case "wipeBR": {
      // barrido diagonal: rectángulo crecente anclado a una esquina
      const rw = w * reveal, rh = h * reveal;
      let x = 0, y = 0;
      const fromCorner = !isTo;
      if (tr.type === "wipeTL") { x = fromCorner ? w - rw : 0; y = fromCorner ? h - rh : 0; }
      if (tr.type === "wipeTR") { x = fromCorner ? 0 : w - rw; y = fromCorner ? h - rh : 0; }
      if (tr.type === "wipeBL") { x = fromCorner ? w - rw : 0; y = fromCorner ? 0 : h - rh; }
      if (tr.type === "wipeBR") { x = fromCorner ? 0 : w - rw; y = fromCorner ? 0 : h - rh; }
      ctx.rect(x, y, rw, rh); ctx.clip(); break;
    }
    case "irisIn": case "irisOut": {
      // círculo que crece (in) revelando el entrante desde el centro
      const grow = tr.type === "irisIn" ? reveal : 1 - reveal;
      const r = Math.hypot(w, h) / 2 * grow;
      ctx.arc(w / 2, h / 2, Math.max(0, r), 0, Math.PI * 2);
      if (tr.type === "irisOut" ? !isTo : isTo) { ctx.clip(); }
      else { ctx.rect(0, 0, w, h); ctx.arc(w / 2, h / 2, Math.max(0, r), 0, Math.PI * 2, true); ctx.clip("evenodd"); }
      break;
    }
    case "boxIn": case "boxOut": {
      const grow = tr.type === "boxIn" ? reveal : 1 - reveal;
      const bw = w * grow, bh = h * grow;
      ctx.rect((w - bw) / 2, (h - bh) / 2, bw, bh);
      if (tr.type === "boxOut" ? !isTo : isTo) ctx.clip();
      else { ctx.rect(0, 0, w, h); ctx.rect((w - bw) / 2, (h - bh) / 2, bw, bh); ctx.clip("evenodd"); }
      break;
    }
    case "diamondIn": case "diamondOut": {
      const grow = tr.type === "diamondIn" ? reveal : 1 - reveal;
      const rx = (w / 2) * grow * 1.4, ry = (h / 2) * grow * 1.4;
      const cxp = w / 2, cyp = h / 2;
      const drawDiamond = () => {
        ctx.moveTo(cxp, cyp - ry); ctx.lineTo(cxp + rx, cyp);
        ctx.lineTo(cxp, cyp + ry); ctx.lineTo(cxp - rx, cyp); ctx.closePath();
      };
      drawDiamond();
      if (tr.type === "diamondOut" ? !isTo : isTo) ctx.clip();
      else { ctx.rect(0, 0, w, h); drawDiamond(); ctx.clip("evenodd"); }
      break;
    }
    case "barsH": {
      // persiana: franjas horizontales que se abren
      const n = 8;
      for (let i = 0; i < n; i++) ctx.rect(0, (i / n) * h, w, (h / n) * reveal);
      ctx.clip(); break;
    }
    case "barsV": {
      const n = 10;
      for (let i = 0; i < n; i++) ctx.rect((i / n) * w, 0, (w / n) * reveal, h);
      ctx.clip(); break;
    }
    case "splitH": {
      // dos mitades que se separan revelando el entrante
      const half = (h / 2) * reveal;
      ctx.rect(0, h / 2 - half, w, half * 2); ctx.clip(); break;
    }
    case "splitV": {
      const half = (w / 2) * reveal;
      ctx.rect(w / 2 - half, 0, half * 2, h); ctx.clip(); break;
    }
    case "checker": {
      const cols = 8, rows = 5;
      const cw = w / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let cidx = 0; cidx < cols; cidx++) {
          // las celdas se revelan escalonadas según un orden diagonal
          const order = ((r + cidx) % 4) / 4;
          const local = Math.max(0, Math.min(1, (reveal - order) / (1 - order || 1)));
          if (local > 0) ctx.rect(cidx * cw, r * ch, cw * local, ch * local);
        }
      }
      ctx.clip(); break;
    }
    default:
      break;
  }
}

/**
 * Dibuja un frame de video sobre el contexto aplicando transform, opacidad,
 * fusión y —si la hay— el efecto de transición. Compartido por la vista previa
 * y la exportación, de modo que lo que se ve en el visor es idéntico a lo
 * exportado.
 */
export function drawComposedFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  frameW: number,
  frameH: number,
  canvasW: number,
  canvasH: number,
  c: ComposeMsg,
  transition?: TransitionMsg,
): void {
  ctx.save();

  let alpha = Math.max(0, Math.min(1, c.opacity));
  let slideX = 0;
  let slideY = 0;
  let transScale = 1;
  if (transition) {
    alpha *= transitionOpacity(transition);
    applyTransitionClip(ctx, canvasW, canvasH, transition);
    const p = Math.max(0, Math.min(1, transition.progress));
    const isTo = transition.role === "to";
    switch (transition.type) {
      case "slideLeft":
        slideX = isTo ? canvasW * (1 - p) : -canvasW * p; break;
      case "slideRight":
        slideX = isTo ? -canvasW * (1 - p) : canvasW * p; break;
      case "slideUp":
        slideY = isTo ? canvasH * (1 - p) : -canvasH * p; break;
      case "slideDown":
        slideY = isTo ? -canvasH * (1 - p) : canvasH * p; break;
      // push: ambos se mueven juntos (el saliente empujado fuera por el entrante)
      case "pushLeft":
        slideX = isTo ? canvasW * (1 - p) : -canvasW * p; break;
      case "pushRight":
        slideX = isTo ? -canvasW * (1 - p) : canvasW * p; break;
      case "pushUp":
        slideY = isTo ? canvasH * (1 - p) : -canvasH * p; break;
      case "pushDown":
        slideY = isTo ? -canvasH * (1 - p) : canvasH * p; break;
      case "whipLeft":
        slideX = isTo ? canvasW * (1 - p) : -canvasW * p; break;
      case "whipRight":
        slideX = isTo ? -canvasW * (1 - p) : canvasW * p; break;
      // zoom: el entrante crece desde pequeño / el saliente se aleja
      case "zoomIn":
        transScale = isTo ? 0.6 + 0.4 * p : 1 + 0.5 * p;
        alpha *= isTo ? p : 1 - p; break;
      case "zoomOut":
        transScale = isTo ? 1.4 - 0.4 * p : 1 - 0.5 * p;
        alpha *= isTo ? p : 1 - p; break;
      default:
        break;
    }
  }

  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = BLEND_CSS[c.blendMode] ?? "source-over";

  const baseScale = Math.min(canvasW / frameW, canvasH / frameH);
  const drawW = frameW * baseScale;
  const drawH = frameH * baseScale;

  const cx = canvasW / 2 + c.x + slideX;
  const cy = canvasH / 2 + c.y + slideY;

  ctx.translate(cx, cy);
  ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.scale(c.scaleX * transScale, c.scaleY * transScale);

  const ax = (c.anchorX - 0.5) * drawW;
  const ay = (c.anchorY - 0.5) * drawH;
  const dx = -drawW / 2 - ax;
  const dy = -drawH / 2 - ay;

  // efecto de look del clip (filtro de color + overlay + viñeta)
  const eff = c.effectId ? effectById(c.effectId) : undefined;

  // filtro CSS base (B&N, sepia, contraste, etc.) + blur de transición si aplica
  let filterStr = eff && eff.filter !== "none" ? eff.filter : "";
  if (transition && transition.type === "blurMix") {
    const p = Math.max(0, Math.min(1, transition.progress));
    const blurAmt = (transition.role === "to" ? 1 - p : p) * 16; // px
    if (blurAmt > 0.5) filterStr += ` blur(${blurAmt.toFixed(1)}px)`;
  }
  ctx.filter = filterStr.trim() !== "" ? filterStr.trim() : "none";
  ctx.drawImage(frame, dx, dy, drawW, drawH);
  ctx.filter = "none";

  if (eff && (eff.overlay || eff.vignette)) {
    // recorta al rectángulo del frame para que overlay/viñeta no se salgan
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, drawW, drawH);
    ctx.clip();

    // velo de color (tinte): se funde sobre el frame con su blend mode
    if (eff.overlay) {
      ctx.globalCompositeOperation = eff.overlay.blend as GlobalCompositeOperation;
      ctx.globalAlpha = alpha * eff.overlay.alpha;
      ctx.fillStyle = eff.overlay.color;
      ctx.fillRect(dx, dy, drawW, drawH);
    }

    // viñeta: gradiente radial oscuro en los bordes
    if (eff.vignette) {
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = alpha;
      const r = Math.max(drawW, drawH) * 0.75;
      const grad = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(1, `rgba(0,0,0,${Math.max(0, Math.min(1, eff.vignette))})`);
      ctx.fillStyle = grad;
      ctx.fillRect(dx, dy, drawW, drawH);
    }
    ctx.restore();
  }
  ctx.restore();

  // Velo de color para fundidos a negro/blanco/destello. Se pinta una sola vez
  // (en la capa entrante "to") sobre TODO el lienzo, en coordenadas de pantalla.
  if (transition && transition.role === "to") {
    const veil = transitionVeil(transition);
    if (veil && veil.alpha > 0.001) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.max(0, Math.min(1, veil.alpha));
      ctx.fillStyle = veil.color;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }
  }
}
