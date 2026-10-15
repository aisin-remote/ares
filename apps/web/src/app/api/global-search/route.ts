import { getSessionUser } from '@/lib/session';
import { searchGlobalData } from '@/lib/queries';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ message: 'Sesi berakhir' }, { status: 401 });
  if (user.plantId == null) return Response.json({ results: [] });

  const q = new URL(request.url).searchParams.get('q')?.trim().slice(0, 80) ?? '';
  if (q.length < 2) return Response.json({ query: q, results: [] });

  const results = await searchGlobalData({
    q,
    plantId: user.plantId,
    vendorId: user.vendorId,
    permissions: user.permissions,
  });
  return Response.json({ query: q, results }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
