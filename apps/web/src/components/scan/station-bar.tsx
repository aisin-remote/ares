'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, DoorClosed } from 'lucide-react';

/**
 * Bilah atas layar stasiun receiving (PRD §10.4).
 *
 * Disalin dari Avicenna, lalu disusun untuk layar handheld dulu: satu baris
 * [kembali] nomor picklist [tutup sesi], di bawahnya supplier dan jam datang.
 * Jam, tanggal, dan nama operator baru muncul mulai `md` — di scanner 6 inci
 * ruang itu lebih berguna untuk hasil scan; di monitor gudang, jam dipakai
 * menandai pergantian shift.
 */
export function StationBar({
  picklistNo,
  revision,
  vendorName,
  arrivalTime,
  receiptNo,
  userName,
  npk,
  onClose,
  closeDisabled,
}: {
  picklistNo: string;
  revision: number;
  vendorName: string;
  /** HH:MM jam pabrik. */
  arrivalTime: string;
  receiptNo: string;
  userName: string;
  npk: string;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Dimulai setelah render agar tidak ada beda jam antara server dan browser.
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="shrink-0 border-b border-line bg-shell px-3 py-2.5 sm:px-6 sm:py-4">
      <div className="flex items-center gap-2 sm:gap-4">
        <Link
          href="/receiving"
          aria-label="Kembali ke daftar sesi"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-card transition-colors hover:border-line-strong hover:bg-surface"
        >
          <ArrowLeft className="size-5" strokeWidth={1.9} aria-hidden />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 sm:gap-3">
            <span className="tabular truncate text-[20px] font-extrabold leading-none tracking-tight sm:text-[26px]">
              {picklistNo}
              {revision > 0 ? (
                <span className="text-[14px] font-semibold text-ink-muted sm:text-[16px]">
                  {' '}
                  rev {revision}
                </span>
              ) : null}
            </span>
            <span className="hidden shrink-0 rounded-full border border-line px-3 py-1 text-[12px] font-semibold sm:inline">
              Jam datang {arrivalTime}
            </span>
          </div>
          <div className="mt-1 truncate text-[13px] text-ink-muted">
            {vendorName} · datang {arrivalTime} · <span className="tabular">{receiptNo}</span>
          </div>
        </div>

        <div className="hidden items-center gap-6 md:flex">
          <div className="text-right">
            <div className="tabular text-[26px] font-bold leading-none">
              {now ? now.toLocaleTimeString('id-ID', { hour12: false }) : '--:--:--'}
            </div>
            <div className="mt-1 text-[12px] text-ink-muted">
              {now
                ? now.toLocaleDateString('id-ID', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : ''}
            </div>
          </div>

          <div className="h-10 w-px bg-line" aria-hidden />

          <div className="text-right">
            <div className="text-[14px] font-bold leading-tight">{userName}</div>
            <div className="tabular text-[12px] text-ink-muted">NPK {npk}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
        >
          <DoorClosed className="size-4" strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">Tutup sesi</span>
          <span className="sm:hidden">Tutup</span>
        </button>
      </div>
    </header>
  );
}
