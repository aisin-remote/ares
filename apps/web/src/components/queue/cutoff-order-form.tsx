'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Clock3, Loader2, Save } from 'lucide-react';
import {
  getCutoffResultAction,
  runCutoffAction,
  setQueueHoldAction,
  setQueueKanbanAction,
} from '@/app/(app)/queue/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { useFeedback } from '@/components/ui/feedback-provider';

type QueueRow = {
  id: number;
  partNo: string;
  partName: string;
  backNo: string;
  qtyPerKanban: number;
  plannedKanban: number;
  remainingKanban: number;
  equivalentKanban: number;
  standardKanban: number | null;
  hold: boolean;
  blockedReason: string | null;
};
type Draft = { kanban: string; hold: boolean };
const numberLabel = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const inputClass = 'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[14px] outline-none focus:border-line-strong';

export function CutoffOrderForm({
  vendorId, vendorName, sapVendorNo, cutoffAt, cutoffLabel, canRun, rows,
}: {
  vendorId: number;
  vendorName: string;
  sapVendorNo: string | null;
  cutoffAt: string;
  cutoffLabel: string;
  canRun: boolean;
  rows: QueueRow[];
}) {
  const [savedRows, setSavedRows] = useState(rows);
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, { kanban: String(row.plannedKanban), hold: row.hold }])),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(canRun);
  const [jobId, setJobId] = useState<string>();
  const [finished, setFinished] = useState(false);
  const submitting = useRef(false);
  const router = useRouter();
  const feedback = useFeedback();
  const backHref = `/queue/${vendorId}`;
  const changed = savedRows.filter((row) =>
    Number(drafts[row.id]!.kanban) !== row.plannedKanban || drafts[row.id]!.hold !== row.hold,
  );
  const totalKanban = savedRows.reduce((sum, row) =>
    sum + (drafts[row.id]!.hold ? 0 : Number(drafts[row.id]!.kanban) || 0), 0,
  );
  const itemCount = savedRows.filter((row) =>
    !drafts[row.id]!.hold && Number(drafts[row.id]!.kanban) > 0,
  ).length;
  const anomalies = savedRows.filter((row) =>
    !drafts[row.id]!.hold && row.standardKanban != null
      && Number(drafts[row.id]!.kanban) !== row.standardKanban,
  );
  const heldCount = savedRows.filter((row) => drafts[row.id]!.hold).length;
  const requiresReason = changed.length > 0 || anomalies.length > 0;

  useEffect(() => {
    if (ready) return;
    const check = () => setReady(new Date(cutoffAt).getTime() <= Date.now());
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [cutoffAt, ready]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await getCutoffResultAction(jobId);
      if (cancelled) return;
      if (result.status === 'processing') {
        timer = setTimeout(() => void poll(), 1500);
        return;
      }
      setJobId(undefined);
      if (result.status === 'created') {
        setFinished(true);
        feedback.success('Order Sheet berhasil diterbitkan', result.picklistNo);
        router.push(`/picklist/${result.publicId}`);
      } else {
        setBusy(false);
        submitting.current = false;
        if (result.status === 'skipped') {
          setFinished(true);
          setNotice(result.error);
          feedback.info('Cutoff selesai', result.error);
        } else {
          setError(result.error);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, feedback, router]);

  function updateDraft(id: number, patch: Partial<Draft>) {
    setDrafts((old) => ({ ...old, [id]: { ...old[id]!, ...patch } }));
    setError(undefined);
  }

  async function submit(issue: boolean) {
    if (submitting.current || finished) return;
    setError(undefined);
    const invalid = savedRows.find((row) => {
      const value = drafts[row.id]!.kanban;
      return value.trim() === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0;
    });
    if (invalid) {
      setError(`${invalid.partNo}: isi jumlah kanban dengan bilangan bulat minimal 0.`);
      return;
    }
    const cleanReason = reason.trim();
    if ((changed.length > 0 || (issue && anomalies.length > 0) || cleanReason.length > 0)
      && cleanReason.length < 3) {
      setError('Isi alasan perubahan minimal 3 karakter.');
      return;
    }
    if (issue && !ready) {
      setError('Order Sheet dapat diterbitkan setelah waktu cutoff tercapai.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      // Setiap hasil tersimpan langsung dicatat agar retry hanya mengirim perubahan yang belum berhasil.
      for (const row of changed) {
        const draft = drafts[row.id]!;
        if (Number(draft.kanban) !== row.plannedKanban) {
          const result = await setQueueKanbanAction(row.id, { kanban: Number(draft.kanban), reason: cleanReason });
          if ('error' in result) throw new Error(`${row.partNo}: ${result.error}`);
          setSavedRows((old) => old.map((item) => item.id === row.id
            ? { ...item, plannedKanban: Number(draft.kanban), equivalentKanban: Number(draft.kanban), remainingKanban: 0 }
            : item));
        }
        if (draft.hold !== row.hold) {
          const result = await setQueueHoldAction(row.id, { hold: draft.hold, reason: cleanReason });
          if ('error' in result) throw new Error(`${row.partNo}: ${result.error}`);
          setSavedRows((old) => old.map((item) => item.id === row.id ? { ...item, hold: draft.hold } : item));
        }
      }
      if (!issue) {
        feedback.success('Perubahan antrean tersimpan', `${changed.length} item diperbarui.`);
        setBusy(false);
        submitting.current = false;
        return;
      }
      const result = await runCutoffAction(vendorId, cutoffAt, cleanReason || undefined);
      if (result.error || !result.jobId) throw new Error(result.error ?? 'Proses cutoff gagal dimulai.');
      setJobId(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Perubahan gagal disimpan. Coba kembali.');
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <form className="px-6 py-5" onSubmit={(event) => { event.preventDefault(); void submit(true); }}>
      <fieldset disabled={busy || finished} className="min-w-0">
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <label htmlFor="queue-supplier" className="mb-2 block text-[14px] font-semibold">Supplier</label>
            <input id="queue-supplier" readOnly value={vendorName} className={inputClass} />
            {sapVendorNo ? <p className="mt-1.5 text-[12px] text-ink-muted">Vendor {sapVendorNo}</p> : null}
          </div>
          <div>
            <label htmlFor="queue-cutoff" className="mb-2 block text-[14px] font-semibold">Jadwal cutoff</label>
            <input id="queue-cutoff" readOnly value={cutoffLabel} className={inputClass} />
          </div>
          <div>
            <p className="mb-2 text-[14px] font-semibold">Status</p>
            <div className={cn('flex h-11 items-center gap-2 rounded-2xl border px-4 text-[13px] font-semibold',
              ready ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line bg-surface text-ink-muted')}>
              <Clock3 className="size-4" aria-hidden />
              {ready ? 'Siap diterbitkan' : 'Menunggu cutoff'}
            </div>
          </div>
        </div>

        <div className="mb-3 mt-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-bold">Part dan jumlah kanban</h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              Isi jumlah kanban penuh. Aktifkan Tahan jika part dilanjutkan ke cutoff berikutnya.
            </p>
          </div>
          <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold">
            {itemCount} part · {numberLabel(totalKanban)} kanban · {heldCount} ditahan
          </span>
        </div>
        <div className="scroll-slim overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[840px] border-collapse text-left text-[14px]">
            <thead className="bg-surface text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-5 py-3">Part</th>
                <th scope="col" className="px-4 py-3">Back no</th>
                <th scope="col" className="px-4 py-3 text-right">Akumulasi</th>
                <th scope="col" className="px-4 py-3 text-right">Standar</th>
                <th scope="col" className="px-4 py-3">Perbandingan</th>
                <th scope="col" className="px-4 py-3 text-right">Qty order</th>
                <th scope="col" className="px-5 py-3 text-center">Tahan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {savedRows.map((row) => {
                const draft = drafts[row.id]!;
                const quantity = Number(draft.kanban);
                const difference = row.standardKanban == null ? null : quantity - row.standardKanban;
                return (
                  <tr id={`part-${row.id}`} key={row.id} className={cn('scroll-mt-6', draft.hold && 'bg-surface')}>
                    <td className="px-5 py-4">
                      <p className="font-semibold">{row.partNo}</p>
                      <p className="mt-0.5 text-[12px] text-ink-muted">{row.partName}</p>
                      {row.blockedReason ? <p className="mt-1 max-w-64 text-[12px] text-ng">{row.blockedReason}</p> : null}
                    </td>
                    <td className="px-4 py-4 font-mono text-[13px]">{row.backNo}</td>
                    <td className="px-4 py-4 text-right tabular-nums">
                      {numberLabel(row.equivalentKanban)} kanban
                      <p className="mt-1 text-[11px] text-ink-muted">Sisa {numberLabel(row.remainingKanban)} kanban</p>
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums">
                      {row.standardKanban == null ? '—' : `${row.standardKanban} kanban`}
                    </td>
                    <td className="px-4 py-4">
                      <span className={cn('text-[12px] font-semibold',
                        draft.hold ? 'text-ink-muted' : difference === 0 ? 'text-ok' : 'text-warn')}>
                        {draft.hold ? 'Ditahan' : difference == null ? 'Standar belum diatur'
                          : difference === 0 ? 'Sesuai standar'
                            : `${difference > 0 ? '+' : ''}${numberLabel(difference)} kanban`}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <input
                        aria-label={`Jumlah kanban ${row.partNo}`}
                        type="number" inputMode="numeric" min={0} step={1} required
                        value={draft.kanban}
                        disabled={draft.hold}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => updateDraft(row.id, { kanban: event.target.value })}
                        className="h-10 w-28 rounded-xl border border-line bg-surface px-3 text-right text-[15px] font-semibold tabular-nums outline-none focus:border-accent disabled:opacity-50"
                      />
                      <p className="mt-1 text-[11px] text-ink-muted">{row.qtyPerKanban} pcs/kanban</p>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <input
                        type="checkbox" checked={draft.hold}
                        aria-label={`Tahan antrean ${row.partNo}`}
                        onChange={(event) => updateDraft(row.id, { hold: event.target.checked })}
                        className="size-5 cursor-pointer accent-accent"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(anomalies.length > 0 || !ready || totalKanban === 0) ? (
          <div className="mt-5 flex items-start gap-2 rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] leading-5 text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              {anomalies.length > 0 ? <p>{anomalies.length} item berbeda dari standar. Isi alasan sebelum menerbitkan.</p> : null}
              {!ready ? <p>Perubahan dapat disimpan sekarang. Penerbitan aktif setelah waktu cutoff tercapai.</p> : null}
              {totalKanban === 0 ? <p>Belum ada kanban penuh untuk diterbitkan. Proses cutoff akan meneruskan sisa ke jadwal berikutnya tanpa membuat Order Sheet.</p> : null}
            </div>
          </div>
        ) : null}

        <div className="mt-6">
          <label htmlFor="queue-reason" className="mb-2 block text-[14px] font-semibold">
            Alasan perubahan {requiresReason ? <span className="text-ng">*</span> : null}
          </label>
          <textarea
            id="queue-reason" value={reason} rows={3} maxLength={255}
            onChange={(event) => { setReason(event.target.value); setError(undefined); }}
            placeholder="Contoh: penyesuaian kebutuhan produksi"
            className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] outline-none focus:border-line-strong"
          />
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Wajib untuk perubahan jumlah, tahan/lepas antrean, atau selisih terhadap standar.
          </p>
        </div>
      </fieldset>

      {notice ? (
        <p role="status" className="mt-5 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] text-ink-soft">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-5 flex items-start gap-2 rounded-2xl border border-ng/25 bg-ng/10 px-4 py-3 text-[14px] text-ng">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || finished || !ready} icon={busy ? Loader2 : undefined}>
          {busy ? 'Sedang memproses…' : totalKanban > 0 ? 'Terbitkan Order Sheet' : 'Proses cutoff'}
        </Button>
        <Button variant="outline" icon={Save} onClick={() => void submit(false)} disabled={busy || finished || changed.length === 0}>
          Simpan perubahan
        </Button>
        {!busy ? <Link href={backHref} className="px-3 py-2 text-[14px] font-semibold text-ink-soft hover:text-ink">Kembali</Link> : null}
      </div>
    </form>
  );
}
