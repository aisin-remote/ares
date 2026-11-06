'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MasterSyncResult } from '@ares/contracts';
import { masterJobAction, syncMasterAction } from '@/app/(app)/sap/actions';
import { Card, CardHeader } from '../ui/card';
import { Database, Download, Eye, RefreshCw } from 'lucide-react';

/** F-01/F-02: tarik master supplier, part, dan vendor part dari staging SAP; pola sama dengan PoSync. */
export function MasterSync({ enabled, canSync }: { enabled: boolean; canSync: boolean }) {
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<MasterSyncResult | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await masterJobAction(jobId);
        if (cancelled) return;
        if (!('state' in job) || job.state === 'failed') {
          setMessage(job.error || 'Penarikan master gagal. Silakan coba lagi.');
          setBusy(false); setJobId(undefined); return;
        }
        if (job.state === 'completed') {
          setResult(job.result); setBusy(false); setJobId(undefined); router.refresh(); return;
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch {
        if (!cancelled) { setMessage('Koneksi terputus. Muat ulang halaman untuk memeriksa hasil.'); setBusy(false); setJobId(undefined); }
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, router]);

  async function start(preview: boolean) {
    setBusy(true); setMessage(''); setResult(null);
    try {
      const response = await syncMasterAction(preview);
      if ('error' in response || !response.jobId) {
        setMessage('error' in response ? response.error : 'Proses belum berhasil masuk antrean.'); setBusy(false); return;
      }
      setJobId(response.jobId);
    } catch {
      setMessage('Koneksi terputus. Muat ulang halaman untuk memeriksa hasil.'); setBusy(false);
    }
  }
  const button = 'inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold disabled:opacity-50';
  const count = (c: { created: number; updated?: number; unchanged?: number; existing?: number; skipped?: number }) =>
    [`${c.created} baru`, c.updated !== undefined ? `${c.updated} diperbarui` : null, c.unchanged !== undefined ? `${c.unchanged} sama` : null,
      c.existing !== undefined ? `${c.existing} sudah ada` : null, c.skipped ? `${c.skipped} dilewati` : null].filter(Boolean).join(' · ');

  return (
    <Card className="mb-5">
      <CardHeader title="Master dari SAP" subtitle="Supplier, part, dan vendor part dari staging SAP · ditarik manual" icon={Database} />
      <div className="space-y-4 p-5">
        <p className="text-sm text-ink-muted">
          Hanya supplier dan part yang punya pasangan vendor part di SAP atau sudah ada di ARES. Nama, alamat, dan status ikut SAP;
          pabrik, jadwal kirim, email, dan kemasan vendor part yang sudah ada tidak diubah. Vendor part baru memakai qty per box dari kanban SAP, lalu master part.
        </p>
        {!enabled && <p className="text-sm text-warn">Penarikan data SAP belum aktif. Pratinjau tetap dapat membaca data staging.</p>}
        {canSync && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={button} disabled={busy} onClick={() => void start(true)}><Eye className="size-4" />Pratinjau</button>
            <button type="button" className={`${button} bg-accent text-white`} disabled={busy || !enabled} onClick={() => void start(false)}><Download className="size-4" />Tarik master</button>
            {busy && <span role="status" className="flex items-center gap-2 text-sm text-ink-muted"><RefreshCw className="size-4 animate-spin" />Membaca master SAP…</span>}
          </div>
        )}
        {message && <p role="alert" className="text-sm text-ng">{message}</p>}
        {result && (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p className="font-semibold">{result.preview ? 'Pratinjau (belum disimpan)' : 'Tersimpan'}</p>
            <ul className="space-y-1 text-ink-soft">
              <li>Supplier: {count(result.vendors)}</li>
              <li>Part: {count(result.parts)}</li>
              <li>Vendor part: {count(result.vendorParts)}</li>
            </ul>
            {result.vendors.created > 0 && !result.preview && (
              <p className="text-warn">Supplier baru belum punya pabrik dan jadwal cutoff; lengkapi di Master Data sebelum diorder.</p>
            )}
            {result.issues.length > 0 && (
              <ul className="space-y-1 text-warn">{result.issues.map((issue, i) => <li key={`${issue.key}-${i}`}>{issue.key}: {issue.reason}</li>)}</ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
