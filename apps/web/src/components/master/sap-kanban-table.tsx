'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Pencil, X } from 'lucide-react';
import type { SapKanbanMasterRow, SaveSapKanbanResult } from '@ares/contracts';
import { saveSapKanbanAction } from '@/app/(app)/master/kanban/actions';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';

export function SapKanbanTable({ rows }: { rows: SapKanbanMasterRow[] }) {
  const [saved, setSaved] = useState(rows);
  const [editing, setEditing] = useState<SapKanbanMasterRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const keyOf = (row: SapKanbanMasterRow) => `${row.supplierId}/${row.material}/${row.kanbanId ?? 'new'}`;

  return (
    <>
      {message && <p role="status" className="border-b border-line px-5 py-4 text-sm text-ok">{message}</p>}
      <Table scroll>
        <thead><tr>
          <Th>Supplier</Th><Th>Part</Th><Th>Back no</Th><Th>Plant / lokasi</Th>
          <Th>Kemasan / rak</Th><Th align="right">Qty per kanban</Th><Th sticky="right">Aksi</Th>
        </tr></thead>
        <tbody>
          {saved.length === 0 ? <EmptyState colSpan={7}>Data supplier–part tidak ditemukan di staging SAP.</EmptyState> : saved.map((row) => {
            const key = keyOf(row);
            return <Tr key={key}>
              <Td><div className="font-semibold">{row.supplierName ?? row.supplierId}</div><div className="mt-1 text-xs text-ink-muted">{row.supplierId}</div></Td>
              <Td><div className="font-semibold">{row.partNo}</div><div className="mt-1 text-xs text-ink-muted">{row.partName ?? 'Part belum tersedia'}</div>
                <div className="mt-1 text-xs text-ink-muted">{row.kanbanId === null ? 'Master kanban belum dibuat' : `Kanban #${row.kanbanId}`}</div>
                {row.blockedReason && <p className="mt-2 max-w-72 text-xs text-warn">{row.blockedReason}</p>}
              </Td>
              <Td>{row.backNo ?? '—'}</Td>
              <Td><div>{row.plant ?? '—'}</div><div className="mt-1 text-xs text-ink-muted">{row.slocTo ?? row.locations ?? '—'}</div></Td>
              <Td><div>{row.boxType ?? '—'}</div><div className="mt-1 text-xs text-ink-muted">{row.rack ?? '—'}</div></Td>
              <Td align="right">
                <span className="font-semibold tabular-nums">{row.qty?.toLocaleString('id-ID') ?? '—'}</span>
                <p className="mt-1 text-xs text-ink-muted">{row.uom ?? '—'}</p>
              </Td>
              <Td sticky="right"><button type="button" onClick={() => { setMessage(null); setEditing(row); }} disabled={!!row.blockedReason}
                aria-label={`Ubah qty per kanban ${row.supplierId} ${row.partNo}`}
                title={row.blockedReason ?? undefined}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line px-4 text-sm font-semibold transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
                <Pencil aria-hidden className="size-4" />Ubah
              </button></Td>
            </Tr>;
          })}
        </tbody>
      </Table>
      {editing && <SapKanbanForm row={editing} onClose={() => setEditing(null)} onSaved={(result) => {
        const key = keyOf(editing);
        setSaved((old) => old.map((candidate) => keyOf(candidate) === key
          ? { ...candidate, kanbanId: result.kanbanId, qty: result.qty } : candidate));
        setMessage(`${editing.partNo}: ${result.qty.toLocaleString('id-ID')} ${editing.uom ?? ''} per kanban tersimpan di staging.${result.localUpdated ? '' : ' Tarik master agar data tersedia untuk order di ARES.'}`);
        setEditing(null);
      }} />}
    </>
  );
}

