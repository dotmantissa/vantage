export async function api(path, options = {}) {
  const res = await fetch(`/api/v2${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
export function formatGen(value, digits = 2) {
  try { const n = BigInt(value || 0); return `${n / 10n**18n}.${(n % 10n**18n).toString().padStart(18,'0').slice(0,digits)}`; } catch { return '0.00'; }
}
export function toWei(value) {
  if (!/^\d+(\.\d{0,18})?$/.test(String(value))) throw new Error('Enter a positive amount with at most 18 decimals.');
  const [whole, fraction = ''] = String(value).split('.');
  return (BigInt(whole)*10n**18n + BigInt(fraction.padEnd(18,'0'))).toString();
}
export function date(value) { return value ? new Date(Number(value)*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'Unscheduled'; }
export function percent(bps) { return `${(Number(bps || 0)/100).toFixed(1)}%`; }
