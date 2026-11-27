'use client';

import { useEffect, useState } from 'react';
import { saveManualReceiptAction } from '@/app/(app)/receiving/actions';
import type { ReceiptDetail } from '@/lib/queries';

type Line = ReceiptDetail['lines'][number];

export function ManualReceiptLines({
  receiptId, lines, canEdit, onSaved, onPendingChange,
}: {
  receiptId: string;
  lines: Line[];
  canEdit: boolean;
  onSaved: (lineId: number, qty: number) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = busy !== null || lines.some((line) =>
    values[line.id] !== undefined && values[line.id] !== String(line.manualQty ?? ''),
  );
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);

  async function save(line: Line) {
    const raw = values[line.id] ?? String(line.manualQty ?? '');
    const qty = Number(raw);
    if (!raw.trim() || !Number.isInteger(qty) || qty < 0) {
      setError('Isi qty diterima dengan angka bulat ≥ 0.');
      return;
    }
    setBusy(line.id);
    setError(null);
    const res = await saveManualReceiptAction(receiptId, line.id, qty);
    setBusy(null);
    if ('error' in res) { setError(res.error); return; }
    onSaved(res.picklistLineId, res.qty);
  }

  return (
    <section aria-labelledby="manual-receipt-heading" className="space-y-4 p-4 sm:p-5">
      <div>
        <h2 id="manual-receipt-heading" className="text-lg font-bold">Part tanpa kanban</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {canEdit ? 'Isi jumlah aktual yang diterima, lalu simpan setiap part.' : 'Qty diterima diisi oleh PPIC atau Admin.'}
        </p>
      </div>
      {lines.map((line) => (
        <form key={line.id} onSubmit={(event) => { event.preventDefault(); void save(line); }}
          className="space-y-3 border-t border-line pt-4">
          <div>
            <div className="font-semibold">{line.partNo} · {line.partName}</div>
            <p className="mt-1 text-sm text-ink-muted">
              Order {line.qtyOrdered.toLocaleString('id-ID')} {line.uom}
              {' · '}Dikirim {((line.boxShipped ?? line.boxOrdered) * line.qtyPerBox).toLocaleString('id-ID')} {line.uom}
            </p>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-sm font-semibold" htmlFor={`manual-qty-${line.id}`}>
                Qty diterima ({line.uom})
                <input id={`manual-qty-${line.id}`} type="number" inputMode="numeric" step={1} min={0}
                  max={(line.boxShipped ?? line.boxOrdered) * line.qtyPerBox}
                  value={values[line.id] ?? String(line.manualQty ?? '')}
                  onChange={(event) => setValues((old) => ({ ...old, [line.id]: event.target.value }))}
                  disabled={busy !== null} required
                  className="mt-2 h-12 w-full rounded-input border border-line bg-field px-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-accent" />
              </label>
              <button type="submit" disabled={busy !== null}
                className="h-12 rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50">
                {busy === line.id ? 'Menyimpan…' : 'Simpan qty'}
              </button>
            </div>
          ) : null}
          <p role="status" className="text-sm text-ink-muted">
            {line.manualQty === null ? 'Belum diisi PPIC' : `Tersimpan ${line.manualQty.toLocaleString('id-ID')} ${line.uom}`}
          </p>
        </form>
      ))}
      {error && <p role="alert" className="text-sm text-ng">{error}</p>}
      {pending && <p role="status" className="text-sm text-warn">Simpan perubahan qty sebelum menutup penerimaan.</p>}
    </section>
  );
}
