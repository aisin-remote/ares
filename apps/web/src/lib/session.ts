import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'ares_token';

export interface SessionUser {
  id: number;
  npk: string;
  name: string;
  role: string | null;
  plantId: number | null;
  /** Terisi untuk akun supplier; menentukan scope seluruh data portal. */
  vendorId: number | null;
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

export async function setToken(token: string, maxAgeSeconds = 8 * 3600): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export async function clearToken(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

interface TokenPayload {
  sub: number;
  npk: string;
  name: string;
  role: string | null;
  plantId: number | null;
  vendorId: number | null;
  exp?: number;
}

/**
 * Memverifikasi tanda tangan HS256 dengan JWT_SECRET yang sama seperti API.
 *
 * Ini bukan hiasan. Nilai `vendorId` dari token dipakai menyaring query portal
 * (aturan repo 9); tanpa verifikasi, siapa pun yang bisa menyunting cookie di
 * devtools cukup menukar angkanya untuk membaca order supplier lain. httpOnly
 * hanya menghalangi JavaScript halaman, bukan pemiliknya sendiri.
 *
 * Ditulis dengan `node:crypto` — 20 baris, tidak perlu pustaka JWT tambahan
 * (aturan repo 12).
 */
function bacaTokenTerverifikasi(token: string): TokenPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const [kepala, isi, tanda] = token.split('.');
  if (!kepala || !isi || !tanda) return null;

  try {
    // Tolak alg selain HS256 — termasuk 'none', yang membuat tanda tangan
    // kosong dianggap sah oleh pustaka yang ceroboh.
    const alg = (JSON.parse(Buffer.from(kepala, 'base64url').toString()) as { alg?: string }).alg;
    if (alg !== 'HS256') return null;

    const harap = createHmac('sha256', secret).update(`${kepala}.${isi}`).digest();
    const ada = Buffer.from(tanda, 'base64url');
    if (ada.length !== harap.length || !timingSafeEqual(ada, harap)) return null;

    const payload = JSON.parse(Buffer.from(isi, 'base64url').toString()) as TokenPayload;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Sesi pengguna untuk halaman; null bila token tidak ada, palsu, atau kedaluwarsa. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await getToken();
  if (!token) return null;

  const payload = bacaTokenTerverifikasi(token);
  if (!payload) return null;

  return {
    id: payload.sub,
    npk: payload.npk,
    name: payload.name,
    role: payload.role,
    plantId: payload.plantId,
    vendorId: payload.vendorId ?? null,
  };
}
