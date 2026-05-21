/**
 * Telegram callback_data is limited to 64 bytes. We keep things short by using
 * a single namespace prefix followed by `:`-separated args.
 *
 *   pack('vps', 'reboot', '123') -> 'vps:reboot:123'
 *   unpack('vps:reboot:123')     -> { ns: 'vps', action: 'reboot', args: ['123'] }
 */
export function pack(ns, action, ...args) {
  const out = [ns, action, ...args.map((a) => String(a))].join(':');
  if (Buffer.byteLength(out, 'utf8') > 64) {
    throw new Error(`callback_data overflow: ${out}`);
  }
  return out;
}

export function unpack(data) {
  const [ns, action, ...args] = String(data ?? '').split(':');
  return { ns, action, args };
}
