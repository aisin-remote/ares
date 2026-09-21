'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Ban } from 'lucide-react';
import { cancelReceiptAction } from '@/app/(app)/receiving/actions';

export function CancelReceipt({ id }: { id: number }) {
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function batalkan() {
    if (!alasan.trim()) return setError('Alasan wajib diisi.');
    setSibuk(true);
    setError(null);
    const res = await cancelReceiptAction(id, alasan.trim());
    setSibuk(false);
    if ('error' in res) return setError(res.error);
    setBuka(false);
    startTransition(() => router.refresh());
  }

  if (!buka) return (
    <button type="button" onClick={() => setBuka(true)}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] font-semibold hover:border-ng hover:text-ng">
      <Ban className="size-3.5" aria-hidden /> Batalkan
    </button>
  );

  return (
    <div className="flex min-w-64 flex-col gap-1.5">
      <div className="flex gap-1.5">
        <input autoFocus value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={255}
          placeholder="Alasan" className="h-8 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[12px] outline-none focus:border-line-strong" />
        <button type="button" onClick={() => void batalkan()} disabled={sibuk || pending}
          className="h-8 rounded-full bg-ng px-3 text-[12px] font-semibold text-white disabled:opacity-50">
          {sibuk ? '…' : 'Ya'}
        </button>
        <button type="button" onClick={() => { setBuka(false); setError(null); }}
          className="h-8 rounded-full px-2 text-[12px] font-semibold text-ink-muted">Batal</button>
      </div>
      {error ? <p role="alert" className="flex items-center gap-1 text-[12px] text-ng">
        <AlertCircle className="size-3" aria-hidden />{error}</p> : null}
    </div>
  );
}
