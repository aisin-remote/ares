'use server';

import {
  supplierRegistrationRequestSchema,
  supplierRegistrationVerifySchema,
  type SupplierRegistrationRequestResponse,
  type SupplierRegistrationVerifyResponse,
} from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

export interface RegistrationState {
  stage?: 'AUTHENTICATOR' | 'DONE';
  challengeId?: string;
  status?: 'PENDING_APPROVAL';
  qrDataUrl?: string;
  setupKey?: string;
  message?: string;
  error?: string;
}

export async function registrationAction(
  previous: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  const intent = String(formData.get('intent') ?? 'request');
  if (intent === 'request') {
    const password = String(formData.get('password') ?? '');
    if (password !== String(formData.get('passwordConfirmation') ?? '')) {
      return { error: 'Konfirmasi password tidak sama' };
    }
    const passwordParsed = supplierRegistrationVerifySchema
      .pick({ password: true })
      .safeParse({ password });
    if (!passwordParsed.success) {
      return {
        error: passwordParsed.error.issues[0]?.message ?? 'Password tidak valid',
      };
    }

    const parsed = supplierRegistrationRequestSchema.safeParse({
      vendorCode: formData.get('vendorCode'),
      name: formData.get('name'),
      email: formData.get('email'),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };

    try {
      const response = await apiFetch<SupplierRegistrationRequestResponse>(
        '/auth/supplier-registration/request',
        { method: 'POST', body: JSON.stringify(parsed.data), authenticated: false },
      );
      return {
        stage: 'AUTHENTICATOR',
        challengeId: response.challengeId,
        qrDataUrl: response.qrDataUrl,
        setupKey: response.setupKey,
        message: response.message,
      };
    } catch (error) {
      return { error: registrationError(error) };
    }
  }

  const password = String(formData.get('password') ?? '');
  if (password !== String(formData.get('passwordConfirmation') ?? '')) {
    return { ...previous, error: 'Konfirmasi password tidak sama' };
  }
  const parsed = supplierRegistrationVerifySchema.safeParse({
    challengeId: previous.challengeId,
    code: formData.get('code'),
    password,
  });
  if (!parsed.success) {
    return { ...previous, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }

  try {
    const response = await apiFetch<SupplierRegistrationVerifyResponse>(
      '/auth/supplier-registration/verify',
      { method: 'POST', body: JSON.stringify(parsed.data), authenticated: false },
    );
    return { stage: 'DONE', status: response.status, message: response.message };
  } catch (error) {
    return { ...previous, error: registrationError(error) };
  }
}

function registrationError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Tidak bisa menghubungi server API';
}
