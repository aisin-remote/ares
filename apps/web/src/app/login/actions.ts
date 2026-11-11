'use server';

import { redirect } from 'next/navigation';
import {
  changePasswordSchema,
  loginSchema,
  loginOtpSchema,
  type LoginAttemptResponse,
  type LoginResponse,
} from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { setToken } from '@/lib/session';

export interface LoginState {
  stage?: 'EMAIL_OTP' | 'PASSWORD_EXPIRED';
  mfaToken?: string;
  emailHint?: string;
  demoOtpCode?: string;
  /** Token sekali pakai untuk layar ganti password wajib. */
  changeToken?: string;
  maxAgeDays?: number;
  error?: string;
}

/**
 * Server Action untuk login.
 *
 * Perhatikan: action ini hanya memanggil API lalu menyimpan cookie —
 * tidak ada query database dan tidak ada bcrypt di sini. Pekerjaan berat
 * tetap di API. Server Action yang menjalankan proses lama akan menahan
 * request Next.js persis seperti controller PHP dulu.
 */
export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  if (prev.stage === 'PASSWORD_EXPIRED') {
    const newPassword = String(formData.get('newPassword') ?? '');
    if (newPassword !== String(formData.get('confirmPassword') ?? '')) {
      return { ...prev, error: 'Konfirmasi password tidak sama' };
    }
    const parsed = changePasswordSchema.safeParse({ changeToken: prev.changeToken, newPassword });
    if (!parsed.success) {
      return { ...prev, error: parsed.error.issues[0]?.message ?? 'Password baru tidak valid' };
    }
    try {
      const response = await apiFetch<LoginResponse>('/auth/password', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        authenticated: false,
      });
      await setToken(response.accessToken);
    } catch (error) {
      return { ...prev, error: loginError(error) };
    }
    redirect('/');
  }

  if (prev.stage === 'EMAIL_OTP') {
    const parsed = loginOtpSchema.safeParse({
      mfaToken: prev.mfaToken,
      otpCode: formData.get('otpCode'),
    });
    if (!parsed.success) {
      return { ...prev, error: parsed.error.issues[0]?.message ?? 'Kode tidak valid' };
    }
    let next: LoginState | null;
    try {
      const response = await apiFetch<LoginAttemptResponse>('/auth/login/otp', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        authenticated: false,
      });
      next = await consume(response);
    } catch (error) {
      return { ...prev, error: loginError(error) };
    }
    if (next) return next;
    redirect('/');
  }

  const parsed = loginSchema.safeParse({
    npk: formData.get('npk'),
    password: formData.get('password'),
    captchaToken: formData.get('captchaToken'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }

  let next: LoginState | null;
  try {
    const res = await apiFetch<LoginAttemptResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      authenticated: false,
    });
    next = await consume(res);
  } catch (err) {
    return { error: loginError(err) };
  }
  if (next) return next;
  redirect('/');
}

/** Terjemahkan jawaban API jadi langkah berikutnya; null berarti sesi sudah terbit. */
async function consume(res: LoginAttemptResponse): Promise<LoginState | null> {
  if ('mfaRequired' in res) {
    return {
      stage: 'EMAIL_OTP',
      mfaToken: res.mfaToken,
      emailHint: res.emailHint,
      demoOtpCode: res.demoOtpCode,
    };
  }
  if ('passwordChangeRequired' in res) {
    return {
      stage: 'PASSWORD_EXPIRED',
      changeToken: res.changeToken,
      maxAgeDays: res.maxAgeDays,
    };
  }
  await setToken(res.accessToken);
  return null;
}

function loginError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Sistem tidak bisa dihubungi. Periksa jaringan.';
}
