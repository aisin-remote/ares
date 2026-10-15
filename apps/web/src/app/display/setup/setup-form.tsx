'use client';

import { useActionState } from 'react';
import { AlertCircle, ArrowRight, Monitor } from 'lucide-react';
import { BrandMark } from '@/components/shell/brand-mark';
import { displaySetupAction, type DisplaySetupState } from './actions';

const initialState: DisplaySetupState = {};

export function DisplaySetupForm() {
  const [state, action, pending] = useActionState(displaySetupAction, initialState);

  return <main className="grid min-h-screen place-items-center p-5">
    <section className="w-full max-w-[440px] rounded-panel border border-line bg-shell p-8 shadow-shell sm:p-10">
      <BrandMark tagline="Mode Monitor Receiving" />
      <div className="mt-8 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface">
        <Monitor className="size-5 text-ink-soft" aria-hidden />
      </div>
      <h1 className="mt-5 text-[24px] font-extrabold tracking-tight">Hubungkan monitor</h1>
      <p className="mt-2 text-[14px] leading-6 text-ink-muted">
        Masukkan kode dan token perangkat sekali saja. Layar akan tetap aktif dan memperbarui jadwal otomatis.
      </p>

      <form action={action} className="mt-8 space-y-4">
        <label className="block text-[13px] font-semibold">
          Kode perangkat
          <input name="deviceCode" autoFocus autoComplete="username" required
            placeholder="Contoh: RECEIVING-TV-01"
            className="mt-2 h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[14px] outline-none focus:border-line-strong focus:bg-card" />
        </label>
        <label className="block text-[13px] font-semibold">
          Token perangkat
          <input name="token" type="password" autoComplete="current-password" required
            className="mt-2 h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[14px] outline-none focus:border-line-strong focus:bg-card" />
        </label>
        {state.error ? <p role="alert" className="flex items-center gap-2 text-[13px] text-ng">
          <AlertCircle className="size-4 shrink-0" aria-hidden />{state.error}
        </p> : null}
        <button type="submit" disabled={pending}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[14px] font-semibold text-white hover:bg-accent-soft disabled:opacity-60">
          {pending ? 'Menghubungkan…' : <>Hubungkan monitor <ArrowRight className="size-4" aria-hidden /></>}
        </button>
      </form>
    </section>
  </main>;
}
