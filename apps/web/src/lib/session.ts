import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { authSessionResponseSchema } from '@ares/contracts';

const COOKIE = process.env.NODE_ENV === 'production' ? '__Host-ares_token' : 'ares_token';
const DISPLAY_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Host-ares_display_token'
  : 'ares_display_token';
const API = process.env.API_URL ?? 'http://127.0.0.1:3001';

export interface SessionUser {
  id: number;
  npk: string;
  name: string;
  role: string | null;
  plantId: number | null;
  /** Terisi untuk akun supplier; menentukan scope seluruh data portal. */
  vendorId: number | null;
  permissions: string[];
}

/**
 * Token disimpan di cookie httpOnly, bukan localStorage.
 *
 * Alasannya: layar pabrik dipakai bergantian antar shift dan sering dibiarkan
 * terbuka. Cookie httpOnly tidak terbaca skrip apa pun di halaman, dan hilang
 * mengikuti masa berlakunya tanpa perlu diingat operator.
 */
export async function getToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(COOKIE)?.value;
}

export async function setToken(token: string, maxAgeSeconds?: number): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds ?? tokenMaxAge(token, 8 * 3600),
  });
}

export async function clearToken(): Promise<void> {
  const store = await cookies();
  // Cookie __Host- hanya boleh diubah dengan Secure + Path=/; delete() tidak
  // menyertakan atribut itu sehingga browser mempertahankan sesi produksi.
  store.set(COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export interface DisplaySession {
  id: number;
  code: string;
  name: string;
  plantId: number;
}

async function inspectToken(token: string) {
  try {
    const response = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!response.ok) return null;
    return authSessionResponseSchema.parse(await response.json());
  } catch { return null; }
}

function tokenMaxAge(token: string, fallback: number): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { exp?: number };
    return payload.exp ? Math.max(60, payload.exp - Math.floor(Date.now() / 1000)) : fallback;
  } catch { return fallback; }
}

/** Sesi pengguna untuk halaman; null bila token tidak ada, palsu, atau kedaluwarsa. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = await getToken();
  if (!token) return null;

  const payload = await inspectToken(token);
  if (!payload || payload.kind !== 'user') return null;

  return {
    id: payload.sub,
    npk: payload.npk,
    name: payload.name,
    role: payload.role,
    plantId: payload.plantId,
    vendorId: payload.vendorId ?? null,
    permissions: payload.permissions,
  };
});

/** Otorisasi halaman Server Component; URL langsung tetap diperiksa server. */
export async function requirePermission(action: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.permissions.includes(action)) notFound();
  return user;
}

export async function getDisplayToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(DISPLAY_COOKIE)?.value;
}

/** Cookie monitor mengikuti masa hidup JWT dan diperbarui oleh heartbeat layar. */
export async function setDisplayToken(token: string): Promise<void> {
  const maxAge = tokenMaxAge(token, 365 * 24 * 3600);
  const store = await cookies();
  store.set(DISPLAY_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
}

export async function clearDisplayToken(): Promise<void> {
  const store = await cookies();
  store.set(DISPLAY_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/** Validasi token dan status perangkat agar revoke berlaku pada refresh berikutnya. */
export async function getDisplaySession(): Promise<DisplaySession | null> {
  const token = await getDisplayToken();
  if (!token) return null;
  const device = await inspectToken(token);
  if (!device || device.kind !== 'device' || device.deviceKind !== 'MACHINE_PANEL'
      || device.plantId == null) return null;
  return { id: device.sub, code: device.code, name: device.name, plantId: device.plantId };
}
