/** Game-day / ISO-week / month helpers for diaries and compress jobs. */

export function parseDayKey(dayKey) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return { y, m, d };
}

export function formatDay(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(dayKey, delta) {
  const date = parseDayKey(dayKey);
  if (!date) return dayKey;
  const next = new Date(Date.UTC(date.y, date.m - 1, date.d + Number(delta || 0)));
  return formatDay(next);
}

export function isoWeekKey(dayKey) {
  const date = parseDayKey(dayKey);
  if (!date) return dayKey;
  const utc = Date.UTC(date.y, date.m - 1, date.d);
  const day = new Date(utc);
  const thursday = new Date(utc);
  const dow = (day.getUTCDay() + 6) % 7;
  thursday.setUTCDate(day.getUTCDate() - dow + 3);
  const weekYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(weekYear, 0, 4);
  const week1Thursday = new Date(jan4);
  const week1Dow = (week1Thursday.getUTCDay() + 6) % 7;
  week1Thursday.setUTCDate(4 - week1Dow + 3);
  const week = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / 604_800_000);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function daysInIsoWeek(dayKey) {
  const date = parseDayKey(dayKey);
  if (!date) return [dayKey];
  const utc = Date.UTC(date.y, date.m - 1, date.d);
  const dow = (new Date(utc).getUTCDay() + 6) % 7;
  const monday = new Date(utc);
  monday.setUTCDate(monday.getUTCDate() - dow);
  return rangeDays(monday, 7);
}

export function daysInMonth(dayKey) {
  const date = parseDayKey(dayKey);
  if (!date) return [dayKey];
  const count = new Date(Date.UTC(date.y, date.m, 0)).getUTCDate();
  const start = new Date(Date.UTC(date.y, date.m - 1, 1));
  return rangeDays(start, count);
}

/** ISO week ends on Sunday. Closing that day is a week-boundary write. */
export function isIsoWeekBoundary(dayKey) {
  const date = parseDayKey(dayKey);
  if (!date) return false;
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay() === 0;
}

export function isMonthBoundary(dayKey) {
  const date = parseDayKey(dayKey);
  if (!date) return false;
  const last = new Date(Date.UTC(date.y, date.m, 0)).getUTCDate();
  return date.d === last;
}

/**
 * [start, end) UTC range for a game day starting at dayStartHhmm in Asia/Shanghai.
 * Shanghai is UTC+8 year-round (no DST).
 */
export function gameDayUtcRange(dayKey, dayStartHhmm = "07:00") {
  const date = parseDayKey(dayKey);
  if (!date) return null;
  const hhmm = normalizeHhmm(dayStartHhmm);
  const start = new Date(`${dayKey}T${hhmm}:00+08:00`);
  if (Number.isNaN(start.getTime())) return null;
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

function normalizeHhmm(hhmm) {
  const raw = typeof hhmm === "string" && /^\d{1,2}:\d{2}/.test(hhmm) ? hhmm : "07:00";
  const [h, m] = raw.split(":");
  return `${String(Number(h)).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")}`;
}

function rangeDays(start, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start.getTime());
    d.setUTCDate(start.getUTCDate() + i);
    out.push(formatDay(d));
  }
  return out;
}
