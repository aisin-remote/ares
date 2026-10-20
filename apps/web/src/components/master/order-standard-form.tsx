'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import type { OrderStandardOption } from '@/lib/queries';
import { saveOrderStandardsAction } from '@/app/(app)/master/actions';
import { SelectSearch } from '@/components/ui/select-search';
import { useFeedback } from '@/components/ui/feedback-provider';

type Part = OrderStandardOption['parts'][number];

function valuesOf(parts: Part[]): Record<number, string> {
  return Object.fromEntries(
    parts.map((part) => [
      part.id,
      part.standardKanban === null ? '' : String(part.standardKanban),
    ]),
  );
}

/** Pengisian standar order massal dengan pola yang sama seperti Order Manual. */
export function OrderStandardForm({ vendors }: { vendors: OrderStandardOption[] }) {
  const [vendorId, setVendorId] = useState<number | ''>('');
  const [values, setValues] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const feedback = useFeedback();
  const vendor = vendors.find((item) => item.id === vendorId);
  const configured = (vendor?.parts ?? []).filter(
    (part) => (values[part.id] ?? '').trim() !== '',
  ).length;
  const totalKanban = (vendor?.parts ?? []).reduce((total, part) => {
    const raw = values[part.id]?.trim() ?? '';
    return total + (raw === '' ? 0 : Number(raw) || 0);
  }, 0);

  function changeVendor(id: number | '') {
    setVendorId(id);
    setValues(valuesOf(vendors.find((item) => item.id === id)?.parts ?? []));
    setError(null);
  }

  async function save() {
    setError(null);
    if (!vendor || vendorId === '') {
      setError('Pilih supplier terlebih dahulu.');
      return;
    }
    if (vendor.parts.length === 0) {
      setError('Supplier ini belum memiliki vendor part aktif.');
      return;
    }

    const invalid = vendor.parts.find((part) => {
      const raw = values[part.id]?.trim() ?? '';
      return raw !== '' && (!Number.isInteger(Number(raw)) || Number(raw) < 0);
    });
    if (invalid) {
      setError(`${invalid.partNo}: standar harus bilangan bulat, minimal 0.`);
      return;
    }

    setBusy(true);
    const result = await saveOrderStandardsAction({
      vendorId: Number(vendorId),
      lines: vendor.parts.map((part) => {
        const raw = values[part.id]?.trim() ?? '';
        return {
          vendorPartId: part.id,
          standardKanban: raw === '' ? null : Number(raw),
        };
      }),
    });
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }

    feedback.success(
      'Standar order berhasil disimpan',
      `${configured} dari ${vendor.parts.length} part memiliki standar aktif.`,
    );
    router.refresh();
  }

  if (vendors.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-[14px] text-ink-muted">
        Belum ada supplier aktif. Lengkapi Master Supplier terlebih dahulu.
      </p>
    );
  }

  return (
    <div className="px-6 py-5">
      <div className="max-w-xl">
        <label htmlFor="standard-vendor" className="mb-2 block text-[14px] font-semibold">
          Supplier<span className="ml-1 text-ng">*</span>
        </label>
        <SelectSearch
          id="standard-vendor"
          value={vendorId}
          required
          placeholder="Pilih supplier"
          onValueChange={(value) => changeVendor(value === '' ? '' : Number(value))}
          options={vendors.map((item) => ({
            value: item.id,
            label: item.sapVendorNo ? `${item.name} — ${item.sapVendorNo}` : item.name,
          }))}
        />
      </div>

      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold">Part dan standar order</h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              Isi jumlah kanban normal. Kosongkan jika standar belum ditetapkan.
            </p>
          </div>
          <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-soft">
            {configured} dari {vendor?.parts.length ?? 0} part · {totalKanban.toLocaleString('id-ID')} kanban
          </span>
        </div>

        {!vendor ? (
          <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-[14px] text-ink-muted">
            Pilih supplier untuk menampilkan seluruh part yang dipasok.
          </p>
        ) : vendor.parts.length ? (
          <div className="scroll-slim max-h-[600px] overflow-auto rounded-2xl border border-line">
            <table className="w-full min-w-[760px] border-collapse text-left text-[14px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
                  <th scope="col" className="w-[42%] px-5 py-3">Part</th>
                  <th scope="col" className="w-[18%] px-4 py-3">Back no</th>
                  <th scope="col" className="w-[18%] px-4 py-3 text-right">Isi per kanban</th>
                  <th scope="col" className="w-[22%] px-5 py-3 text-right">Standar order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {vendor.parts.map((part) => {
                  const active = (values[part.id] ?? '').trim() !== '';
                  return (
                    <tr
                      key={part.id}
                      className={active ? 'bg-accent/[0.06]' : 'transition-colors hover:bg-surface/70'}
                    >
                      <td className="px-5 py-3">
                        <div className="font-semibold text-ink">{part.partNo}</div>
                        <div className="mt-0.5 text-[12px] text-ink-muted">{part.partName}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink-soft">
                        {part.backNo}
                      </td>
                      <td className="px-4 py-3 text-right tabular text-ink-soft">
                        {part.qtyPerKanban.toLocaleString('id-ID')} pcs
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="relative ml-auto w-40">
                          <input
                            aria-label={`Standar order ${part.partNo}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            placeholder="—"
                            value={values[part.id] ?? ''}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [part.id]: event.target.value,
                              }))
                            }
                            className="h-10 w-full rounded-xl border border-line bg-surface px-3 pr-16 text-right text-[15px] font-semibold tabular outline-none transition-colors placeholder:text-ink-muted focus:border-accent focus:bg-card"
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-ink-muted">
                            kanban
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-[14px] text-ink-muted">
            Supplier ini belum memiliki vendor part aktif. Lengkapi Master Vendor Part terlebih dahulu.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[12px] text-ink-muted">
        <Check className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2.2} aria-hidden />
        <p>
          Angka 0 berarti part memang memiliki standar normal 0 kanban. Mengosongkan kolom akan menonaktifkan standar part tersebut.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-2xl border border-ng/25 bg-ng/8 px-4 py-3 text-[14px] text-ng"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !vendor?.parts.length}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
              Menyimpan…
            </>
          ) : (
            <>
              <Check className="size-4" strokeWidth={2.4} aria-hidden />
              Simpan standar
            </>
          )}
        </button>
      </div>
    </div>
  );
}
