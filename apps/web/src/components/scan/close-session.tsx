'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, DoorClosed } from 'lucide-react';
import { closeReceiptAction } from '@/app/(app)/receiving/actions';
import type { ReceiptDetail } from '@/lib/queries';
import { cn } from '../ui/cn';

type Line = ReceiptDetail['lines'][number];

/**
 * Dialog tutup sesi (F-37, 6.5).
 *
 * Ringkasan dihitung dari counter yang sudah ada di layar, bukan dari server:
 * operator baru saja melihat angka itu naik, dan angka yang sama harus muncul
 * di sini. Keputusan COMPLETE/PARTIAL tetap milik API — dialog hanya memberi
 * tahu bahwa alasan akan diminta, dan meneruskan 422 apa adanya bila API
 * tetap menolak (mis. kanban yang berubah dari stasiun lain).
 */
export function CloseSession({
  receiptId,
  lines,
  rejected,
  onCancel,
  onClosed,
}: {
  receiptId: number;
  lines: Line[];
  rejected: number;
  onCancel: () => void;
  onClosed: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const kurang = lines.filter((l) => l.boxScanned < l.boxOrdered);
  const totalKurang = kurang.reduce((n, l) => n + (l.boxOrdered - l.boxScanned), 0);
  const cocok = lines.length - kurang.length;

  useEffect(() => {
    if (totalKurang > 0) reasonRef.current?.focus();
  }, [totalKurang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function tutup() {
    if (totalKurang > 0 && !reason.trim()) {
      setError('Alasan wajib diisi bila ada box yang belum datang.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await closeReceiptAction(receiptId, reason);
    if ('error' in res) {
      setBusy(false);
      setError(res.error);
      return;
    }
    onClosed();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutup-sesi-judul"
      // Handheld: lembar dari bawah, jempol menjangkau tombolnya; mulai sm: dialog tengah.
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
    >
      <div className="a-rise max-h-[92dvh] w-full max-w-[560px] overflow-y-auto rounded-t-panel border border-line bg-card p-5 sm:rounded-panel sm:p-6">
        <h2
          id="tutup-sesi-judul"
          className="text-[22px] font-extrabold leading-tight tracking-tight"
        >
          Tutup sesi scan
        </h2>
        <p className="mt-1.5 text-[14px] text-ink-muted">
          Receipt dibuat untuk box yang sudah discan; box yang belum datang ditandai hilang.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-ok/25 bg-ok/8 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ok">
              <CheckCircle2 className="size-4" strokeWidth={2} aria-hidden />
              Cocok
            </div>
            <div className="tabular mt-1 text-[28px] font-extrabold leading-none">
              {cocok}
              <span className="text-[14px] font-semibold text-ink-muted">
                {' '}
                / {lines.length} line
              </span>
            </div>
          </div>
          <div
            className={cn(
              'rounded-2xl border px-4 py-3',
              totalKurang > 0 ? 'border-warn/25 bg-warn/8' : 'border-line bg-surface',
            )}
          >
            <div
              className={cn(
                'flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide',
                totalKurang > 0 ? 'text-warn' : 'text-ink-muted',
              )}
            >
              <AlertTriangle className="size-4" strokeWidth={2} aria-hidden />
              Kurang
            </div>
            <div className="tabular mt-1 text-[28px] font-extrabold leading-none">
              {totalKurang}
              <span className="text-[14px] font-semibold text-ink-muted"> box</span>
            </div>
          </div>
        </div>

        {kurang.length > 0 ? (
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
            {kurang.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{l.partNo}</span>
                  <span className="text-ink-muted"> · {l.backNo}</span>
                </span>
                <span className="tabular shrink-0 text-ink-soft">
                  {l.boxScanned} / {l.boxOrdered}
                </span>
                <span className="tabular shrink-0 font-bold text-warn">
                  −{l.boxOrdered - l.boxScanned}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {rejected > 0 ? (
          <p className="mt-3 text-[13px] text-ink-muted">
            {rejected} scan ditolak selama sesi ini (kanban picklist lain atau kode asing) — tidak
            ikut diterima.
          </p>
        ) : null}

        {totalKurang > 0 ? (
          <div className="mt-5">
            <label htmlFor="alasan-kurang" className="mb-2 block text-[14px] font-semibold">
              Alasan box kurang <span className="text-ng">*</span>
            </label>
            <textarea
              ref={reasonRef}
              id="alasan-kurang"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={255}
              rows={2}
              placeholder="Contoh: truk datang kurang 2 box, supplier konfirmasi menyusul besok"
              className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card"
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 flex items-center gap-1.5 text-[13px] text-ng">
            <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-12 rounded-full px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink disabled:opacity-50 sm:h-11"
          >
            Lanjut scan
          </button>
          <button
            type="button"
            onClick={() => void tutup()}
            disabled={busy}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 sm:h-11"
          >
            <DoorClosed className="size-4" strokeWidth={2} aria-hidden />
            {busy ? 'Menutup…' : totalKurang > 0 ? 'Tutup, ada yang kurang' : 'Tutup sesi'}
          </button>
        </div>
      </div>
    </div>
  );
}
