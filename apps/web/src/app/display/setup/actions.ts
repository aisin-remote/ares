'use server';

import { redirect } from 'next/navigation';
import {
  deviceLoginSchema,
  type DeviceLoginResponse,
} from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { setDisplayToken } from '@/lib/session';

export interface DisplaySetupState {
  error?: string;
}

export async function displaySetupAction(
  _previous: DisplaySetupState,
  formData: FormData,
): Promise<DisplaySetupState> {
  const parsed = deviceLoginSchema.safeParse({
    deviceCode: formData.get('deviceCode'),
    token: formData.get('token'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Data perangkat tidak valid' };
  }

  try {
    const response = await apiFetch<DeviceLoginResponse>('/auth/device', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      authenticated: false,
    });
    if (response.device.kind !== 'MACHINE_PANEL') {
      return { error: 'Kode ini bukan perangkat monitor.' };
    }
    await setDisplayToken(response.accessToken);
  } catch (error) {
    if (error instanceof ApiRequestError) return { error: error.message };
    return { error: 'Tidak bisa menghubungi server API' };
  }

  redirect('/display/receiving');
}
