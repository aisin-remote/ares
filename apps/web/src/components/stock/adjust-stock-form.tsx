'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, SlidersHorizontal } from 'lucide-react';
import { adjustStockAction } from '@/app/(app)/stock/actions';

const INPUT =
  'h-11 rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

/**
 * Penyesuaian stok manual (F-42). Selisih boleh negatif; alasan wajib —
 * baris ADJUST tanpa alasan tidak bisa dipertanggungjawabkan saat stok
 * dibandingkan dengan SAP (F-43). Hak `stock.adjust` diperiksa server.
 */
export function AdjustStockForm({ partId, uom }: { partId: number; uom: string }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function simpan() {
    setError(null);
    const n = Number(delta);
    if (!Number.isInteger(n) || n === 0) {
      setError('Selisih harus bilangan bulat selain 0 (mis. 12 atau -5).');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Alasan wajib diisi.');
      return;
    }
    setSibuk(true);
    const res = await adjustStockAction({ partId, deltaPcs: n, reason: reason.trim() });
    setSibuk(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setDelta('');
    setReason('');
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-4 px-6 py-5 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-end">
      <div>
        <label htmlFor="delta" className="mb-2 block text-[14px] font-semibold">
          Selisih ({uom})
        </label>
        <input
          id="delta"
          type="number"
          inputMode="numeric"
          step={1}
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="+12 / -5"
          className={`${INPUT} tabular w-full`}
        />
      </div>
      <div>
        <label htmlFor="alasan" className="mb-2 block text-[14px] font-semibold">
          Alasan <span className="text-ng">*</span>
        </label>
        <input
          id="alasan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={255}
          placeholder="Hasil stock opname 21 Sep, box rusak, dsb."
          className={`${INPUT} w-full`}
        />
      </div>
      <button
        type="button"
        onClick={() => void simpan()}
        disabled={sibuk || pending}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        <SlidersHorizontal className="size-[18px]" strokeWidth={2.2} aria-hidden />
        {sibuk ? 'Menyimpan…' : 'Sesuaikan'}
      </button>
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[13px] text-ng sm:col-span-3">
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
