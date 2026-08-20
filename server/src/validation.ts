import { isIP } from 'node:net';
import { z } from 'zod';

export const LOCAL_ASN = 206069;
export const IPV4_PEER_GROUP = 'EBGP-CUST-FULL';
export const IPV6_PEER_GROUP = 'EBGP-CUST-FULL-v6';

const ipv4Part = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const ipv4Regex = new RegExp(`^${ipv4Part}(\\.${ipv4Part}){3}$`);
const ipv6Regex = /^[0-9A-Fa-f:]+$/;
const routeInputRegex = /^[0-9A-Fa-f:.]+(?:\/(?:\d|[12]\d|3[0-2]|1[01]?\d|12[0-8]))?$/;

export function normalizeText(value: string): string {
  return value.trim();
}

export function assertAsn(value: string): string {
  const asn = value.trim();
  if (!/^\d+$/.test(asn)) throw new Error('AS number must be numeric.');
  const n = Number(asn);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 4294967295) throw new Error('AS number is out of range.');
  return asn;
}

export function assertIpv4(value: string): string {
  const ip = value.trim();
  if (!ipv4Regex.test(ip)) throw new Error('IPv4 peer is invalid.');
  return ip;
}

export function assertIpv6(value: string): string {
  const ip = value.trim();
  if (!ip || ip.includes(' ') || !ip.includes(':') || !ipv6Regex.test(ip) || ip.length > 45) {
    throw new Error('IPv6 peer is invalid.');
  }
  return ip.toUpperCase();
}

export function validateSessionInput(input: { asn: string; peerV4: string; peerV6?: string }) {
  return {
    asn: assertAsn(input.asn),
    peerV4: assertIpv4(input.peerV4),
    peerV6: input.peerV6?.trim() ? assertIpv6(input.peerV6) : '',
  };
}

export function assertRouteLookup(value: string, family: 'ipv4' | 'ipv6'): string {
  const route = value.trim();
  if (!route || route.includes(' ') || !routeInputRegex.test(route)) {
    throw new Error(`${family.toUpperCase()} route is invalid.`);
  }

  const [address, prefixLength] = route.split('/');
  if (family === 'ipv4') {
    if (isIP(address) !== 4) throw new Error('IPv4 route is invalid.');
    if (prefixLength && (Number(prefixLength) < 0 || Number(prefixLength) > 32)) throw new Error('IPv4 route prefix is invalid.');
    return prefixLength ? `${address}/${Number(prefixLength)}` : address;
  }

  if (isIP(address) !== 6) throw new Error('IPv6 route is invalid.');
  if (prefixLength && (Number(prefixLength) < 0 || Number(prefixLength) > 128)) throw new Error('IPv6 route prefix is invalid.');
  return prefixLength ? `${address.toUpperCase()}/${Number(prefixLength)}` : address.toUpperCase();
}

export const loginSchema = z.object({
  role: z.enum(['customer', 'admin']),
  customerId: z.string().trim().min(1).max(64).optional(),
  username: z.string().trim().max(64).optional(),
  password: z.string().max(128).optional(),
});

export const createApplicationSchema = z.object({
  asn: z.string().trim().min(1),
  peerV4: z.string().trim().min(1),
  peerV6: z.string().trim().optional().default(''),
  contactEmail: z.string().trim().email(),
  proof: z.string().trim().min(8).max(5000),
});

export const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNote: z.string().trim().min(1).max(2000),
});

export const commandPreviewSchema = z.object({
  action: z.enum(['open', 'delete']),
});

export const executeSchema = z.object({
  action: z.enum(['open', 'delete']),
  confirmation: z.literal('CONFIRM'),
});

export const lookingGlassSchema = z.object({
  type: z.enum(['v4-summary', 'v6-summary', 'routes-v4', 'routes-v6', 'adv-v4', 'adv-v6']),
});

export const routeLookupSchema = z.object({
  family: z.enum(['ipv4', 'ipv6']),
  route: z.string().trim().min(1).max(200),
});
