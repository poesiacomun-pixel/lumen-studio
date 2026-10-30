import type { TextContent } from "../model/types";

/**
 * Dibuja un clip de texto centrado en (cx, cy) del lienzo, con su estilo. Lo
 * comparten la vista previa y la exportación para que el título se vea idéntico.
 *
 * El texto se posiciona luego mediante el transform del clip (el compositor
 * aplica translate/scale/rotate alrededor de este dibujo). Aquí solo dibujamos
 * el bloque de texto centrado en el origen lógico que el compositor haya fijado.
 *
 * Soporta múltiples líneas (separadas por \n), alineación, contorno y fondo.
 */
export function drawTextClip(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  content: TextContent,
  canvasW: number,
  canvasH: number,
): void {
  const lines = content.text.split("\n");
  const weight = content.bold ? "700" : "400";
  const style = content.italic ? "italic" : "normal";
  const size = content.fontSizePx;
  ctx.font = `${style} ${weight} ${size}px ${content.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = content.align;

  const lineHeight = size * 1.2;
  const totalH = lineHeight * lines.length;

  // ancho del bloque (la línea más larga) para el fondo
  let maxW = 0;
  for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);

  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const startY = cy - totalH / 2 + lineHeight / 2;

  // x de anclaje según alineación
  const ax =
    content.align === "left" ? cx - maxW / 2 :
    content.align === "right" ? cx + maxW / 2 : cx;

  // fondo opcional (caja detrás del bloque)
  if (content.background) {
    const padX = size * 0.3;
    const padY = size * 0.18;
    ctx.fillStyle = content.backgroundColor;
    ctx.fillRect(cx - maxW / 2 - padX, cy - totalH / 2 - padY, maxW + padX * 2, totalH + padY * 2);
  }

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight;
    // contorno
    if (content.outlineWidthPx > 0) {
      ctx.lineWidth = content.outlineWidthPx;
      ctx.strokeStyle = content.outlineColor;
      ctx.lineJoin = "round";
      ctx.strokeText(lines[i], ax, y);
    }
    ctx.fillStyle = content.color;
    ctx.fillText(lines[i], ax, y);
  }
}
