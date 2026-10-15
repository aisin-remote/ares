import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { getEntityDef, isMasterEntity, type MasterEntity } from '@ares/contracts';
import { getMasterOptions, listMaster, type MasterOption } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Reveal } from '@/components/motion/reveal';
import { getSessionUser } from '@/lib/session';
import { MasterTable } from './master-table';

type View = { path?: string; section?: string; title?: string; description?: string; listFields?: string[]; intro?: React.ReactNode };

/** Pola master generik Avicenna, dipakai juga oleh tiga menu setting. */
export async function MasterEntityPage({ rawEntity, searchParams, view = {} }: {
  rawEntity: string;
  searchParams: Promise<{ page?: string; q?: string }>;
  view?: View;
}) {
  const user = await getSessionUser();
  if (user?.role !== 'ppic' && user?.role !== 'admin') notFound();
  if (!isMasterEntity(rawEntity)) notFound();
  const entity: MasterEntity = rawEntity;
  const def = getEntityDef(entity);
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);
  const search = sp.q?.trim() || undefined;
  const { data, meta } = await listMaster(entity, { page, perPage: 25, q: search });
  const refEntities = [...new Set(def.fields.filter((field) => field.kind === 'reference' && field.refEntity).map((field) => field.refEntity!))];
  // Satu kali baca per entitas referensi: daftar lengkap dipakai untuk label
  // baris (baris lama boleh menunjuk master nonaktif), bagian aktifnya dipakai
  // sebagai pilihan formulir. Dua kueri di sini berarti dua kali tabel penuh.
  const labelLists = await Promise.all(refEntities.map((ref) => getMasterOptions(ref, true)));
  const options: Record<string, MasterOption[]> = {};
  refEntities.forEach((ref, index) => {
    options[ref] = (labelLists[index] ?? []).filter((option) => !option.inactive);
  });
  const refLabels: Record<string, Record<string, string>> = {};
  for (const field of def.fields) {
    if (field.kind !== 'reference' || !field.refEntity) continue;
    const index = refEntities.indexOf(field.refEntity);
    refLabels[field.name] = Object.fromEntries((labelLists[index] ?? []).map((option) => [String(option.value), option.short ?? option.label]));
  }
  const path = view.path ?? `/master/${entity}`;
  const title = view.title ?? def.label;

  return <>
    <PageHeader
      crumbs={[{ label: view.section ?? 'Master Data' }, { label: title }]}
      title={title}
      description={view.description ?? `${meta.total} ${def.label.toLowerCase()} terdaftar — ${def.description.toLowerCase()}`}
      actions={<form action={path} className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-muted" strokeWidth={1.8} aria-hidden />
        <input type="search" name="q" defaultValue={search ?? ''} placeholder={`Cari ${def.label.toLowerCase()}`}
          aria-label={`Cari ${def.label}`} className="h-11 w-72 rounded-full border border-line bg-card pl-11 pr-4 text-[14px] outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-line-strong" />
      </form>}
    />
    {view.intro}
    <Reveal><MasterTable def={def} entity={entity} rows={data} options={options} refLabels={refLabels} listFieldNames={view.listFields} /></Reveal>
    {meta.totalPages > 1 ? <nav className="mt-5 flex items-center justify-between text-[14px]">
      <span className="text-ink-muted">Halaman {meta.page} dari {meta.totalPages}</span>
      <div className="flex gap-2">
        <PageLink path={path} page={meta.page - 1} disabled={meta.page <= 1} search={search} direction="prev">Sebelumnya</PageLink>
        <PageLink path={path} page={meta.page + 1} disabled={meta.page >= meta.totalPages} search={search} direction="next">Berikutnya</PageLink>
      </div>
    </nav> : null}
  </>;
}

function PageLink({ path, page, disabled, search, direction, children }: {
  path: string; page: number; disabled: boolean; search?: string; direction: 'prev' | 'next'; children: React.ReactNode;
}) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  const content = <>{direction === 'prev' ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : null}{children}{direction === 'next' ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : null}</>;
  const className = 'inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-card px-4 font-medium transition-colors duration-200 hover:border-line-strong hover:bg-surface';
  if (disabled) return <span aria-disabled className={`${className} opacity-45`}>{content}</span>;
  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set('q', search);
  return <Link href={`${path}?${query.toString()}`} className={className}>{content}</Link>;
}
