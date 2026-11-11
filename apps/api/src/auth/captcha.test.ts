import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyRecaptcha } from './captcha';

const reply = (over: Record<string, unknown> = {}) => ({ success: true, score: 0.9, action: 'login', hostname: 'ares.test', challenge_ts: new Date().toISOString(), ...over });
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv('RECAPTCHA_SECRET_KEY', 'unit-test-secret');
  vi.stubEnv('WEB_ORIGIN', 'https://ares.test');
  vi.stubEnv('RECAPTCHA_MIN_SCORE', '0.5');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function respond(body: unknown) { fetchMock.mockResolvedValue({ ok: true, json: async () => body }); }

describe('Google reCAPTCHA v3 sebelum login', () => {
  it('mengirim token dan secret ke Google dan menerima token login pada domain yang sesuai', async () => {
    respond(reply());
    await expect(verifyRecaptcha('fresh-token', '127.0.0.1')).resolves.toBeUndefined();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(options.method).toBe('POST');
    expect(options.body.get('response')).toBe('fresh-token');
    expect(options.body.get('secret')).toBe('unit-test-secret');
  });
  it('menerima localhost bila tercantum eksplisit bersama origin IP lokal', async () => {
    vi.stubEnv('WEB_ORIGIN', 'http://127.0.0.1:3000,http://localhost:3000');
    respond(reply({ hostname: 'localhost' }));
    await expect(verifyRecaptcha('localhost-token')).resolves.toBeUndefined();
  });
  it.each([
    { success: false, 'error-codes': ['timeout-or-duplicate'] }, { action: 'register' },
    { success: true, score: 0.9, 'error-codes': ['Over free quota.'] },
    { score: 0.1 }, { score: undefined }, { score: 2 }, { hostname: 'attacker.test' },
  ])('menolak token tidak sesuai: %j', async (over) => {
    respond(reply(over));
    await expect(verifyRecaptcha('bad-token')).rejects.toThrow('Verifikasi keamanan gagal');
  });
  it('tidak membuka login ketika key kosong, Google error, atau respons rusak', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', '');
    await expect(verifyRecaptcha('token')).rejects.toThrow('belum dikonfigurasi');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'unit-test-secret');
    fetchMock.mockRejectedValue(new Error('network secret=unit-test-secret'));
    await expect(verifyRecaptcha('token')).rejects.toThrow('tidak dapat dihubungi');
    respond({ success: false, 'error-codes': ['invalid-input-secret'] });
    await expect(verifyRecaptcha('token')).rejects.toThrow('Konfigurasi');
    respond(null);
    await expect(verifyRecaptcha('token')).rejects.toThrow('tidak dapat dihubungi');
  });
});
