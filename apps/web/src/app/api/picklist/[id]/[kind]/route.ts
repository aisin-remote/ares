import { getToken } from '@/lib/session';

/**
 * Menyalurkan PDF picklist/kanban dari API Nest ke browser.
 *
 * Browser tidak bisa mengambilnya langsung dari :3001 — token sesi ada di
 * cookie httpOnly milik domain web, sedangkan API hanya membaca header
 * Authorization. Menempelkan token ke URL memang dimungkinkan guard-nya
 * (dibuat untuk SSE), tetapi itu menaruh JWT di access log, riwayat browser,
 * dan header Referer. Jadi tokennya dipasang di sini, di server.
 *
 * Isi berkas diteruskan sebagai stream, tidak pernah ditampung di memori.
 */
const BASE = process.env.API_URL ?? 'http://127.0.0.1:3001';

/** Jenis dokumen yang boleh diminta → jalur di API. */
const JALUR: Record<string, string> = {
  pdf: 'pdf',
  kanban: 'kanban.pdf',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  const { id, kind } = await params;
  const jalur = JALUR[kind];
  if (!jalur || !/^\d+$/.test(id)) {
    return new Response('Dokumen tidak dikenal', { status: 404 });
  }

  const token = await getToken();
  if (!token) return Response.redirect(new URL('/login', request.url), 307);

  const hulu = await fetch(`${BASE}/picklists/${id}/${jalur}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!hulu.ok || !hulu.body) {
    // Pesan API sudah berbahasa Indonesia dan menjelaskan sebabnya
    // (mis. PDF belum selesai dirender), jadi diteruskan apa adanya.
    const body = (await hulu.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? `Berkas tidak bisa diambil (${hulu.status})`, {
      status: hulu.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(hulu.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        hulu.headers.get('content-disposition') ?? `attachment; filename="picklist-${id}.pdf"`,
      // Nomor picklist tetap sama saat direvisi (F-25): PDF lama tidak boleh
      // tersaji dari cache browser atau proxy pabrik.
      'Cache-Control': 'no-store',
    },
  });
}
