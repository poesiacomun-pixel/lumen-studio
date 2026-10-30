import type { SubtitleStyle } from "../model/types";
import type { SubtitleCueMsg } from "../media/playbackMessages";

/**
 * Dibuja el subtítulo activo (si lo hay) sobre un contexto 2D. Lo comparten el
 * worker de reproducción y el de exportación, de modo que lo que se ve en la
 * vista previa es idéntico a lo que se quema en el video final.
 */
export function drawSubtitle(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  cues: SubtitleCueMsg[],
  style: SubtitleStyle | null,
  timelineTick: number,
): void {
  if (!style || cues.length === 0) return;
  const cue = cues.find(
    (c) => timelineTick >= c.startTick && timelineTick < c.endTick,
  );
  if (!cue) return;

  // el estilo del cue (si lo tiene) sobrescribe el global solo en sus campos
  const s: SubtitleStyle = cue.style ? { ...style, ...cue.style } : style;
  ctx.save();
  const weight = s.bold ? "700" : "400";
  const italic = s.italic ? "italic " : "";
  ctx.font = `${italic}${weight} ${s.fontSizePx}px ${s.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const x = width / 2;
  const margin = Math.round(height * 0.06);
  let y: number;
  if (s.position === "top") y = margin + s.fontSizePx;
  else if (s.position === "middle") y = height / 2 + s.fontSizePx / 2;
  else y = height - margin;

  const textW = ctx.measureText(cue.text).width;
  const padX = s.fontSizePx * 0.4;
  const padY = s.fontSizePx * 0.28;

  if (s.background) {
    ctx.fillStyle = s.backgroundColor;
    ctx.fillRect(
      x - textW / 2 - padX,
      y - s.fontSizePx - padY + s.fontSizePx * 0.22,
      textW + padX * 2,
      s.fontSizePx + padY * 2,
    );
  }
  if (s.outlineWidthPx > 0) {
    ctx.lineWidth = s.outlineWidthPx;
    ctx.strokeStyle = s.outlineColor;
    ctx.lineJoin = "round";
    ctx.strokeText(cue.text, x, y);
  }
  ctx.fillStyle = s.color;
  ctx.fillText(cue.text, x, y);
  ctx.restore();
}
