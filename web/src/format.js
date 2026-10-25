const nf = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const num = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : nf.format(n));
export const naira = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : `${n < 0 ? '-' : ''}₦${nf.format(Math.abs(n))}`);
export const litres = (n) => (n === null || n === undefined ? '–' : `${nf.format(n)} L`);
export const todayLocal = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const PRODUCT_NAMES = { pms: 'PMS (Petrol)', ago: 'AGO (Diesel)' };
export const money = (amount, currency = 'NGN') => {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${nf.format(amount)}`;
  }
};
export const ROLE_NAMES = { owner: 'Owner', manager: 'Manager', attendant: 'Attendant' };
export const dateLong = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
export const PERIOD = { yearly: 'year', monthly: 'month' };
