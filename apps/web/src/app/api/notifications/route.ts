import { getSessionUser } from '@/lib/session';
import { getNavNotifications } from '@/lib/queries';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ message: 'Sesi berakhir' }, { status: 401 });
  if (user.plantId == null) return Response.json({ notifications: [], total: 0 });

  const notifications = await getNavNotifications({
    plantId: user.plantId,
    vendorId: user.vendorId,
    permissions: user.permissions,
  });
  return Response.json({
    notifications,
    total: notifications.reduce((sum, item) => sum + item.count, 0),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
