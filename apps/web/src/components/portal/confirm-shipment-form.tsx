'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, AlertTriangle, Loader2, Truck } from 'lucide-react';
import { confirmShipmentAction } from '@/app/(portal)/portal/actions';
import { Table, Th, Td, Tr } from '../ui/table';
import { cn } from '../ui/cn';
import { useFeedback } from '../ui/feedback-provider';

const INPUT =
  'h-11 rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';
const LABEL = 'mb-2 block text-[14px] font-semibold';

interface Line {
  id: number;
  partNo: string;
  partName: string;
  backNo: string;
  boxOrdered: number;
  qtyPerBox: number;
}

/**
 * Konfirmasi kirim supplier (F-30, 6.3).
 *
 * Box dikirim per line diisi langsung di tabel muatan, bawaan = box diorder:
 * pada hari biasa supplier cukup mengecek ETA lalu menekan satu tombol.
 * Kurang dari order boleh, lebih tidak (6.3.1) — dibatasi di input dan
 * ditolak lagi oleh API. Apa yang terjadi pada sisa (dibatalkan atau jadi
 * revisi) diputuskan kebijakan supplier di pabrik, bukan di layar ini.
 */
export function ConfirmShipmentForm({
  picklistId,
  lines,
  defaultEta,
}: {
  picklistId: string;
  lines: Line[];
  /** Tanggal + jam kedatangan picklist sebagai nilai awal ETA (datetime-local). */
  defaultEta: string;
}) {
  const [shipped, setShipped] = useState<Record<number, string>>(
    Object.fromEntries(lines.map((l) => [l.id, String(l.boxOrdered)])),
  );
  const [eta, setEta] = useState(defaultEta);
  const [vehicleNo, setVehicleNo] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const feedback = useFeedback();

  const angka = (id: number) => Number(shipped[id] ?? 0);
  const totalKurang = lines.reduce((n, l) => n + Math.max(0, l.boxOrdered - angka(l.id)), 0);
  const cacat = lines.find(
    (l) => !Number.isInteger(angka(l.id)) || angka(l.id) < 0 || angka(l.id) > l.boxOrdered,
  );

  async function kirim() {
    setError(null);
    if (cacat) {
      setError(`Box dikirim ${cacat.partNo} harus 0 sampai ${cacat.boxOrdered}.`);
      return;
    }
    setSibuk(true);
    const res = await confirmShipmentAction(picklistId, {
      lines: lines.map((l) => ({ picklistLineId: l.id, boxShipped: angka(l.id) })),
      eta: eta ? new Date(eta).toISOString() : undefined,
      vehicleNo: vehicleNo.trim() || undefined,
      note: note.trim() || undefined,
    });
    setSibuk(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    feedback.success(
      'Konfirmasi pengiriman tersimpan',
      res.short && res.revision
        ? `Kekurangan dibuat menjadi Order Sheet recovery revisi ${res.revision.revision}.`
        : 'Order sekarang menunggu proses Receiving.',
    );
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <Table>
        <thead>
          <tr>
            <Th>Part</Th>
            <Th>Back no</Th>
            <Th align="right">Diorder</Th>
            <Th align="right">Dikirim</Th>
            <Th align="right">Pcs</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const n = angka(l.id);
            const kurang = n < l.boxOrdered;
            return (
              <Tr key={l.id}>
                <Td strong className="whitespace-nowrap">
                  <span className="tabular">{l.partNo}</span>
                  <span className="ml-2 font-normal text-ink-muted">{l.partName}</span>
                </Td>
                <Td className="tabular">{l.backNo}</Td>
                <Td align="right" className="tabular">
                  {l.boxOrdered}
                </Td>
                <Td align="right">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={l.boxOrdered}
                    step={1}
                    value={shipped[l.id] ?? ''}
                    onChange={(e) => setShipped((old) => ({ ...old, [l.id]: e.target.value }))}
                    aria-label={`Box dikirim ${l.partNo}`}
                    className={cn(
                      'tabular h-10 w-24 rounded-2xl border bg-surface px-3 text-right text-[15px] font-semibold outline-none transition-colors focus:bg-card',
                      kurang ? 'border-warn text-warn' : 'border-line focus:border-line-strong',
                    )}
                  />
                </Td>
                <Td align="right" className="tabular">
                  {Number.isFinite(n) ? n * l.qtyPerBox : '—'}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <div className="grid gap-5 border-t border-line px-6 py-5 sm:grid-cols-2">
        <div>
          <label htmlFor="eta" className={LABEL}>
            Perkiraan tiba (ETA)
          </label>
          <input
            id="eta"
            type="datetime-local"
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            className={cn(INPUT, 'w-full')}
          />
        </div>
        <div>
          <label htmlFor="kendaraan" className={LABEL}>
            Nomor kendaraan
          </label>
          <input
            id="kendaraan"
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            maxLength={32}
            placeholder="B 1234 XYZ"
            className={cn(INPUT, 'w-full uppercase')}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="catatan" className={LABEL}>
            Catatan untuk gudang <span className="font-normal text-ink-muted">(opsional)</span>
          </label>
          <input
            id="catatan"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={255}
            placeholder="Nama sopir, kemasan berbeda, dsb."
            className={cn(INPUT, 'w-full')}
          />
        </div>
      </div>

      {totalKurang > 0 ? (
        <p className="mx-6 mb-4 flex items-start gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span>
            {totalKurang} box kurang dari order. Setelah dikonfirmasi jumlahnya tidak bisa diubah
            dari portal; sisanya diproses pabrik sesuai kesepakatan (dibatalkan atau jadi order
            revisi).
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-line px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        {error ? (
          <p role="alert" className="flex items-center gap-1.5 text-[13px] text-ng">
            <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            {error}
          </p>
        ) : (
          <p className="text-[13px] text-ink-muted">
            Pastikan kanban sudah ditempel di tiap box sebelum truk berangkat.
          </p>
        )}
        <button
          type="button"
          onClick={() => void kirim()}
          disabled={sibuk || pending}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sibuk ? (
            <Loader2 className="size-[18px] animate-spin" strokeWidth={2} aria-hidden />
          ) : (
            <Truck className="size-[18px]" strokeWidth={2.2} aria-hidden />
          )}
          {sibuk ? 'Sedang menyimpan…' : 'Konfirmasi kirim'}
        </button>
      </div>
    </div>
  );
}
