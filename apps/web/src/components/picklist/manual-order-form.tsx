'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { issueManualAction } from '@/app/(app)/picklist/actions';
import type { OrderOption } from '@/lib/queries';

const INPUT =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';
const LABEL = 'mb-2 block text-[14px] font-semibold';

interface Baris {
  key: string;
  vendorPartId: number | '';
  boxes: string;
}

/**
 * Order manual PPIC (F-17).
 *
 * Baris disimpan di state layar dan dikirim sekali sebagai satu order, bukan
 * per baris: satu cutoff menghasilkan satu picklist, dan picklist setengah
 * jadi jauh lebih sulit dibereskan daripada mengulang dari awal.
 *
 * Vendor part yang sudah dipilih hilang dari pilihan baris lain — API menolak
 * vendor part ganda dalam satu order, dan pesan penolakannya akan terbaca
 * seperti kerusakan kalau layar membiarkannya terjadi.
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
  const [lines, setLines] = useState<Baris[]>([{ key: 'b0', vendorPartId: '', boxes: '1' }]);
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const seq = useRef(1);
  const router = useRouter();

  const vendor = vendors.find((v) => v.id === vendorId);
  const terpakai = new Set(lines.map((l) => l.vendorPartId).filter((v) => v !== ''));

  function gantiVendor(id: number | '') {
    setVendorId(id);
    setCutoffId('');
    setLines([{ key: `b${seq.current++}`, vendorPartId: '', boxes: '1' }]);
    setError(null);
  }

  function ubahBaris(key: string, patch: Partial<Baris>) {
    setLines((old) => old.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function simpan() {
    setError(null);
    const dipilih = lines.filter((l) => l.vendorPartId !== '');
    if (vendorId === '' || dipilih.length === 0) {
      setError('Pilih supplier dan minimal satu part.');
      return;
    }

    /*
     * Baris dengan box kosong atau nol TIDAK boleh dibuang diam-diam: picklist
     * akan terbit tanpa part itu, dan satu-satunya pemulihannya adalah batal
     * lalu terbit ulang dengan nomor baru (F-20, 6.6.2).
     */
    const cacat = dipilih.findIndex(
      (l) => !Number.isInteger(Number(l.boxes)) || Number(l.boxes) < 1,
    );
    if (cacat >= 0) {
      setError(`Baris ke-${cacat + 1}: jumlah box minimal 1.`);
      return;
    }

    const isi = dipilih.map((l) => ({
      vendorPartId: Number(l.vendorPartId),
      boxes: Number(l.boxes),
    }));

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
    // Tombol sengaja tetap terkunci sampai halaman detail terbuka: klik kedua
    // pada jaringan lambat menerbitkan picklist kedua yang tidak bisa dihapus.
    router.push(`/picklist/${res.id}`);
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
          <select
            id="vendor"
            value={vendorId}
            onChange={(e) => gantiVendor(e.target.value === '' ? '' : Number(e.target.value))}
            className={INPUT}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
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
          <select
            id="cutoff"
            value={cutoffId}
            onChange={(e) => setCutoffId(e.target.value === '' ? '' : Number(e.target.value))}
            className={INPUT}
          >
            <option value="">Cutoff paling pagi</option>
            {vendor?.cutoffs.map((c) => (
              <option key={c.id} value={c.id}>
                Cutoff {c.cutoffTime.slice(0, 5)} — datang {c.arrivalTime.slice(0, 5)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6">
        <span className={LABEL}>
          Part dan jumlah box<span className="ml-1 text-ng">*</span>
        </span>
        <div className="flex flex-col gap-3">
          {lines.map((l) => {
            const vp = vendor?.parts.find((p) => p.id === l.vendorPartId);
            return (
              <div key={l.key} className="flex flex-wrap items-center gap-3">
                <select
                  aria-label="Part"
                  value={l.vendorPartId}
                  onChange={(e) =>
                    ubahBaris(l.key, {
                      vendorPartId: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                  className={`${INPUT} min-w-[280px] flex-1`}
                >
                  <option value="">— pilih part —</option>
                  {vendor?.parts
                    .filter((p) => p.id === l.vendorPartId || !terpakai.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partNo} — {p.partName} (back no {p.backNo})
                      </option>
                    ))}
                </select>

                <input
                  aria-label="Jumlah box"
                  type="number"
                  min={1}
                  value={l.boxes}
                  onChange={(e) => ubahBaris(l.key, { boxes: e.target.value })}
                  className={`${INPUT} tabular w-28`}
                />

                <span className="tabular w-32 text-[13px] text-ink-muted">
                  {vp ? `${vp.qtyPerBox} pcs/box` : ''}
                </span>

                {lines.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Hapus baris"
                    onClick={() => setLines((old) => old.filter((x) => x.key !== l.key))}
                    className="inline-flex size-11 items-center justify-center rounded-full border border-line text-ink-muted transition-colors hover:border-ng hover:text-ng"
                  >
                    <Trash2 className="size-4" strokeWidth={1.9} aria-hidden />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() =>
            setLines((old) => [...old, { key: `b${seq.current++}`, vendorPartId: '', boxes: '1' }])
          }
          className="mt-3 inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:border-ink"
        >
          <Plus className="size-4" strokeWidth={2.2} aria-hidden />
          Tambah part
        </button>
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
          disabled={sibuk}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-60"
        >
          {sibuk ? 'Menerbitkan…' : 'Terbitkan picklist'}
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
