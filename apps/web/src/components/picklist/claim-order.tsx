'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, PackageCheck, PackageX } from 'lucide-react';
import { createClaimAction, receiveClaimAction } from '@/app/(app)/picklist/actions';
import { Card, CardBody, CardDivider, CardHeader } from '@/components/ui/card';
import { useFeedback } from '@/components/ui/feedback-provider';

interface Line {
  id: number;
  partNo: string;
  backNo: string;
  qtyPerBox: number;
  boxOrdered: number;
  boxReceived: number;
}

/**
 * Order Sheet claim dibuat PPIC setelah barang diterima dan ada yang rusak.
 * Qty-nya dalam satuan kanban (box), sama seperti order lain.
 */
export function CreateClaim({ reference, lines }: { reference: string; lines: Line[] }) {
  const terima = lines.filter((line) => line.boxReceived > 0);
  const [values, setValues] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const router = useRouter();
  const { error, busy, run } = useKirim();
  const feedback = useFeedback();

  if (terima.length === 0) return null;

  return (
    <Card className="mt-5">
      <CardHeader
        icon={PackageX}
        title="Order claim barang rusak"
        subtitle="Barang rusak dikembalikan ke supplier; penggantinya datang sebagai order claim tanpa scan"
      />
      <CardDivider />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {terima.map((line) => (
            <label key={line.id} className="rounded-2xl border border-line bg-surface p-4">
              <span className="block text-[13px] font-semibold text-ink">{line.partNo}</span>
              <span className="block text-[12px] text-ink-muted">
                Back no. {line.backNo} · diterima {line.boxReceived} box ({line.qtyPerBox}
                /box)
              </span>
              <input
                type="number"
                min={0}
                max={line.boxReceived}
                step={1}
                value={values[line.id] ?? 0}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [line.id]: Number(event.target.value) }))
                }
                className="mt-3 h-10 w-full rounded-xl border border-line bg-card px-3 text-right font-semibold tabular outline-none focus:border-line-strong"
              />
              <span className="mt-1 block text-right text-[11px] text-ink-muted">box rusak</span>
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-3 lg:flex-row">
          <input
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Alasan claim (wajib), mis. karat atau penyok"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-[14px] outline-none focus:border-line-strong"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (reason.trim().length < 3) return 'Alasan claim wajib diisi.';
                const result = await createClaimAction(reference, {
                  reason: reason.trim(),
                  lines: terima.map((line) => ({
                    picklistLineId: line.id,
                    damagedBox: values[line.id] ?? 0,
                  })),
                });
                if ('error' in result) {
                  feedback.error('Order claim gagal dibuat', result.error);
                  return result.error;
                }
                setValues({});
                setReason('');
                feedback.success('Order claim dibuat', `Nomor ${result.picklistNo}`);
                router.push(`/picklist/${result.publicId}`);
                return null;
              })
            }
            className="h-11 rounded-full bg-accent px-5 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden /> : null}
            {busy ? 'Membuat…' : 'Buat order claim'}
          </button>
        </div>
        <Galat message={error} />
      </CardBody>
    </Card>
  );
}

/** Barang pengganti dicatat qty-nya; order asalnya sudah ter-GR, jadi tanpa scan dan tanpa SAP. */
export function ReceiveClaim({
  picklistId,
  reference,
  lines,
}: {
  picklistId: number;
  reference: string;
  lines: Line[];
}) {
  const sisa = (line: Line) => line.boxOrdered - line.boxReceived;
  const [values, setValues] = useState<Record<number, number>>(
    Object.fromEntries(lines.map((line) => [line.id, sisa(line)])),
  );
  const router = useRouter();
  const { error, busy, run } = useKirim();
  const feedback = useFeedback();

  if (lines.every((line) => sisa(line) <= 0)) return null;

  return (
    <Card className="mt-5">
      <CardHeader
        icon={PackageCheck}
        title="Terima barang claim"
        subtitle="Tanpa scan kanban — order asalnya sudah diterima penuh dan GR-nya sudah masuk SAP"
      />
      <CardDivider />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lines.map((line) => (
            <label key={line.id} className="rounded-2xl border border-line bg-surface p-4">
              <span className="block text-[13px] font-semibold text-ink">{line.partNo}</span>
              <span className="block text-[12px] text-ink-muted">
                Claim {line.boxOrdered} box · sisa {sisa(line)} box
              </span>
              <input
                type="number"
                min={0}
                max={sisa(line)}
                step={1}
                value={values[line.id] ?? 0}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [line.id]: Number(event.target.value) }))
                }
                className="mt-3 h-10 w-full rounded-xl border border-line bg-card px-3 text-right font-semibold tabular outline-none focus:border-line-strong"
              />
              <span className="mt-1 block text-right text-[11px] text-ink-muted">box diterima</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await receiveClaimAction(picklistId, reference, {
                lines: lines.map((line) => ({
                  picklistLineId: line.id,
                  boxReceived: values[line.id] ?? 0,
                })),
              });
              if ('error' in result) {
                feedback.error('Penerimaan claim gagal', result.error);
                return result.error;
              }
              feedback.success(
                'Barang claim diterima',
                `${result.receiptNo}${result.complete ? ' — claim selesai' : ' — masih ada sisa'}`,
              );
              router.refresh();
              return null;
            })
          }
          className="h-11 rounded-full bg-accent px-5 text-[14px] font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Menyimpan…' : 'Catat penerimaan'}
        </button>
        <Galat message={error} />
      </CardBody>
    </Card>
  );
}

function Galat({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="flex items-center gap-1.5 text-[13px] text-ng">
      <AlertCircle className="size-4" aria-hidden />
      {message}
    </p>
  ) : null;
}

/** Status tombol yang sama untuk kedua form; `kirim` mengembalikan pesan galat atau null. */
function useKirim() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function run(kirim: () => Promise<string | null>) {
    setError(null);
    setBusy(true);
    const pesan = await kirim();
    setBusy(false);
    setError(pesan);
    if (!pesan) startTransition(() => undefined);
  }

  return { error, busy, run };
}
