'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { AlertCircle, Keyboard, ScanLine } from 'lucide-react';
import { openReceiptAction } from '@/app/(app)/receiving/actions';
import { cn } from '../ui/cn';

/**
 * Buka sesi scan dengan barcode Delivery Sheet (F-34) — terbit setelah supplier
 * mengonfirmasi kirim (F-30).
 *
 * Satu input, satu tombol. Scanner keyboard-wedge mengetik lalu menekan Enter,
 * jadi submit lewat Enter harus jalan tanpa menyentuh tombol. Fokus diberikan
 * saat halaman terbuka: operator datang ke halaman ini hanya untuk menembak
 * barcode, bukan untuk mencari kotak isian.
 */
export function OpenSessionForm({ handheld = false }: { handheld?: boolean }) {
  const [state, action, pending] = useActionState(openReceiptAction, { error: null });
  const inputRef = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Kode yang ditolak dibiarkan di kotak supaya terbaca apa yang salah, tetapi
  // terpilih penuh — tembakan berikutnya langsung menimpanya.
  useEffect(() => {
    if (state.error) inputRef.current?.select();
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="kode-picklist" className="text-[14px] font-semibold">
        Barcode Delivery Sheet
      </label>
      {handheld ? (
        <button
          type="button"
          onClick={() => {
            setManual((value) => !value);
            inputRef.current?.focus();
          }}
          className="flex min-h-10 items-center gap-2 self-start text-[13px] font-semibold text-ink-muted hover:text-ink"
        >
          <Keyboard className="size-4" aria-hidden />
          {manual ? 'Kembali ke mode scanner' : 'Ketik manual'}
        </button>
      ) : null}
      <div className={handheld ? 'flex flex-col gap-3' : 'flex gap-2'}>
        <input
          ref={inputRef}
          id="kode-picklist"
          name="code"
          inputMode={handheld && !manual ? 'none' : 'text'}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="ARES:D:826092300100"
          className={cn(
            'tabular h-12 min-w-0 rounded-2xl border border-line bg-surface px-4 text-[16px] font-semibold outline-none transition-colors duration-200 placeholder:text-[14px] placeholder:font-normal placeholder:text-ink-muted focus:border-ink focus:bg-card',
            handheld ? 'shrink-0' : 'flex-1',
          )}
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ScanLine className="size-[18px]" strokeWidth={2.2} aria-hidden />
          {pending ? 'Membuka…' : 'Buka sesi'}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[13px] text-ng">
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {state.error}
        </p>
      ) : (
        <p className="text-[13px] text-ink-muted">
          Scan barcode di lembar Delivery Sheet yang dibawa supplier. Kalau sesi untuk DO itu masih
          terbuka, Anda langsung melanjutkannya.
        </p>
      )}
    </form>
  );
}
