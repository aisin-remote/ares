import { getToken } from '@/lib/session';

/**
 * Menyalurkan PDF Receipt Sheet dari API Nest ke browser. Token dipasang di
 * server, sama alasannya dengan `api/picklist/[id]/[kind]`: JWT tidak boleh
 * masuk URL, riwayat browser, atau header Referer.
 */
const BASE = process.env.API_URL ?? 'http://127.0.0.1:3001';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const validReference = /^\d+$/.test(id)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!validReference) return new Response('Dokumen tidak dikenal', { status: 404 });

  const token = await getToken();
  if (!token) return Response.redirect(new URL('/login', request.url), 307);

  const hulu = await fetch(`${BASE}/receipts/${encodeURIComponent(id)}/receipt-sheet.pdf`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!hulu.ok || !hulu.body) {
    const body = (await hulu.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? 'Berkas tidak bisa diambil', {
      status: hulu.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(hulu.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        hulu.headers.get('content-disposition') ?? `attachment; filename="receipt-sheet-${id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
