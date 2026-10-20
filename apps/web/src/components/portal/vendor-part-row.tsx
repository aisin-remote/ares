'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, Pencil, X } from 'lucide-react';
import { updateVendorPartAction } from '@/app/(portal)/portal/actions';
import type { VendorPartRow as Row } from '@/lib/queries';
import { Td, Tr } from '../ui/table';
import { useFeedback } from '../ui/feedback-provider';
import { durations, easeSoft, springSoft } from '../motion/transitions';

const INPUT =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

/** Baris vendor part; penyuntingan dibuka di drawer agar tabel tetap mudah dipindai. */
export function VendorPartRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [backNo, setBackNo] = useState(row.backNo);
  const [rack, setRack] = useState(row.rack ?? '');
  const [boxType, setBoxType] = useState(row.boxType ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pending, startTransition] = useTransition();
  const titleId = useId();
  const backNoRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const feedback = useFeedback();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    backNoRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sibuk) tutup();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sibuk]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function buka() {
    setBackNo(row.backNo);
    setRack(row.rack ?? '');
    setBoxType(row.boxType ?? '');
    setError(null);
    setOpen(true);
  }

  function tutup() {
    if (sibuk) return;
    setError(null);
    setOpen(false);
  }

  async function simpan() {
    setError(null);
    if (!backNo.trim()) {
      setError('Back number wajib diisi.');
      backNoRef.current?.focus();
      return;
    }
    setSibuk(true);
    const res = await updateVendorPartAction(row.id, { backNo, rack, boxType });
    setSibuk(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setOpen(false);
    feedback.success(
      'Data kemasan berhasil diperbarui',
      `${row.partNo} siap dipakai pada kanban berikutnya.`,
    );
    startTransition(() => router.refresh());
  }

  const drawer = (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.button
            type="button"
            aria-label="Tutup drawer"
            onClick={tutup}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]"
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={springSoft}
            className="relative flex h-full w-full max-w-[480px] flex-col bg-shell shadow-shell"
          >
            <header className="flex items-start gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-[19px] font-bold tracking-tight">
                  Ubah kemasan & lokasi
                </h2>
                <p className="mt-1 text-[13px] text-ink-muted">
                  {row.partNo} · {row.partName}
                </p>
              </div>
              <button
                type="button"
                onClick={tutup}
                disabled={sibuk}
                aria-label="Tutup"
                className="grid size-9 shrink-0 place-items-center rounded-full border border-line transition-colors hover:bg-surface disabled:opacity-50"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
              </button>
            </header>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void simpan();
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-6 py-6">
                <div className="rounded-2xl border border-line bg-surface px-4 py-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                    Qty per box
                  </p>
                  <p className="mt-1 font-semibold tabular text-ink">
                    {row.qtyPerBox} {row.uom}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-ink-muted">
                    Nilai ini diatur PPIC dan tidak dapat diubah oleh supplier.
                  </p>
                </div>

                <div>
                  <label htmlFor={`${titleId}-back-no`} className="mb-2 block text-[14px] font-semibold">
                    Back number <span className="text-ng">*</span>
                  </label>
                  <input
                    ref={backNoRef}
                    id={`${titleId}-back-no`}
                    value={backNo}
                    onChange={(event) => setBackNo(event.target.value)}
                    maxLength={32}
                    required
                    className={INPUT}
                  />
                </div>

                <div>
                  <label htmlFor={`${titleId}-rack`} className="mb-2 block text-[14px] font-semibold">
                    Rak
                  </label>
                  <input
                    id={`${titleId}-rack`}
                    value={rack}
                    onChange={(event) => setRack(event.target.value)}
                    maxLength={32}
                    placeholder="Contoh: R-01-A"
                    className={INPUT}
                  />
                </div>

                <div>
                  <label htmlFor={`${titleId}-box-type`} className="mb-2 block text-[14px] font-semibold">
                    Tipe box
                  </label>
                  <input
                    id={`${titleId}-box-type`}
                    value={boxType}
                    onChange={(event) => setBoxType(event.target.value)}
                    maxLength={32}
                    placeholder="Contoh: BOX_PLASTIK_L"
                    className={INPUT}
                  />
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-2xl border border-ng/25 bg-ng/8 px-4 py-3 text-[14px] text-ng"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
                    {error}
                  </p>
                ) : null}
              </div>

              <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
                <button
                  type="button"
                  onClick={tutup}
                  disabled={sibuk}
                  className="h-11 rounded-full px-5 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
                >
                  Batal
                </button>
                <motion.button
                  type="submit"
                  disabled={sibuk || pending}
                  whileTap={sibuk || pending ? undefined : { scale: 0.97 }}
                  transition={{ duration: durations.fast, ease: easeSoft }}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-60"
                >
                  <Check className="size-4" strokeWidth={2.4} aria-hidden />
                  {sibuk ? 'Menyimpan…' : 'Simpan'}
                </motion.button>
              </footer>
            </form>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <>
      <Tr>
        <Td strong className="whitespace-nowrap">
          <span className="tabular">{row.partNo}</span>
          <span className="ml-2 font-normal text-ink-muted">{row.partName}</span>
        </Td>
        <Td align="right" className="tabular">
          {row.qtyPerBox} {row.uom}
        </Td>
        <Td className="tabular">
          <span className="font-semibold text-ink">{row.backNo}</span>
        </Td>
        <Td className="tabular">{row.rack ?? <span className="text-ink-muted">—</span>}</Td>
        <Td className="tabular">
          {row.boxType ?? <span className="text-ink-muted">—</span>}
        </Td>
        <Td align="right">
          <button
            type="button"
            onClick={buka}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-4 text-[13px] font-semibold transition-colors hover:border-ink"
          >
            <Pencil className="size-4" strokeWidth={2} aria-hidden />
            Ubah
          </button>
        </Td>
      </Tr>
      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
}
