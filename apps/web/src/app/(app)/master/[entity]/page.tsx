import { MasterEntityPage } from '@/components/master/master-entity-page';
import { BomTools } from '@/components/master/bom-tools';
import { getMasterOptions } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { entity } = await params;
  // BOM (F-03) punya dua alat di atas tabel generiknya: upload Excel dan pratinjau urai.
  const intro = entity === 'bom' ? <BomTools parts={await getMasterOptions('parts')} /> : undefined;
  return (
    <MasterEntityPage
      rawEntity={entity}
      searchParams={searchParams}
      view={intro ? { intro } : {}}
    />
  );
}
