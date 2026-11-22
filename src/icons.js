const svg = (body) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const navIcons = {
  home: svg(
    `<path d="M4 11.5 12 4l8 7.5"/><path d="M6.5 10.8V20h11V10.8"/><path d="M10 20v-6h4v6"/>`
  ),
  dining: svg(
    `<path d="M5 3v8"/><path d="M5 11c0 2 1.2 3 3 3h.5V21"/><path d="M8.5 3v8"/><path d="M3.5 3v4"/><path d="M16 3c2.2 0 3.5 2 3.5 5.5S18 14 16 14V21"/><path d="M16 3v11"/>`
  ),
  bath: svg(
    `<path d="M5 12h14v2.2a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5V12Z"/><path d="M7 12V8.5A3.5 3.5 0 0 1 14 8"/><path d="M5 19.5v1.5"/><path d="M19 19.5v1.5"/>`
  ),
  bed: svg(
    `<path d="M3 18V10.5A1.5 1.5 0 0 1 4.5 9H10a3 3 0 0 1 3 3v6"/><path d="M13 18V12h6.5A1.5 1.5 0 0 1 21 13.5V18"/><path d="M3 18h18"/><path d="M6.5 9V6.5"/>`
  ),
};

export const dialogIcons = {
  talk: svg(
    `<path d="M6 16.5 4.5 20 9 17.6"/><rect x="4.5" y="4.5" width="15" height="12" rx="3.5"/>`
  ),
  sleep: svg(
    `<path d="M17 14.5A6.5 6.5 0 1 1 9.5 7 5 5 0 0 0 17 14.5Z"/>`
  ),
  eat: svg(
    `<path d="M5 3v8"/><path d="M5 11c0 2 1.2 3 3 3h.5V21"/><path d="M8.5 3v8"/><path d="M16 3c2.2 0 3.5 2 3.5 5.5S18 14 16 14V21"/><path d="M16 3v11"/>`
  ),
  wash: svg(
    `<path d="M5 12h14v2.2a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5V12Z"/><path d="M7 12V8.5A3.5 3.5 0 0 1 14 8"/>`
  ),
  sit: svg(
    `<path d="M7 20v-8h10"/><path d="M5 20h14"/><path d="M7 12V7.5A2.5 2.5 0 0 1 12 7"/><path d="M17 20v-5"/>`
  ),
  empty: svg(
    `<circle cx="12" cy="12" r="7"/><path d="M12 9v3.5"/><path d="M12 16h.01"/>`
  ),
};
