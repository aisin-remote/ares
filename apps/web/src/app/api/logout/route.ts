import { NextResponse } from 'next/server';
import { clearToken } from '@/lib/session';

export async function POST() {
  await clearToken();
  // Relative Location mempertahankan host yang dipakai operator. `request.url`
  // dapat berisi localhost dari Next meski layar dibuka lewat 127.0.0.1/IP LAN.
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
