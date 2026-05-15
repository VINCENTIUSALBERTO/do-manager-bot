/**
 * Escapes a string for Telegram MarkdownV2 according to the official spec:
 * https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMd(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
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
