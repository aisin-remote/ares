'use client';

import { useState, useTransition } from 'react';
import { Play } from 'lucide-react';
import { runCutoffAction } from '@/app/(app)/queue/actions';
import { Button } from '@/components/ui/button';
import { useFeedback } from '@/components/ui/feedback-provider';

export function RunCutoffButton() {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string>();
  const feedback = useFeedback();

  const run = () =>
    startTransition(async () => {
      const result = await runCutoffAction();
      setNotice(result.error ?? result.ok);
      if (result.error) feedback.error('Cutoff gagal dijalankan', result.error);
      else feedback.success('Cutoff masuk antrean kerja', result.ok);
    });

  return (
    <div className="flex items-center gap-3">
      {notice ? (
        <span
          className="hidden max-w-56 text-right text-[12px] leading-4 text-ink-muted xl:block"
          role="status"
        >
          {notice}
        </span>
      ) : null}
      <Button icon={Play} size="sm" onClick={run} disabled={pending}>
        {pending ? 'Mengantrekan…' : 'Jalankan cutoff'}
      </Button>
    </div>
  );
}
