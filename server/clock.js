const TIMEZONE = "Asia/Shanghai";

function parts(date = new Date()) {
  const map = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return map;
}

export function nowClock(date = new Date()) {
  const p = parts(date);
  return {
    timezone: TIMEZONE,
    iso: date.toISOString(),
    dayKey: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${p.hour}:${p.minute}`,
  };
}

/** Parse "HH:MM" or "HH:MM:SS" into minutes from midnight. */
export function hhmmToMinutes(hhmm) {
  if (typeof hhmm !== "string") return 0;
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  if (!Number.isFinite(h)) return 0;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Whether hhmm is in [startHhmm, endHhmm). The window may wrap midnight
 * (e.g. 22:00–07:00). Bounds come from the caller so schedule hours stay in config.
 */
export function isWrappedWindow(hhmm, startHhmm, endHhmm) {
  const t = hhmmToMinutes(hhmm);
  const start = hhmmToMinutes(startHhmm);
  const end = hhmmToMinutes(endHhmm);
  if (start === end) return true;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

export { TIMEZONE };
