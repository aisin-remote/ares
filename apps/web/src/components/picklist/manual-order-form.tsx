'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { issueManualAction } from '@/app/(app)/picklist/actions';
import type { OrderOption } from '@/lib/queries';
import { SelectSearch } from '@/components/ui/select-search';
import { cn } from '@/components/ui/cn';
import { useFeedback } from '@/components/ui/feedback-provider';

const INPUT =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';
const LABEL = 'mb-2 block text-[14px] font-semibold';

function kosongkanJumlah(parts: OrderOption['parts']): Record<number, string> {
  return Object.fromEntries(parts.map((part) => [part.id, '0']));
}

function poTersedia(part: OrderOption['parts'][number], deliveryDate: string) {
  return part.poWindows.reduce((total, po) => {
    const berlaku =
      (!po.validFrom || po.validFrom <= deliveryDate) &&
      (!po.validTo || po.validTo >= deliveryDate);
    return berlaku ? total + po.openQty : total;
  }, 0);
}

/**
 * Order manual PPIC (F-17).
 *
 * Semua vendor part aktif supplier langsung ditampilkan. Nilai 0 berarti tidak
 * ikut order; hanya baris positif yang dikirim ke API sebagai satu order.
 */
export function ManualOrderForm({
  vendors,
  defaultDeliveryDate,
}: {
  vendors: OrderOption[];
  defaultDeliveryDate: string;
}) {
  const [vendorId, setVendorId] = useState<number | ''>(vendors[0]?.id ?? '');
  const [cutoffId, setCutoffId] = useState<number | ''>('');
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate);
  const [note, setNote] = useState('');
  const [boxesByPart, setBoxesByPart] = useState<Record<number, string>>(() =>
    kosongkanJumlah(vendors[0]?.parts ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const router = useRouter();
  const feedback = useFeedback();

  const vendor = vendors.find((v) => v.id === vendorId);
  const jumlahDipilih = (vendor?.parts ?? []).filter(
    (part) => Number(boxesByPart[part.id] ?? 0) > 0,
  ).length;
  const totalBox = (vendor?.parts ?? []).reduce(
    (total, part) => total + Math.max(0, Number(boxesByPart[part.id] ?? 0) || 0),
    0,
  );
  const masalahMaster = [
    !vendor?.sapVendorNo ? 'Nomor SAP supplier belum diisi.' : null,
    !vendor?.cutoffs.length ? 'Jadwal cutoff supplier belum tersedia.' : null,
    !vendor?.parts.length ? 'Vendor part aktif belum tersedia.' : null,
  ].filter((item): item is string => Boolean(item));
  const partTanpaPo = (vendor?.parts ?? []).filter((part) => poTersedia(part, deliveryDate) <= 0);
  const partDipilihBermasalah = (vendor?.parts ?? []).filter((part) => {
    const box = Math.max(0, Number(boxesByPart[part.id] ?? 0) || 0);
    return box > 0 && box * part.qtyPerBox > poTersedia(part, deliveryDate);
  });

  function gantiVendor(id: number | '') {
    setVendorId(id);
    setCutoffId('');
    setBoxesByPart(kosongkanJumlah(vendors.find((item) => item.id === id)?.parts ?? []));
    setError(null);
  }

  function ubahJumlah(vendorPartId: number, boxes: string) {
    setBoxesByPart((old) => ({ ...old, [vendorPartId]: boxes }));
  }

  async function simpan() {
    setError(null);
    if (vendorId === '' || !vendor) {
      setError('Pilih supplier.');
      return;
    }
    if (masalahMaster.length > 0) {
      setError(masalahMaster[0]!);
      return;
    }

    const cacat = vendor.parts.findIndex(
      (part) =>
        boxesByPart[part.id]?.trim() !== '' &&
        (!Number.isInteger(Number(boxesByPart[part.id])) || Number(boxesByPart[part.id]) < 0),
    );
    if (cacat >= 0) {
      setError(`${vendor.parts[cacat]!.partNo}: jumlah box harus bilangan bulat, minimal 0.`);
      return;
    }

    const isi = vendor.parts
      .map((part) => ({
        vendorPartId: part.id,
        boxes: Number(boxesByPart[part.id] || 0),
      }))
      .filter((line) => line.boxes > 0);
    if (isi.length === 0) {
      setError('Isi jumlah box minimal 1 pada komponen yang ingin diorder.');
      return;
    }
    if (partDipilihBermasalah.length > 0) {
      setError(
        `${partDipilihBermasalah[0]!.partNo}: PO aktif tidak tersedia atau sisa qty PO tidak cukup.`,
      );
      return;
    }

    setSibuk(true);
    const res = await issueManualAction({
      vendorId: Number(vendorId),
      deliveryDate,
      cutoffId: cutoffId === '' ? undefined : Number(cutoffId),
      lines: isi,
      note: note.trim() || undefined,
    });
    if ('error' in res) {
      setSibuk(false);
      setError(res.error);
      return;
    }
    feedback.success(
      'Order Sheet berhasil diterbitkan',
      `${res.picklistNo} · ${res.lineCount} part · ${res.kanbanCount} kanban`,
    );
    // Tombol sengaja tetap terkunci sampai halaman detail terbuka: klik kedua
    // pada jaringan lambat menerbitkan picklist kedua yang tidak bisa dihapus.
    router.push(`/picklist/${res.publicId}`);
  }

  if (vendors.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-[14px] text-ink-muted">
        Belum ada supplier aktif. Isi master supplier dan vendor part lebih dulu (F-01, F-02).
      </p>
    );
  }

  return (
    <div className="px-6 py-5">
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor="vendor" className={LABEL}>
            Supplier<span className="ml-1 text-ng">*</span>
          </label>
          <SelectSearch
            id="vendor"
            value={vendorId}
            required
            placeholder="Pilih supplier"
            onValueChange={(value) => gantiVendor(value === '' ? '' : Number(value))}
            options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
          />
        </div>

        <div>
          <label htmlFor="kirim" className={LABEL}>
            Tanggal kirim<span className="ml-1 text-ng">*</span>
          </label>
          <input
            id="kirim"
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className={INPUT}
          />
        </div>

        <div>
          <label htmlFor="cutoff" className={LABEL}>
            Cutoff / cycle
          </label>
          <SelectSearch
            id="cutoff"
            value={cutoffId}
            placeholder="Cutoff paling pagi"
            onValueChange={(value) => setCutoffId(value === '' ? '' : Number(value))}
            options={(vendor?.cutoffs ?? []).map((cutoff) => ({
              value: cutoff.id,
              label: `Cutoff ${cutoff.cutoffTime.slice(0, 5)} — datang ${cutoff.arrivalTime.slice(0, 5)}`,
            }))}
          />
        </div>
      </div>

      <div
        className={cn(
          'mt-5 flex items-start gap-3 rounded-2xl border px-4 py-3 text-[14px]',
          masalahMaster.length > 0
            ? 'border-ng/25 bg-ng/8 text-ng'
            : partTanpaPo.length > 0
              ? 'border-warn/35 bg-warn/10 text-warn'
              : 'border-ok/30 bg-ok/10 text-ok',
        )}
      >
        {masalahMaster.length > 0 || partTanpaPo.length > 0 ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
        )}
        <div>
          <p className="font-semibold">
            {masalahMaster.length > 0
              ? 'Supplier belum siap diorder'
              : partTanpaPo.length > 0
                ? `${partTanpaPo.length} part belum memiliki PO aktif`
                : 'Supplier siap diorder'}
          </p>
          <p className="mt-0.5 opacity-85">
            {masalahMaster.length > 0
              ? masalahMaster.join(' ')
              : partTanpaPo.length > 0
                ? `Tanggal ${deliveryDate}: part tersebut harus tetap diisi 0 sampai PO tersedia.`
                : 'Master supplier, cutoff, vendor part, dan PO sudah tersedia untuk tanggal kirim ini.'}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className={LABEL}>
              Part dan jumlah box<span className="ml-1 text-ng">*</span>
            </span>
            <p className="text-[13px] text-ink-muted">
              Isi jumlah box yang dipesan. Biarkan 0 untuk part yang tidak ikut order.
            </p>
          </div>
          <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-soft">
            {jumlahDipilih} part · {totalBox} box
          </span>
        </div>

        {vendor?.parts.length ? (
          <div className="scroll-slim max-h-[520px] overflow-auto rounded-2xl border border-line">
            <table className="w-full min-w-[880px] border-collapse text-left text-[14px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
                  <th scope="col" className="w-[38%] px-5 py-3">
                    Part
                  </th>
                  <th scope="col" className="w-[14%] px-4 py-3">
                    Back no
                  </th>
                  <th scope="col" className="w-[14%] px-4 py-3 text-right">
                    Isi per box
                  </th>
                  <th scope="col" className="w-[18%] px-4 py-3">
                    Kesiapan
                  </th>
                  <th scope="col" className="w-[16%] px-5 py-3 text-right">
                    Jumlah box
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {vendor.parts.map((part) => {
                  const dipilih = Number(boxesByPart[part.id] ?? 0) > 0;
                  const openQty = poTersedia(part, deliveryDate);
                  const pcsDipilih = (Number(boxesByPart[part.id] ?? 0) || 0) * part.qtyPerBox;
                  const poCukup = openQty > 0 && pcsDipilih <= openQty;
                  return (
                    <tr
                      key={part.id}
                      className={
                        dipilih ? 'bg-accent/[0.06]' : 'transition-colors hover:bg-surface/70'
                      }
                    >
                      <td className="px-5 py-3">
                        <div className="font-semibold text-ink">{part.partNo}</div>
                        <div className="mt-0.5 text-[12px] text-ink-muted">{part.partName}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink-soft">
                        {part.backNo}
                      </td>
                      <td className="px-4 py-3 text-right tabular text-ink-soft">
                        {part.qtyPerBox} pcs
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                            poCukup
                              ? 'border-ok/30 bg-ok/10 text-ok'
                              : 'border-warn/35 bg-warn/10 text-warn',
                          )}
                        >
                          {openQty <= 0
                            ? 'PO belum aktif'
                            : pcsDipilih > openQty
                              ? `PO kurang · ${openQty} pcs`
                              : `PO siap · ${openQty} pcs`}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <input
                          aria-label={`Jumlah box ${part.partNo}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={boxesByPart[part.id] ?? '0'}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => ubahJumlah(part.id, event.target.value)}
                          className="h-10 w-28 rounded-xl border border-line bg-surface px-3 text-right text-[15px] font-semibold tabular outline-none transition-colors focus:border-accent focus:bg-card"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-[14px] text-ink-muted">
            Supplier ini belum memiliki vendor part aktif. Lengkapi master Vendor Part terlebih
            dahulu.
          </p>
        )}
      </div>

      <div className="mt-6">
        <label htmlFor="catatan" className={LABEL}>
          Catatan untuk supplier
        </label>
        <input
          id="catatan"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={255}
          placeholder="Opsional, mis. alasan order tambahan"
          className={INPUT}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-2xl border border-ng/25 bg-ng/8 px-4 py-3 text-[14px] text-ng"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void simpan()}
          disabled={sibuk || masalahMaster.length > 0 || partDipilihBermasalah.length > 0}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-60"
        >
          {sibuk ? (
            <>
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
              Sedang menerbitkan…
            </>
          ) : (
            'Terbitkan Order Sheet'
          )}
        </button>
        <button
          type="button"
          onClick={() => router.push('/picklist')}
          className="h-11 rounded-full px-5 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink"
        >
          Batal
        </button>
      </div>
    </div>
  );
}
