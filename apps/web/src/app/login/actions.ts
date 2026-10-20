'use server';

import { redirect } from 'next/navigation';
import {
  loginSchema,
  loginOtpSchema,
  type LoginAttemptResponse,
  type LoginResponse,
} from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { setToken } from '@/lib/session';

export interface LoginState {
  stage?: 'EMAIL_OTP';
  mfaToken?: string;
  emailHint?: string;
  demoOtpCode?: string;
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
  if (prev.stage === 'EMAIL_OTP') {
    const parsed = loginOtpSchema.safeParse({
      mfaToken: prev.mfaToken,
      otpCode: formData.get('otpCode'),
    });
    if (!parsed.success) {
      return { ...prev, error: parsed.error.issues[0]?.message ?? 'Kode tidak valid' };
    }
    try {
      const response = await apiFetch<LoginResponse>('/auth/login/otp', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        authenticated: false,
      });
      await setToken(response.accessToken);
    } catch (error) {
      return { ...prev, error: loginError(error) };
    }
    redirect('/dashboard');
  }

  const parsed = loginSchema.safeParse({
    npk: formData.get('npk'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }

  try {
    const res = await apiFetch<LoginAttemptResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      authenticated: false,
    });
    if ('mfaRequired' in res) {
      return {
        stage: 'EMAIL_OTP',
        mfaToken: res.mfaToken,
        emailHint: res.emailHint,
        demoOtpCode: res.demoOtpCode,
      };
    }
    await setToken(res.accessToken);
  } catch (err) {
    return { error: loginError(err) };
  }

  redirect('/dashboard');
}

function loginError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Tidak bisa menghubungi server API';
}
