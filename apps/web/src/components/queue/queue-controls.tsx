'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adjustQueueAction, setQueueHoldAction } from '@/app/(app)/queue/actions';
import { useFeedback } from '@/components/ui/feedback-provider';

const INPUT =
  'h-9 rounded-lg border border-line bg-card px-3 text-[13px] outline-none focus:border-line-strong';

export function QueueControls({ id, hold }: { id: number; hold: boolean }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const feedback = useFeedback();

  const validateReason = () => {
    if (reason.trim().length < 3) {
      setError('Alasan minimal 3 karakter.');
      return false;
    }
    return true;
  };
  const adjust = () =>
    startTransition(async () => {
      setError(undefined);
      const n = Number(delta);
      if (!Number.isInteger(n) || n === 0)
        return setError('Selisih harus bilangan bulat selain nol.');
      if (!validateReason()) return;
      const result = await adjustQueueAction(id, { deltaPcs: n, reason: reason.trim() });
      if ('error' in result) return setError(result.error);
      setDelta('');
      setReason('');
      feedback.success('Antrean berhasil dikoreksi', `${n > 0 ? '+' : ''}${n} pcs diterapkan.`);
      router.refresh();
    });
  const toggleHold = () =>
    startTransition(async () => {
      setError(undefined);
      if (!validateReason()) return;
      const result = await setQueueHoldAction(id, { hold: !hold, reason: reason.trim() });
      if ('error' in result) return setError(result.error);
      setReason('');
      feedback.success(hold ? 'Hold antrean dilepas' : 'Antrean berhasil ditahan');
      router.refresh();
    });

  return (
    <details className="group relative">
      {/*
       * Label ikut keadaan panel: tertutup "Atur", terbuka "Batal". Tanpa itu
       * tombolnya tetap berbunyi "Atur" saat panel sudah terbuka dan tidak ada
       * yang memberi tahu cara menutupnya lagi.
       *
       * Dikerjakan varian `open:` milik <details>, bukan state React — tidak
       * ada yang perlu diingat, jadi tidak perlu JavaScript.
       */}
      <summary className="cursor-pointer list-none rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-ink group-open:border-ink-muted group-open:text-ink-muted">
        <span className="group-open:hidden">Atur</span>
        <span className="hidden group-open:inline">Batal</span>
      </summary>
      <div className="mt-2 grid min-w-64 gap-2 rounded-xl border border-line bg-surface p-3">
        <input
          className={INPUT}
          type="number"
          step="1"
          value={delta}
          onChange={(event) => setDelta(event.target.value)}
          placeholder="Selisih pcs, contoh -20"
        />
        <input
          className={INPUT}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={255}
          placeholder="Alasan wajib"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={adjust}
            className="h-8 rounded-full bg-accent px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            Koreksi PCS
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={toggleHold}
            className="h-8 rounded-full border border-line px-3 text-xs font-semibold disabled:opacity-50"
          >
            {hold ? 'Lepas hold' : 'Hold'}
          </button>
        </div>
        {error ? (
          <p className="text-xs text-ng" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
