'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Send } from 'lucide-react';
import { resendOrderEmailAction } from '@/app/(app)/picklist/actions';
import { Button } from '@/components/ui/button';
import { useFeedback } from '@/components/ui/feedback-provider';

export function ResendOrderEmail({ reference, blocked, first }: { reference: string; blocked: string | null; first: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const feedback = useFeedback();

  function send() {
    startTransition(async () => {
      const result = await resendOrderEmailAction(reference);
      if ('error' in result) { setError(result.error); router.refresh(); return; }
      setConfirm(false);
      setError(null);
      feedback.success('Email sedang dikirim', 'Perbarui status sebentar lagi untuk melihat hasilnya.');
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" icon={RefreshCw} onClick={() => router.refresh()} disabled={pending}>Perbarui status</Button>
        {!confirm ? (
          <Button variant="outline" size="sm" icon={Send} disabled={pending || !!blocked} onClick={() => setConfirm(true)}>
            {first ? 'Kirim pemberitahuan' : 'Kirim ulang email'}
          </Button>
        ) : null}
      </div>
      {confirm ? (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[13px] text-ink-soft">Kirim pemberitahuan order ke akun supplier yang aktif?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon={Send} disabled={pending || !!blocked} onClick={send}>{pending ? 'Memproses…' : 'Ya, kirim email'}</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>Batal</Button>
          </div>
        </div>
      ) : null}
      {blocked ? <p className="text-[12px] text-ink-muted">{blocked}</p> : null}
      {error ? <p role="alert" className="text-[13px] text-ng">{error}</p> : null}
    </div>
  );
}
