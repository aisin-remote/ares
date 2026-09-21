'use client';

import { useActionState, useState } from 'react';
import { AlertCircle, FileSpreadsheet, GitBranch, Upload } from 'lucide-react';
import {
  importBomAction,
  explodeBomAction,
  type BomExplodeResult,
} from '@/app/(app)/master/actions';
import type { MasterOption } from '@/lib/queries';
import { Card, CardHeader, CardDivider } from '../ui/card';
import { Table, Th, Td, Tr } from '../ui/table';

const INPUT =
  'h-11 rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

/**
 * Dua alat di atas tabel BOM (F-03): upload Excel dan pratinjau penguraian.
 * Penguraiannya dihitung API lewat explodeBom (packages/domain) — layar ini
 * hanya menampilkan, supaya angka di sini dan di konsumsi produksi (F-10)
 * berasal dari fungsi yang sama.
 */
export function BomTools({ parts }: { parts: MasterOption[] }) {
  return (
    <div className="mb-5 grid gap-5 xl:grid-cols-2">
      <ImportCard />
      <ExplodeCard parts={parts} />
    </div>
  );
}

function ImportCard() {
  const [state, action, pending] = useActionState(importBomAction, null);
  const hasil = state && !('error' in state) ? state : null;
  return (
    <Card>
      <CardHeader
        icon={FileSpreadsheet}
        title="Upload Excel"
        subtitle="Kolom A–E: part jadi, komponen, qty per, berlaku dari, berlaku sampai (opsional)"
      />
      <CardDivider />
      <form action={action} className="flex flex-col gap-3 px-6 py-5">
        <input
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="block w-full text-[14px] text-ink-soft file:mr-3 file:h-10 file:rounded-full file:border file:border-line file:bg-card file:px-4 file:text-[13px] file:font-semibold file:text-ink hover:file:border-line-strong"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-muted">
            Baris (induk, komponen, mulai berlaku) yang sudah ada diperbarui; baris cacat dilewati
            dan dilaporkan.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
          >
            <Upload className="size-[18px]" strokeWidth={2.2} aria-hidden />
            {pending ? 'Mengunggah…' : 'Unggah'}
          </button>
        </div>
        {state && 'error' in state ? (
          <p role="alert" className="flex items-center gap-1.5 text-[13px] text-ng">
            <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            {state.error}
          </p>
        ) : null}
        {hasil ? (
          <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-[14px]">
            <span className="font-semibold text-ok">{hasil.inserted} baru</span> ·{' '}
            <span className="font-semibold">{hasil.updated} diperbarui</span> ·{' '}
            <span className={hasil.skipped > 0 ? 'font-semibold text-warn' : 'text-ink-muted'}>
              {hasil.skipped} dilewati
            </span>
            {hasil.errors.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-[13px] text-ink-soft">
                {hasil.errors.slice(0, 20).map((e) => (
                  <li key={`${e.row}-${e.message}`}>
                    Baris {e.row}: {e.message}
                  </li>
                ))}
                {hasil.errors.length > 20 ? (
                  <li>… dan {hasil.errors.length - 20} baris lain</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function ExplodeCard({ parts }: { parts: MasterOption[] }) {
  const [partId, setPartId] = useState<number | ''>('');
  const [qty, setQty] = useState('1');
  const [onDate, setOnDate] = useState('');
  const [hasil, setHasil] = useState<BomExplodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function urai() {
    setError(null);
    const n = Number(qty);
    if (partId === '' || !Number.isFinite(n) || n <= 0) {
      setError('Pilih part jadi dan isi qty lebih dari 0.');
      return;
    }
    setSibuk(true);
    const res = await explodeBomAction({ partId, qty: n, onDate: onDate || undefined });
    setSibuk(false);
    if ('error' in res) {
      setError(res.error);
      setHasil(null);
      return;
    }
    setHasil(res);
  }

  return (
    <Card>
      <CardHeader
        icon={GitBranch}
        title="Pratinjau penguraian"
        subtitle="Kebutuhan komponen sampai raw material untuk sejumlah part jadi pada tanggal tertentu"
      />
      <CardDivider />
      <div className="px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_160px_auto] sm:items-end">
          <div>
            <label htmlFor="urai-part" className="mb-2 block text-[14px] font-semibold">
              Part jadi
            </label>
            <select
              id="urai-part"
              value={partId}
              onChange={(e) => setPartId(e.target.value ? Number(e.target.value) : '')}
              className={`${INPUT} w-full`}
            >
              <option value="">Pilih part</option>
              {parts.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="urai-qty" className="mb-2 block text-[14px] font-semibold">
              Qty
            </label>
            <input
              id="urai-qty"
              type="number"
              min={1}
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={`${INPUT} tabular w-full`}
            />
          </div>
          <div>
            <label htmlFor="urai-tgl" className="mb-2 block text-[14px] font-semibold">
              Per tanggal
            </label>
            <input
              id="urai-tgl"
              type="date"
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={`${INPUT} w-full`}
            />
          </div>
          <button
            type="button"
            onClick={() => void urai()}
            disabled={sibuk}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-card px-5 text-[14px] font-semibold transition-colors hover:border-ink disabled:opacity-50"
          >
            {sibuk ? 'Mengurai…' : 'Urai'}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 flex items-center gap-1.5 text-[13px] text-ng">
            <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
      {hasil ? (
        <>
          <CardDivider />
          <Table>
            <thead>
              <tr>
                <Th>Komponen</Th>
                <Th align="right">Level</Th>
                <Th align="right">Kebutuhan</Th>
                <Th>Dibeli?</Th>
              </tr>
            </thead>
            <tbody>
              {hasil.lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-[14px] text-ink-muted">
                    {hasil.root.partNo} tidak punya BOM yang berlaku pada {hasil.onDate}.
                  </td>
                </tr>
              ) : (
                hasil.lines.map((l, i) => {
                  const leaf = hasil.leaves.some((x) => x.partId === l.partId);
                  return (
                    <Tr key={`${l.partId}-${i}`}>
                      <Td strong>
                        <span
                          className="tabular"
                          style={{ paddingLeft: `${(l.level - 1) * 16}px` }}
                        >
                          {l.partNo}
                        </span>
                        <span className="ml-2 font-normal text-ink-muted">{l.name}</span>
                      </Td>
                      <Td align="right" className="tabular">
                        {l.level}
                      </Td>
                      <Td align="right" className="tabular">
                        {Number(l.qty.toFixed(4)).toLocaleString('id-ID')} {l.uom}
                      </Td>
                      <Td>
                        {leaf ? (
                          <span className="font-semibold text-ok">ya</span>
                        ) : (
                          <span className="text-ink-muted">diproduksi</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </>
      ) : null}
    </Card>
  );
}
