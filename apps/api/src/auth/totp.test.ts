import { beforeAll, describe, expect, it } from 'vitest';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  totpCode,
  totpUri,
  verifyTotp,
} from './totp';

beforeAll(() => {
  process.env.JWT_SECRET ||= 'test-totp-secret-with-at-least-32-characters';
});

describe('Google Authenticator TOTP', () => {
  it('sesuai vektor RFC 6238 untuk enam digit terakhir', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpCode(secret, new Date(59_000))).toBe('287082');
  });

  it('menerima kode saat ini dan toleransi satu langkah waktu', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-10-13T06:00:00.000Z');
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, new Date(now.getTime() - 30_000)), now)).toBe(true);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
  });

  it('mengenkripsi secret dan membuat URI otpauth yang benar', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(encrypted)).toBe(secret);
    expect(totpUri(secret, 'supplier@example.com')).toContain('otpauth://totp/ARES%3Asupplier%40example.com');
  });
});
