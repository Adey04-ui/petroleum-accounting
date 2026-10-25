import { SUBSCRIPTION_GRACE_DAYS } from './limits.js';

const DAY = 24 * 3600 * 1000;

/** One billing period after `date`. Month ends are clamped (31 Jan + 1 month = 28/29 Feb, not 3 Mar). */
export function addInterval(date, interval) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (interval === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else if (interval === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else throw new Error(`Unknown billing interval: ${interval}`);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The date a renewal should count from: when the current period ends, or now if it already ended. */
export function renewalBase(paidUntil, now = new Date()) {
  return paidUntil && new Date(paidUntil) > now ? new Date(paidUntil) : new Date(now);
}

/**
 * 'active'  - paid up (or an older organisation with no expiry)
 * 'grace'   - the period ended less than SUBSCRIPTION_GRACE_DAYS ago; everything still works
 * 'expired' - read-only until renewed
 */
export function subscriptionState(org, now = new Date()) {
  if (!org.paidUntil) return 'active';
  const end = new Date(org.paidUntil).getTime();
  if (now.getTime() <= end) return 'active';
  if (now.getTime() <= end + SUBSCRIPTION_GRACE_DAYS * DAY) return 'grace';
  return 'expired';
}

export function daysLeft(org, now = new Date()) {
  if (!org.paidUntil) return null;
  return Math.ceil((new Date(org.paidUntil).getTime() - now.getTime()) / DAY);
}