function SapKanbanForm({ row, onClose, onSaved }: {
  row: SapKanbanMasterRow;
  onClose: () => void;
  onSaved: (result: SaveSapKanbanResult) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const qtyId = useId();
  const errorId = useId();
  const [value, setValue] = useState(String(row.qty ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const panel = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.showModal();
    return () => {
      panel.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function save() {
    if (pending) return;
    const qty = Number(value);
    if (!value.trim() || !Number.isInteger(qty) || qty < 1 || qty > 2_147_483_647) {
      setError('Isi qty per kanban dengan angka bulat minimal 1.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveSapKanbanAction({
        kanbanId: row.kanbanId, supplierId: row.supplierId, material: row.material,
        expectedQty: row.qty, qty,
      });
      if ('error' in result) { setError(result.error); return; }
      dialog.current?.close();
      onSaved(result);
    });
  }

  return <dialog ref={dialog} aria-labelledby={titleId} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
    onClick={(event) => {
      if (pending || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    className="fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-none w-full max-w-[520px] border-0 bg-shell p-0 text-ink shadow-shell backdrop:bg-black/40 backdrop:backdrop-blur-[2px]">
    <form onSubmit={(event) => { event.preventDefault(); save(); }} className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-4 border-b border-line px-6 py-5">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[19px] font-bold tracking-tight">Ubah qty per kanban</h2>
          <p className="mt-1 text-sm text-ink-muted">{row.kanbanId === null ? 'Tetapkan qty untuk membuat master kanban.' : `Kanban #${row.kanbanId}`}</p>
        </div>
        <button type="button" onClick={onClose} disabled={pending} aria-label="Tutup form"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <div className="scroll-slim min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
        <dl className="space-y-4 text-sm">
          <div><dt className="text-ink-muted">Supplier</dt><dd className="mt-1 font-semibold">{row.supplierName ?? row.supplierId}</dd><dd className="text-ink-muted">{row.supplierId}</dd></div>
          <div><dt className="text-ink-muted">Part</dt><dd className="mt-1 font-semibold">{row.partNo}</dd><dd className="text-ink-muted">{row.partName ?? '—'}</dd></div>
          <div className="grid grid-cols-2 gap-4">
            <div><dt className="text-ink-muted">Back no</dt><dd className="mt-1">{row.backNo ?? '—'}</dd></div>
            <div><dt className="text-ink-muted">Plant</dt><dd className="mt-1">{row.plant ?? '—'}</dd></div>
            <div className="col-span-2"><dt className="text-ink-muted">Lokasi</dt><dd className="mt-1 break-words">{row.slocTo ?? row.locations ?? '—'}</dd></div>
            <div><dt className="text-ink-muted">Kemasan</dt><dd className="mt-1">{row.boxType ?? '—'}</dd></div>
            <div><dt className="text-ink-muted">Rak</dt><dd className="mt-1">{row.rack ?? '—'}</dd></div>
          </div>
        </dl>
        <div className="border-t border-line pt-6">
          <label htmlFor={qtyId} className="block text-sm font-semibold">Qty per kanban <span className="text-ng">*</span></label>
          <div className="relative mt-2">
            <input id={qtyId} type="number" inputMode="numeric" required step={1} min={1} max={2_147_483_647}
              autoFocus value={value} disabled={pending} onChange={(event) => setValue(event.target.value)}
              aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
              className="h-12 w-full rounded-input border border-line bg-field pl-4 pr-16 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50" />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink-muted">{row.uom ?? ''}</span>
          </div>
          {error && <p id={errorId} role="alert" className="mt-3 text-sm text-ng">{error}</p>}
        </div>
      </div>
      <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
        <button type="button" onClick={onClose} disabled={pending} className="h-11 rounded-full px-5 text-sm font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">Batal</button>
        <button type="submit" disabled={pending} className="h-11 rounded-full bg-accent px-6 text-sm font-semibold text-white hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">{pending ? 'Menyimpan…' : 'Simpan'}</button>
      </footer>
    </form>
  </dialog>;
}
