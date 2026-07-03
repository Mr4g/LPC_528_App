import crypto from 'node:crypto';

export function normalizeCardUid(input: string): string {
  return input.trim().replace(/[\r\n]/g, '');
}

export function cardUidLast4(uid: string): string {
  return uid.slice(-4);
}

export function maskCardLast4(last4: string | null | undefined): string | null {
  return last4 ? `****${last4}` : null;
}

export function hashCardUid(uid: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(uid, 'utf8').digest('hex');
}

export function hashPrefix(hash: string): string {
  return hash.slice(0, 8);
}
