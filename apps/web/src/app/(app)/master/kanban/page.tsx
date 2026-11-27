import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { QrCode, Search } from 'lucide-react';
import type { SapKanbanMasterList } from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { requirePermission } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { SapKanbanTable } from '@/components/master/sap-kanban-table';

export const dynamic = 'force-dynamic';

export default async function KanbanMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requirePermission('sap.kanban.write');
  const sp = await searchParams;
  const query = sp.q?.trim().slice(0, 100) ?? '';
  const requestedPage = Math.max(1, Math.floor(Number(sp.page)) || 1);
  let result: SapKanbanMasterList | null = null;
  let error: string | null = null;
  try {
    result = await apiFetch<SapKanbanMasterList>(`/sap/kanban?${new URLSearchParams({ q: query, page: String(requestedPage) })}`);
  } catch (err) {
    unstable_rethrow(err);
    error = err instanceof ApiRequestError ? err.message : 'Master kanban belum dapat dibaca. Periksa koneksi API.';
  }
  const href = (page: number) => `/master/kanban?${new URLSearchParams({ q: query, page: String(page) })}`;

  return (
    <>
      <PageHeader crumbs={[{ label: 'Master Data' }, { label: 'Create Kanban' }]}
        title="Create Kanban" description="Isi qty per kanban. Data supplier, part, dan lokasi berasal dari staging SAP."
        actions={<form action="/master/kanban" className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input name="q" type="search" defaultValue={query} key={query} aria-label="Cari supplier, part, atau back number"
            placeholder="Cari supplier, part, atau back no" maxLength={100}
            className="h-11 w-full rounded-full border border-line bg-card pl-11 pr-4 text-sm focus-visible:outline-2 focus-visible:outline-accent sm:w-80" />
        </form>} />
      {error ? <Card className="space-y-3 p-6">
        <p role="alert" className="text-sm text-ng">{error}</p>
        <Link href={href(requestedPage)} className="inline-flex h-11 items-center rounded-full border border-line px-4 text-sm font-semibold">Coba lagi</Link>
      </Card> : result && <Card>
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <QrCode aria-hidden className="size-5 text-ink-muted" />
          <h2 className="font-semibold">{result.total.toLocaleString('id-ID')} data kanban supplier</h2>
        </div>
        <SapKanbanTable key={`${query}-${result.page}`} rows={result.rows} />
      </Card>}
      {result && result.totalPages > 1 && <nav aria-label="Halaman master kanban" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-ink-muted">Halaman {result.page} dari {result.totalPages}</p>
        <div className="flex gap-2">
          {result.page > 1 && <Link href={href(result.page - 1)} className="inline-flex h-11 items-center rounded-full border border-line px-4">Sebelumnya</Link>}
          {result.page < result.totalPages && <Link href={href(result.page + 1)} className="inline-flex h-11 items-center rounded-full border border-line px-4">Berikutnya</Link>}
        </div>
      </nav>}
    </>
  );
}
