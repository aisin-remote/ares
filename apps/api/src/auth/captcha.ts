import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export async function verifyRecaptcha(token: string, ip?: string): Promise<void> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) throw new ServiceUnavailableException('Verifikasi keamanan belum dikonfigurasi. Hubungi Admin.');
  if (!token?.trim()) throw new UnauthorizedException('Verifikasi keamanan wajib dilakukan');
  let result: { success?: boolean; score?: number; action?: string; hostname?: string; 'error-codes'?: string[] };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST', body, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Google tidak tersedia');
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('Respons tidak valid');
    result = payload as typeof result;
  } catch {
    throw new ServiceUnavailableException('Verifikasi keamanan tidak dapat dihubungi. Coba lagi.');
  }
  if (Array.isArray(result['error-codes']) && result['error-codes'].some((code) => ['missing-input-secret', 'invalid-input-secret'].includes(code))) {
    throw new ServiceUnavailableException('Konfigurasi verifikasi keamanan perlu diperiksa Admin.');
  }
  const hosts = (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000').split(',').map((origin) => new URL(origin.trim()).hostname);
  // ponytail: umur token tidak dicek lagi — Google sudah menolak token kedaluwarsa (2 menit)
  // atau yang dipakai dua kali lewat error-code `timeout-or-duplicate`.
  const threshold = Number(process.env.RECAPTCHA_MIN_SCORE ?? 0.5);
  if ((result['error-codes'] !== undefined && (!Array.isArray(result['error-codes']) || result['error-codes'].length > 0)) ||
      result.success !== true || result.action !== 'login' || typeof result.score !== 'number' ||
      !Number.isFinite(result.score) || result.score > 1 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
      result.score < threshold || !hosts.includes(result.hostname ?? '')) {
    new Logger('reCAPTCHA').warn(JSON.stringify({ success: result.success, score: result.score,
      threshold, action: result.action, hostname: result.hostname, allowedHosts: hosts,
      errors: result['error-codes'] }));
    throw new UnauthorizedException('Verifikasi keamanan gagal atau kedaluwarsa. Coba masuk kembali.');
  }
}
