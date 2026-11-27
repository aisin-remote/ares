import { MasterEntityPage } from '@/components/master/master-entity-page';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { entity } = await params;
  if (entity === 'bom') notFound();
  await requirePermission(entity === 'users' ? 'user.write' : 'master.read');
  return (
    <MasterEntityPage
      rawEntity={entity}
      searchParams={searchParams}
    />
  );
}
