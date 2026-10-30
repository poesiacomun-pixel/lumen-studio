import { listProjects, deleteProject, type ProjectMeta } from "../storage/projectStore";
import { icons } from "./icons";

/** Formatea una marca de tiempo a algo legible y breve en español. */
function fmtWhen(ms: number): string {
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
  if (diff < min) return "hace un momento";
  if (diff < hour) return `hace ${Math.floor(diff / min)} min`;
  if (diff < day) return `hace ${Math.floor(diff / hour)} h`;
  if (diff < 7 * day) return `hace ${Math.floor(diff / day)} d`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDur(tick: number): string {
  const secs = Math.round(tick / 90000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Renderiza la pantalla de inicio (galería de proyectos) en el contenedor dado.
 * Llama a onOpen(id) al abrir un proyecto existente y onNew() para crear uno.
 * Es autocontenida: vuelve a pintarse al borrar un proyecto.
 */
export async function renderProjectsScreen(
  container: HTMLElement,
  handlers: { onOpen: (id: string) => void; onNew: () => void },
): Promise<void> {
  const projects = await listProjects();

  const cards = projects
    .map((p: ProjectMeta) => {
      const thumb = p.thumb
        ? `<img class="pj-thumb-img" src="${p.thumb}" alt="" />`
        : `<div class="pj-thumb-ph">${icons.video(28)}</div>`;
      const dims = `${p.width}×${p.height}`;
      return `
        <button class="pj-card" data-open="${p.id}">
          <div class="pj-thumb">${thumb}<span class="pj-dur">${fmtDur(p.durationTick)}</span></div>
          <div class="pj-meta">
            <div class="pj-name" title="${p.name.replace(/"/g, "&quot;")}">${p.name}</div>
            <div class="pj-sub">${dims} · ${fmtWhen(p.updatedAt)}</div>
          </div>
          <span class="pj-del" data-del="${p.id}" title="Eliminar proyecto">${icons.trash(13)}</span>
        </button>`;
    })
    .join("");

  const hasProjects = projects.length > 0;

  container.innerHTML = `
    <div class="home">
      <div class="home-inner">
        <header class="home-head">
          <div class="home-brand">
            <div class="home-mark">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#16201e"><path d="M8 5.5v13l11-6.5z"/></svg>
            </div>
            <div>
              <h1 class="home-title">Lumen Studio</h1>
              <p class="home-tagline">Editor de video en tu navegador</p>
            </div>
          </div>
        </header>

        <section class="home-section">
          <h2 class="home-h2">${hasProjects ? "Tus proyectos" : "Empieza aquí"}</h2>
          <div class="pj-grid">
            <button class="pj-new" id="pj-new">
              <span class="pj-new-plus">+</span>
              <span class="pj-new-label">Nuevo proyecto</span>
            </button>
            ${cards}
          </div>
        </section>
      </div>
    </div>`;

  container.querySelector("#pj-new")!.addEventListener("click", () => handlers.onNew());

  container.querySelectorAll<HTMLElement>("[data-open]").forEach((card) => {
    card.addEventListener("click", (e) => {
      // Si el clic vino del botón de borrar, no abrir.
      if ((e.target as HTMLElement).closest("[data-del]")) return;
      const id = card.dataset.open;
      if (id) handlers.onOpen(id);
    });
  });

  container.querySelectorAll<HTMLElement>("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!id) return;
      const meta = projects.find((p) => p.id === id);
      if (!confirm(`¿Eliminar el proyecto «${meta?.name ?? "sin título"}»? No se puede deshacer.`)) return;
      await deleteProject(id);
      await renderProjectsScreen(container, handlers);
    });
  });
}
