'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { addFakeMesAction, syncMesAction } from '@/app/(app)/mes/actions';

const input = 'h-10 rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-line-strong';

export function MesActions({ fake }: { fake: boolean }) {
  const [state, formAction, pendingForm] = useActionState(addFakeMesAction, {});
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string>();
  const router = useRouter();
  const sync = () => start(async () => {
    const result = await syncMesAction();
    setNotice(result.error ?? result.ok);
    router.refresh();
  });
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={sync} disabled={pending} className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50">
        <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} aria-hidden />{pending ? 'Mengantrekan…' : 'Tarik sekarang'}
      </button>
      {notice ? <p className="text-sm text-ink-muted" role="status">{notice}</p> : null}
    </div>
    {fake ? <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <input className={input} name="id" placeholder="ID record MES" required />
      <input className={input} name="partNo" placeholder="Nomor part jadi" required />
      <input className={input} name="qty" type="number" min="1" placeholder="Qty produksi" required />
      <input className={input} name="line" placeholder="Line" required />
      <input className={input} name="producedAt" type="datetime-local" required />
      <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-3">
        <button disabled={pendingForm} className="h-10 rounded-full border border-line px-4 text-sm font-semibold hover:border-ink disabled:opacity-50">Tambah record uji</button>
        {state.ok || state.error ? <p className={`text-sm ${state.error ? 'text-ng' : 'text-ok'}`} role="status">{state.error ?? state.ok}</p> : null}
      </div>
    </form> : null}
  </div>;
}
