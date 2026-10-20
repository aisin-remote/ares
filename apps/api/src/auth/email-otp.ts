import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export function generateEmailOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashEmailOtp(challengeId: string, code: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET belum dikonfigurasi');
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function verifyEmailOtp(challengeId: string, code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashEmailOtp(challengeId, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'email terdaftar';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
