/**
 * Escapes a string for Telegram MarkdownV2 according to the official spec:
 * https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMd(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Escapes a string for use INSIDE Telegram MarkdownV2 code/pre blocks (```code``` or `code`).
 * Only backticks and backslashes need to be escaped inside code blocks.
 */
export function escapeMdCode(input) {
  if (input === null || input === undefined) return '';
  return String(input).replace(/([`\\])/g, '\\$1');
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatMoney(value, currency = 'USD') {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '-');
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && parts.length < 2) parts.push(`${minutes}m`);
  if (!parts.length) parts.push(`${totalSeconds}s`);
  return parts.join(' ');
}

export function regionFlag(slug) {
  if (!slug || typeof slug !== 'string') return '';
  const map = {
    nyc: '🇺🇸',
    sfo: '🇺🇸',
    ams: '🇳🇱',
    sgp: '🇸🇬',
    lon: '🇬🇧',
    fra: '🇩🇪',
    tor: '🇨🇦',
    blr: '🇮🇳',
    syd: '🇦🇺',
  };
  const key = slug.replace(/\d+$/, '').toLowerCase();
  return map[key] ?? '🌐';
}

export function formatIndoDate(dateObj) {
  const INDO_MONTHS = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  const wibTime = new Date(dateObj.getTime() + 7 * 60 * 60 * 1000);
  const day = wibTime.getUTCDate();
  const month = INDO_MONTHS[wibTime.getUTCMonth()];
  const year = wibTime.getUTCFullYear();
  const hours = String(wibTime.getUTCHours()).padStart(2, '0');
  const minutes = String(wibTime.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} (${hours}:${minutes} WIB)`;
}

export function getRemainingTimeText(expiresAt) {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) {
    const graceEndMs = new Date(expiresAt).getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now();
    if (graceEndMs <= 0) return 'Expired (Sedang dihapus)';

    const days = Math.floor(graceEndMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((graceEndMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const parts = [];
    if (days > 0) parts.push(`${days} hari`);
    if (hours > 0) parts.push(`${hours} jam`);
    return `Expired (Masa tenggang: sisa ${parts.join(' ') || 'kurang dari 1 jam'})`;
  }

  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const parts = [];
  if (days > 0) parts.push(`${days} hari`);
  if (hours > 0) parts.push(`${hours} jam`);
  return parts.join(' ') || 'kurang dari 1 jam';
}

export function formatRegionName(slug) {
  if (!slug || typeof slug !== 'string') return '—';
  const flag = regionFlag(slug);
  const names = {
    sgp: 'Singapura',
    nyc: 'New York, USA',
    sfo: 'San Francisco, USA',
    ams: 'Amsterdam, Netherlands',
    fra: 'Frankfurt, Germany',
    tor: 'Toronto, Canada',
    blr: 'Bangalore, India',
    lon: 'London, UK',
    syd: 'Sydney, Australia',
  };
  const key = slug.replace(/\d+$/, '').toLowerCase();
  const name = names[key] ?? 'Global';
  return `${flag} ${name} (${slug})`;
}
