'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';
import { AlertCircle, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { importManualAction } from '@/app/(app)/picklist/actions';
import { Card, CardDivider, CardHeader } from '@/components/ui/card';
import { useFeedback } from '@/components/ui/feedback-provider';

export function ManualOrderImport() {
  const [state, action, pending] = useActionState(importManualAction, null);
  const result = state && !('error' in state) ? state : null;
  const feedback = useFeedback();
  const notified = useRef(false);

  useEffect(() => {
    if (!result || notified.current) return;
    notified.current = true;
    feedback.success(
      'Order Sheet berhasil diterbitkan dari Excel',
      `${result.picklistNo} · ${result.lineCount} part · ${result.kanbanCount} kanban`,
    );
  }, [result, feedback]);

  return (
    <Card className="mb-5">
      <CardHeader
        icon={FileSpreadsheet}
        title="Upload Excel"
        subtitle="Satu file menerbitkan satu Order Sheet manual; seluruh part diperiksa sebelum disimpan"
        actions={
          <a
            href="/templates/template-order-manual.xlsx"
            download
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-card px-4 text-[13px] font-semibold hover:border-line-strong"
          >
            <Download className="size-4" strokeWidth={2} aria-hidden />
            Unduh template
          </a>
        }
      />
      <CardDivider />
      <form action={action} className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center">
        <input
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="block min-w-0 flex-1 text-[14px] text-ink-soft file:mr-3 file:h-10 file:rounded-full file:border file:border-line file:bg-card file:px-4 file:text-[13px] file:font-semibold file:text-ink hover:file:border-line-strong"
        />
        <button
          type="submit"
          disabled={pending || result !== null}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-[18px] animate-spin" strokeWidth={2} aria-hidden />
          ) : (
            <Upload className="size-[18px]" strokeWidth={2.2} aria-hidden />
          )}
          {pending ? 'Memproses…' : result ? 'Berhasil diterbitkan' : 'Upload dan terbitkan'}
        </button>
      </form>
      {state && 'error' in state ? (
        <p
          role="alert"
          className="mx-6 mb-5 flex items-start gap-2 rounded-2xl border border-ng/25 bg-ng/8 px-4 py-3 text-[14px] text-ng"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          {state.error}
        </p>
      ) : null}
      {result ? (
        <div className="mx-6 mb-5 rounded-2xl border border-ok/30 bg-ok/8 px-4 py-3 text-[14px]">
          <span className="font-semibold text-ok">{result.picklistNo} berhasil diterbitkan</span>
          <span className="text-ink-muted">
            {' '}
            · {result.lineCount} part · {result.kanbanCount} kanban
          </span>
          <Link
            href={`/picklist/${result.publicId}`}
            className="ml-3 font-semibold text-ink underline"
          >
            Buka Order Sheet
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
