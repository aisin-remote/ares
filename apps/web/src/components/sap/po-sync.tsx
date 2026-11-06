'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PoSyncResult, PoSyncStatus } from '@ares/contracts';
import { poJobAction, setPoPullDayAction, syncPoAction } from '@/app/(app)/sap/actions';
import { Card, CardHeader } from '../ui/card';
import { Table, Th, Td, Tr } from '../ui/table';
import { CalendarClock, Download, Eye, RefreshCw } from 'lucide-react';

export function PoSync({ status, canSync, canSchedule }: { status: PoSyncStatus; canSync: boolean; canSchedule: boolean }) {
  const [month, setMonth] = useState(status.month);
  const [pullDay, setPullDay] = useState(String(status.pullDay));
  const [dayMessage, setDayMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<PoSyncResult | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
      const job = await poJobAction(jobId);
      if (cancelled) return;
      if (!('state' in job) || job.state === 'failed') {
        setMessage(job.error || 'Penarikan PO gagal. Silakan coba lagi.');
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
      const response = await syncPoAction(month, preview);
      if ('error' in response || !response.jobId) {
        setMessage('error' in response ? response.error : 'Proses belum berhasil masuk antrean.'); setBusy(false); return;
      }
      setJobId(response.jobId);
    } catch {
      setMessage('Koneksi terputus. Muat ulang halaman untuk memeriksa hasil.'); setBusy(false);
    }
  }
  async function saveDay() {
    setDayMessage('');
    const response = await setPoPullDayAction(Number(pullDay));
    setDayMessage('error' in response ? response.error : `Tersimpan: PO bulan berikutnya ditarik tiap tanggal ${response.pullDay}.`);
  }
  const button = 'inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold disabled:opacity-50';
  return (
    <Card className="mb-5">
      <CardHeader title="PO supplier dari SAP" subtitle={`${status.enabled ? `Tarik otomatis tiap tanggal ${status.pullDay} untuk PO bulan berikutnya` : 'Penarikan otomatis nonaktif'} · ${status.count} PO berlaku ${status.month}`} icon={Download} />
      <div className="space-y-4 p-5">
        <p className="text-sm text-ink-muted">PO yang dibuat SAP di satu bulan berlaku untuk order bulan berikutnya, dan Order Sheet memakai PO bulan tanggal kirimnya. Sisa per item = qty PO − pesanan ARES yang tidak dibatalkan.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-semibold">Tanggal tarik otomatis
            <input type="number" min={1} max={28} value={pullDay} onChange={(e) => setPullDay(e.target.value)} disabled={!canSchedule} className="h-11 w-28 rounded-input border border-line bg-field px-3 text-ink" />
          </label>
          {canSchedule && <button type="button" className={button} disabled={!pullDay || Number(pullDay) === status.pullDay} onClick={() => void saveDay()}><CalendarClock className="size-4" />Simpan tanggal</button>}
          {dayMessage && <span role="status" className="text-sm text-ink-muted">{dayMessage}</span>}
        </div>
        {!status.enabled && <p className="text-sm text-warn">Penarikan otomatis belum aktif. Pratinjau tetap dapat membaca data SAP.</p>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-semibold">Bulan berlaku PO
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={busy} className="h-11 rounded-input border border-line bg-field px-3 text-ink" />
          </label>
          {canSync && <>
            <button type="button" className={button} disabled={busy || !month} onClick={() => void start(true)}><Eye className="size-4" />Pratinjau</button>
            <button type="button" className={`${button} bg-accent text-white`} disabled={busy || !month || !status.enabled} onClick={() => void start(false)}><Download className="size-4" />Tarik PO</button>
          </>}
          {busy && <span role="status" className="flex items-center gap-2 text-sm text-ink-muted"><RefreshCw className="size-4 animate-spin" />Membaca PO SAP…</span>}
        </div>
        {message && <p role="alert" className="text-sm text-ng">{message}</p>}
        {result && <div className="space-y-3" aria-live="polite">
          <p className="text-sm font-semibold">{result.month}: {result.fetched} item dibaca · {result.imported} item {result.preview ? 'lolos pratinjau' : 'tersimpan'} · {result.failed} item perlu diperiksa</p>
          {result.fetched === 0 && <p className="text-sm text-ink-muted">Belum ada PO di staging SAP yang dibuat sebulan sebelumnya. Data bulan lain tidak diubah.</p>}
          {result.issues.length > 0 && <ul className="space-y-1 text-sm text-warn">{result.issues.map((issue, i) => <li key={`${issue.poNo}-${i}`}>PO {issue.poNo}: {issue.reason}</li>)}</ul>}
          {result.rows.length > 0 && <div className="overflow-x-auto"><Table><thead><tr><Th>PO / item</Th><Th>Supplier SAP</Th><Th>Material</Th><Th>Qty PO</Th></tr></thead><tbody>{result.rows.map((row) => <Tr key={`${row.poNo}-${row.item}`}><Td>{row.poNo} / {row.item}</Td><Td>{row.vendorNo}</Td><Td>{row.material}</Td><Td>{row.orderedQty.toLocaleString('id-ID')}</Td></Tr>)}</tbody></Table></div>}
        </div>}
      </div>
    </Card>
  );
}
