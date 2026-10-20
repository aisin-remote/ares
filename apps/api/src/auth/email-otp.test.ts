import { beforeAll, describe, expect, it } from 'vitest';
import { generateEmailOtp, hashEmailOtp, maskEmail, verifyEmailOtp } from './email-otp';

beforeAll(() => {
  process.env.JWT_SECRET ||= 'test-email-otp-secret-with-at-least-32-characters';
});

describe('OTP email', () => {
  it('membuat enam angka dan hanya menerima kode untuk challenge yang sama', () => {
    const code = generateEmailOtp();
    const hash = hashEmailOtp('challenge-1', code);
    expect(code).toMatch(/^\d{6}$/);
    expect(hash).not.toContain(code);
    expect(verifyEmailOtp('challenge-1', code, hash)).toBe(true);
    expect(verifyEmailOtp('challenge-2', code, hash)).toBe(false);
    expect(verifyEmailOtp('challenge-1', '000000', hash)).toBe(code === '000000');
  });

  it('menyamarkan alamat tujuan', () => {
    expect(maskEmail('supplier@example.com')).toBe('su******@example.com');
  });
});
