import { ALL_FONTS } from "../model/fonts";

/**
 * Carga las fuentes del catálogo usando la API FontFace, de modo que queden
 * disponibles tanto en el documento como dentro de un worker (donde el canvas
 * dibuja el texto). Funciona pidiendo a Google Fonts el CSS de cada familia,
 * extrayendo la URL del woff2 y registrando la fuente en el contexto actual
 * (`self.fonts`).
 *
 * Es tolerante a fallos: si una familia no carga (red, nombre, etc.) se omite
 * sin interrumpir el resto. La carga es idempotente: no vuelve a registrar una
 * familia ya presente.
 */

const loaded = new Set<string>();

/** Contexto con registro de fuentes (Document o WorkerGlobalScope). */
interface FontHost {
  fonts: FontFaceSet;
}

/** Extrae los pares (peso, url woff2) del CSS que devuelve Google Fonts. */
function parseFaces(css: string): { weight: string; url: string }[] {
  const out: { weight: string; url: string }[] = [];
  const blocks = css.split("@font-face");
  for (const b of blocks) {
    const urlMatch = b.match(/src:\s*url\(([^)]+)\)\s*format\(['"]?woff2/i);
    if (!urlMatch) continue;
    const weightMatch = b.match(/font-weight:\s*(\d+)/i);
    out.push({ weight: weightMatch ? weightMatch[1] : "400", url: urlMatch[1].replace(/['"]/g, "") });
  }
  return out;
}

/** Carga una sola familia (todos sus pesos disponibles) en el host dado. */
async function loadFamily(host: FontHost, family: string): Promise<void> {
  if (loaded.has(family)) return;
  loaded.add(family);
  try {
    const name = family.replace(/ /g, "+");
    // pide 400;700 solo si la familia tiene bold; si no, sin sufijo de peso
    // (pedir un peso inexistente hace que Google devuelva 400 y no cargue nada).
    const def = ALL_FONTS.find((f) => f.family === family);
    const multi = !def || def.category === "generic" || def.bold;
    const wght = multi ? ":wght@400;700" : "";
    const cssUrl = `https://fonts.googleapis.com/css2?family=${name}${wght}&display=swap`;
    const res = await fetch(cssUrl);
    if (!res.ok) return;
    const css = await res.text();
    const faces = parseFaces(css);
    for (const face of faces) {
      try {
        const ff = new FontFace(family, `url(${face.url})`, { weight: face.weight });
        await ff.load();
        host.fonts.add(ff);
      } catch {
        /* peso individual fallido: continúa */
      }
    }
  } catch {
    /* familia fallida (p.ej. sin red): se omite, queda el fallback */
    loaded.delete(family); // permite reintentar más tarde
  }
}

/** Carga todas las fuentes del catálogo en el host (documento o worker). */
export async function loadAllFonts(host: FontHost): Promise<void> {
  // en tandas para no saturar la red con 80 peticiones simultáneas
  const families = ALL_FONTS.map((f) => f.family);
  const BATCH = 8;
  for (let i = 0; i < families.length; i += BATCH) {
    await Promise.all(families.slice(i, i + BATCH).map((fam) => loadFamily(host, fam)));
  }
}
