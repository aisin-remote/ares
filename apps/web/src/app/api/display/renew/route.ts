import { NextResponse } from 'next/server';
import { clearDisplayToken, getDisplayToken, setDisplayToken } from '@/lib/session';

const API = process.env.API_URL ?? 'http://127.0.0.1:3001';

export async function POST() {
  const token = await getDisplayToken();
  if (!token) return NextResponse.json({ message: 'Sesi monitor tidak ada' }, { status: 401 });

  try {
    const response = await fetch(`${API}/auth/device/renew`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.status === 401) {
      await clearDisplayToken();
      return NextResponse.json({ message: 'Sesi monitor dicabut' }, { status: 401 });
    }
    if (!response.ok) return NextResponse.json({ message: 'Pembaruan sesi gagal' }, { status: 502 });
    const body = await response.json() as { accessToken: string };
    await setDisplayToken(body.accessToken);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ message: 'API tidak dapat dihubungi' }, { status: 503 });
  }
}
