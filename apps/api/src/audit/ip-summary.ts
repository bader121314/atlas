import { isIPv4, isIPv6 } from 'node:net';

/**
 * Coarsens a client address before it is stored: IPv4 to its /24 network and
 * IPv6 to its /48 prefix. Enough to spot "a new network" without keeping the
 * exact address (data minimization, docs/05).
 */
export function summarizeIp(address: string | undefined): string | null {
  if (!address) return null;
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIPv4(ip)) {
    const [a, b, c] = ip.split('.');
    return `${a}.${b}.${c}.0/24`;
  }
  if (isIPv6(ip)) {
    const [head = '', tail = ''] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const fill = Array<string>(8 - left.length - right.length).fill('0');
    const groups = ip.includes('::') ? [...left, ...fill, ...right] : left;
    return `${groups
      .slice(0, 3)
      .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
      .join(':')}::/48`;
  }
  return null;
}
