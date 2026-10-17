export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Express 4 does not catch rejected promises, so every async handler goes through this. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function toNum(v, label) {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
  return n;
}

export function cleanName(v, label, { min = 2, max = 80 } = {}) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < min || s.length > max) throw new HttpError(400, `${label} must be ${min} to ${max} characters`);
  return s;
}

export function checkDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  if (!ok) throw new HttpError(400, 'Date must be YYYY-MM-DD');
}

export function checkMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Month must be YYYY-MM');
}
