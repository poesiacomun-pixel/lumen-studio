// Iconos SVG (estilo lucide, stroke 1.7) usados por la UI, fieles al diseño.
// Devuelven strings para inyectar en innerHTML.

const svg = (inner: string, size = 16, fill = "none"): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const icons = {
  play: (s = 16) => svg(`<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>`, s),
  pause: (s = 16) => svg(`<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>`, s),
  undo: (s = 17) => svg(`<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>`, s),
  redo: (s = 17) => svg(`<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/>`, s),
  export: (s = 15) => svg(`<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>`, s),
  edit: (s = 12) => svg(`<path d="m18 2 4 4-13 13H5v-4z"/>`, s),
  plus: (s = 12) => svg(`<path d="M12 5v14M5 12h14"/>`, s),
  importArrow: (s = 15) => svg(`<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>`, s),
  video: (s = 11) => svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/>`, s),
  image: (s = 11) => svg(`<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>`, s),
  music: (s = 11) => svg(`<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`, s),
  mic: (s = 11) => svg(`<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/>`, s),
  text: (s = 11) => svg(`<path d="M4 7V5h16v2M9 19h6M12 5v14"/>`, s),
  eye: (s = 13) => svg(`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>`, s),
  lock: (s = 12) => svg(`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`, s),
  volume: (s = 13) => svg(`<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>`, s),
  volumeX: (s = 13) => svg(`<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>`, s),
  scissors: (s = 13) => svg(`<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>`, s),
  trash: (s = 13) => svg(`<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>`, s),
  magnet: (s = 13) => svg(`<path d="M5 3v9a7 7 0 0 0 14 0V3M5 8h4M15 8h4"/>`, s),
  plusTrack: (s = 13) => svg(`<path d="M12 5v14M5 12h14"/>`, s),
  detach: (s = 13) => svg(`<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="m2 2 20 20" stroke-width="1.4"/>`, s),
  transition: (s = 13) => svg(`<rect x="2" y="6" width="9" height="12" rx="1.5"/><rect x="13" y="6" width="9" height="12" rx="1.5"/><path d="M8 12h8M13 9l3 3-3 3" stroke-width="1.4"/>`, s),
  zoomIn: (s = 13) => svg(`<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>`, s),
  zoomOut: (s = 13) => svg(`<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>`, s),
  sparkles: (s = 13) => svg(`<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/>`, s),
  fullscreen: (s = 16) => svg(`<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>`, s),
  fullscreenExit: (s = 16) => svg(`<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>`, s),
};
