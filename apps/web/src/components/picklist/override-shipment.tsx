'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, PencilLine } from 'lucide-react';
import { overrideShipmentAction } from '@/app/(app)/picklist/actions';
import { Card, CardBody, CardDivider, CardHeader } from '@/components/ui/card';
import { useFeedback } from '@/components/ui/feedback-provider';

interface Line {
  id: number;
  partNo: string;
  backNo: string;
  boxOrdered: number;
  boxShipped: number | null;
}

export function OverrideShipment({ id, lines }: { id: string; lines: Line[] }) {
  const [values, setValues] = useState<Record<number, number>>(
    Object.fromEntries(lines.map((line) => [line.id, line.boxShipped ?? line.boxOrdered])),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const feedback = useFeedback();

  async function submit() {
    if (!reason.trim()) return setError('Alasan koreksi wajib diisi.');
    setError(null);
    setBusy(true);
    const result = await overrideShipmentAction(id, {
      reason: reason.trim(),
      lines: lines.map((line) => ({
        picklistLineId: line.id,
        boxShipped: values[line.id] ?? 0,
      })),
    });
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      feedback.error('Koreksi jumlah kirim gagal', result.error);
      return;
    }
    setReason('');
    feedback.success(
      'Jumlah kirim berhasil dikoreksi',
      'Perubahan dan alasannya sudah dicatat di audit.',
    );
    startTransition(() => router.refresh());
  }

  return (
    <Card className="mt-5">
      <CardHeader
        icon={PencilLine}
        title="Koreksi jumlah kirim"
        subtitle="PPIC dapat mengoreksi box terkirim sebelum sesi scan dibuka"
      />
      <CardDivider />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lines.map((line) => (
            <label key={line.id} className="rounded-2xl border border-line bg-surface p-4">
              <span className="block text-[13px] font-semibold text-ink">{line.partNo}</span>
              <span className="block text-[12px] text-ink-muted">
                Back no. {line.backNo} · order {line.boxOrdered} box
              </span>
              <input
                type="number"
                min={0}
                max={line.boxOrdered}
                step={1}
                value={values[line.id] ?? 0}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [line.id]: Number(event.target.value),
                  }))
                }
                className="mt-3 h-10 w-full rounded-xl border border-line bg-card px-3 text-right font-semibold tabular outline-none focus:border-line-strong"
              />
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-3 lg:flex-row">
          <input
            value={reason}
            maxLength={255}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Alasan koreksi (wajib)"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-[14px] outline-none focus:border-line-strong"
          />
          <button
            type="button"
            disabled={busy || pending}
            onClick={() => void submit()}
            className="h-11 rounded-full bg-accent px-5 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {busy || pending ? (
              <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden />
            ) : null}
            {busy || pending ? 'Menyimpan…' : 'Simpan koreksi'}
          </button>
        </div>
        {error ? (
          <p role="alert" className="flex items-center gap-1.5 text-[13px] text-ng">
            <AlertCircle className="size-4" aria-hidden />
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
