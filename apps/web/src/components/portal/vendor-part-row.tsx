'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Pencil, X } from 'lucide-react';
import { updateVendorPartAction } from '@/app/(portal)/portal/actions';
import type { VendorPartRow as Row } from '@/lib/queries';
import { Td, Tr } from '../ui/table';
import { cn } from '../ui/cn';
import { useFeedback } from '../ui/feedback-provider';

const INPUT =
  'h-10 w-full rounded-2xl border border-line bg-surface px-3 text-[14px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

/**
 * Satu baris vendor part dengan penyuntingan di tempat.
 *
 * Supplier hanya boleh mengubah atribut kemasan — back number, rak, tipe box —
 * karena itulah yang dicetak di kanban dan memang mereka yang tahu. Qty per
 * box tetap milik PPIC: angka itu menentukan konversi pcs→box dan jumlah order
 * (6.1), jadi ditampilkan tetapi tidak bisa disunting di sini.
 */
export function VendorPartRow({ row }: { row: Row }) {
  const [edit, setEdit] = useState(false);
  const [backNo, setBackNo] = useState(row.backNo);
  const [rack, setRack] = useState(row.rack ?? '');
  const [boxType, setBoxType] = useState(row.boxType ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const feedback = useFeedback();

  function batal() {
    setBackNo(row.backNo);
    setRack(row.rack ?? '');
    setBoxType(row.boxType ?? '');
    setError(null);
    setEdit(false);
  }

  async function simpan() {
    setError(null);
    if (!backNo.trim()) {
      setError('Back number wajib diisi.');
      return;
    }
    setSibuk(true);
    const res = await updateVendorPartAction(row.id, { backNo, rack, boxType });
    setSibuk(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setEdit(false);
    feedback.success(
      'Data kemasan berhasil diperbarui',
      `${row.partNo} siap dipakai pada kanban berikutnya.`,
    );
    startTransition(() => router.refresh());
  }

  return (
    <Tr>
      <Td strong className="whitespace-nowrap">
        <span className="tabular">{row.partNo}</span>
        <span className="ml-2 font-normal text-ink-muted">{row.partName}</span>
      </Td>
      <Td align="right" className="tabular">
        {row.qtyPerBox} {row.uom}
      </Td>
      <Td className={cn('tabular', edit && 'w-40')}>
        {edit ? (
          <input
            value={backNo}
            onChange={(e) => setBackNo(e.target.value)}
            maxLength={32}
            aria-label={`Back number ${row.partNo}`}
            className={INPUT}
          />
        ) : (
          <span className="font-semibold text-ink">{row.backNo}</span>
        )}
      </Td>
      <Td className={cn('tabular', edit && 'w-36')}>
        {edit ? (
          <input
            value={rack}
            onChange={(e) => setRack(e.target.value)}
            maxLength={32}
            placeholder="—"
            aria-label={`Rak ${row.partNo}`}
            className={INPUT}
          />
        ) : (
          (row.rack ?? <span className="text-ink-muted">—</span>)
        )}
      </Td>
      <Td className={cn('tabular', edit && 'w-36')}>
        {edit ? (
          <input
            value={boxType}
            onChange={(e) => setBoxType(e.target.value)}
            maxLength={32}
            placeholder="—"
            aria-label={`Tipe box ${row.partNo}`}
            className={INPUT}
          />
        ) : (
          (row.boxType ?? <span className="text-ink-muted">—</span>)
        )}
      </Td>
      <Td align="right">
        {edit ? (
          <span className="inline-flex items-center gap-2">
            {error ? (
              <span role="alert" className="flex items-center gap-1 text-[13px] text-ng">
                <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                {error}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void simpan()}
              disabled={sibuk || pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
            >
              <Check className="size-4" strokeWidth={2.2} aria-hidden />
              {sibuk ? 'Menyimpan…' : 'Simpan'}
            </button>
            <button
              type="button"
              onClick={batal}
              disabled={sibuk}
              aria-label="Batalkan perubahan"
              className="inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <X className="size-4" strokeWidth={2} aria-hidden />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEdit(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-4 text-[13px] font-semibold transition-colors hover:border-ink"
          >
            <Pencil className="size-4" strokeWidth={2} aria-hidden />
            Ubah
          </button>
        )}
      </Td>
    </Tr>
  );
}
