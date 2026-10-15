'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Ban, Loader2 } from 'lucide-react';
import { cancelPicklistAction } from '@/app/(app)/picklist/actions';
import { useFeedback } from '@/components/ui/feedback-provider';

/**
 * Pembatalan picklist (F-20).
 *
 * Alasan diketik langsung di sebelah tombol, bukan di dialog terpisah:
 * pembatalan selalu ditanyakan ulang oleh supplier, dan alasan yang diketik
 * sambil lalu di kotak modal biasanya kosong atau "salah input".
 *
 * Tombolnya tampil untuk semua peran. Hak `picklist.cancel` diperiksa server
 * (aturan repo 10) dan sesi di layar belum membawa daftar izin, jadi menebak
 * di sini hanya akan salah.
 */
export function CancelPicklist({ id }: { id: string }) {
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const feedback = useFeedback();

  async function batalkan() {
    const teks = alasan.trim();
    if (!teks) {
      setError('Alasan wajib diisi.');
      return;
    }
    setSibuk(true);
    setError(null);
    const res = await cancelPicklistAction(id, teks);
    setSibuk(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setBuka(false);
    setAlasan('');
    feedback.success('Order Sheet dibatalkan', `${res.kanbanCount} kanban ikut dinonaktifkan.`);
    startTransition(() => router.refresh());
  }

  if (!buka) {
    return (
      <button
        type="button"
        onClick={() => setBuka(true)}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-line px-4 text-[13px] font-semibold transition-colors hover:border-ng hover:text-ng"
      >
        <Ban className="size-4" strokeWidth={2} aria-hidden />
        Batalkan
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          maxLength={255}
          placeholder="Alasan pembatalan"
          className="h-9 w-56 rounded-2xl border border-line bg-surface px-4 text-[14px] outline-none transition-colors focus:border-line-strong focus:bg-card"
        />
        <button
          type="button"
          onClick={() => void batalkan()}
          disabled={sibuk || pending}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-ng px-4 text-[13px] font-semibold text-white transition-opacity disabled:opacity-50"
        >
          {sibuk ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {sibuk ? 'Membatalkan…' : 'Ya, batalkan'}
        </button>
        <button
          type="button"
          onClick={() => {
            setBuka(false);
            setError(null);
          }}
          className="h-9 rounded-full px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink"
        >
          Batal
        </button>
      </div>
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[13px] text-ng">
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
