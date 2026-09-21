'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adjustQueueAction, setQueueHoldAction } from '@/app/(app)/queue/actions';

const INPUT = 'h-9 rounded-lg border border-line bg-card px-3 text-[13px] outline-none focus:border-line-strong';

export function QueueControls({ id, hold }: { id: number; hold: boolean }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const validateReason = () => {
    if (reason.trim().length < 3) {
      setError('Alasan minimal 3 karakter.');
      return false;
    }
    return true;
  };
  const adjust = () => startTransition(async () => {
    setError(undefined);
    const n = Number(delta);
    if (!Number.isInteger(n) || n === 0) return setError('Selisih harus bilangan bulat selain nol.');
    if (!validateReason()) return;
    const result = await adjustQueueAction(id, { deltaPcs: n, reason: reason.trim() });
    if ('error' in result) return setError(result.error);
    setDelta(''); setReason(''); router.refresh();
  });
  const toggleHold = () => startTransition(async () => {
    setError(undefined);
    if (!validateReason()) return;
    const result = await setQueueHoldAction(id, { hold: !hold, reason: reason.trim() });
    if ('error' in result) return setError(result.error);
    setReason(''); router.refresh();
  });

  return <details className="relative">
    <summary className="cursor-pointer list-none rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-ink">Atur</summary>
    <div className="mt-2 grid min-w-64 gap-2 rounded-xl border border-line bg-surface p-3">
      <input className={INPUT} type="number" step="1" value={delta} onChange={(event) => setDelta(event.target.value)} placeholder="Selisih pcs, contoh -20" />
      <input className={INPUT} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} placeholder="Alasan wajib" />
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={adjust} className="h-8 rounded-full bg-accent px-3 text-xs font-semibold text-white disabled:opacity-50">Koreksi PCS</button>
        <button type="button" disabled={pending} onClick={toggleHold} className="h-8 rounded-full border border-line px-3 text-xs font-semibold disabled:opacity-50">{hold ? 'Lepas hold' : 'Hold'}</button>
      </div>
      {error ? <p className="text-xs text-ng" role="alert">{error}</p> : null}
    </div>
  </details>;
}
