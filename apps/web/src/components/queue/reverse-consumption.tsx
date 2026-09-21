'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reverseConsumptionAction } from '@/app/(app)/queue/actions';

export function ReverseConsumption({ id }: { id: number }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const submit = () => startTransition(async () => {
    setError(undefined);
    if (reason.trim().length < 3) return setError('Alasan minimal 3 karakter.');
    const result = await reverseConsumptionAction(id, reason.trim());
    if ('error' in result) return setError(result.error);
    router.refresh();
  });
  return <details>
    <summary className="cursor-pointer list-none whitespace-nowrap rounded-full border border-ng/30 px-3 py-1.5 text-xs font-semibold text-ng hover:border-ng">Batalkan</summary>
    <div className="mt-2 grid min-w-56 gap-2 rounded-xl border border-line bg-surface p-3">
      <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} placeholder="Alasan pembatalan" className="h-9 rounded-lg border border-line bg-card px-3 text-xs outline-none focus:border-line-strong" />
      <button type="button" onClick={submit} disabled={pending} className="h-8 rounded-full bg-ng px-3 text-xs font-semibold text-white disabled:opacity-50">{pending ? 'Membalik…' : 'Balik seluruh record'}</button>
      {error ? <p className="text-xs text-ng" role="alert">{error}</p> : null}
    </div>
  </details>;
}
