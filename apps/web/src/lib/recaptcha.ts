'use client';

declare global {
  interface Window {
    grecaptcha?: { ready(callback: () => void): void; execute(key: string, options: { action: string }): PromiseLike<string> };
  }
}

/** Token baru per percobaan login, dibuat sesaat sebelum email/password dikirim. */
export async function executeLoginCaptcha(): Promise<string> {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const captcha = window.grecaptcha;
  if (!siteKey || !captcha) throw new Error('reCAPTCHA belum tersedia');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('reCAPTCHA tidak merespons')), 10000);
    captcha.ready(() => {
      // API Google dapat mengembalikan thenable yang tidak menyediakan .finally().
      Promise.resolve(captcha.execute(siteKey, { action: 'login' })).then(resolve, reject).finally(() => clearTimeout(timeout));
    });
  });
}
