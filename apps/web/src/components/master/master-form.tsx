'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertCircle, Check } from 'lucide-react';
import type { EntityDef, FieldDef, MasterEntity } from '@ares/contracts';
import { saveMasterAction, type FormState } from '@/app/(app)/master/actions';
import { durations, easeSoft, springSoft } from '../motion/transitions';
import { cn } from '../ui/cn';
import { SelectSearch } from '../ui/select-search';
import { useFeedback } from '../ui/feedback-provider';

export type RefOptions = Record<
  string,
  Array<{ value: number; label: string; short?: string; key?: string }>
>;

const initial: FormState = {};

/**
 * Panel geser untuk membuat atau mengubah data master.
 *
 * Isinya dibangun dari definisi entitas, jadi satu komponen ini melayani
 * seluruh entitas master. Menambah kolom di registry langsung memunculkan
 * inputnya di sini tanpa perubahan kode.
 *
 * Panel geser dipilih daripada halaman terpisah supaya konteks daftar tetap
 * terlihat di belakangnya — operator tidak kehilangan tempatnya saat menyunting
 * satu baris di antara puluhan.
 *
 * Dirender lewat portal ke document.body. position:fixed mengacu pada
 * containing block terdekat, dan leluhur mana pun yang punya transform, filter,
 * atau perspective akan menjadi containing block itu — membuat panel terkurung
 * di dalam kotak leluhur alih-alih memenuhi layar. Portal melepaskannya dari
 * seluruh pohon DOM halaman sehingga masalah itu tidak bisa terjadi lagi,
 * termasuk oleh pembungkus yang ditambahkan di kemudian hari.
 */
export function MasterForm({
  def,
  entity,
  row,
  options,
  open,
  onClose,
}: {
  def: EntityDef;
  entity: MasterEntity;
  row?: (Record<string, unknown> & { id: number }) | null;
  options: RefOptions;
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveMasterAction, initial);
  const router = useRouter();
  const feedback = useFeedback();
  const handled = useRef(false);
  const titleId = useId();
  const isEdit = Boolean(row);
  const supplierRoleId = options.roles?.find((option) => option.key === 'supplier')?.value;
  const [selectedRoleId, setSelectedRoleId] = useState(String(row?.roleId ?? ''));
  const isSupplierAccount =
    entity === 'users' &&
    supplierRoleId !== undefined &&
    selectedRoleId === String(supplierRoleId);
  // Portal hanya bisa dibuat setelah komponen hidup di browser; saat render
  // di server document belum ada.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (state.ok && !handled.current) {
      handled.current = true;
      feedback.success(
        isEdit ? `${def.singular} berhasil diperbarui` : `${def.singular} berhasil ditambahkan`,
      );
      onClose();
      router.refresh();
    }
  }, [state.ok, isEdit, def.singular, feedback, onClose, router]);

  // Esc menutup panel — jalan pintas yang diharapkan ada pada panel semacam ini.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Kunci gulir halaman selama panel terbuka, supaya latar tidak ikut bergeser
  // saat pengguna menggulir isi formulir.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.button
            type="button"
            aria-label="Tutup"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]"
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={springSoft}
            className="relative flex h-full w-full max-w-[520px] flex-col bg-shell shadow-shell"
          >
            <header className="flex items-start gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-[19px] font-bold tracking-tight">
                  {isEdit ? `Ubah ${def.singular}` : `Tambah ${def.singular}`}
                </h2>
                <p className="mt-1 text-[13px] text-ink-muted">{def.description}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup"
                className="grid size-9 shrink-0 place-items-center rounded-full border border-line transition-colors hover:bg-surface"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
              </button>
            </header>

            <form action={formAction} className="flex min-h-0 flex-1 flex-col">
              <input type="hidden" name="__entity" value={entity} />
              <input type="hidden" name="__id" value={row?.id ?? ''} />

              <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-6 py-6">
                {state.error && !state.fieldErrors ? (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-2xl border border-ng/25 bg-ng/8 px-4 py-3 text-[14px] text-ng"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
                    {state.error}
                  </p>
                ) : null}

                {def.fields.map((field) => {
                  if (entity === 'users' && field.name === 'vendorId' && !isSupplierAccount) {
                    return <input key={field.name} type="hidden" name={field.name} value="" />;
                  }
                  if (entity === 'users' && field.name === 'plantId' && isSupplierAccount) {
                    return <input key={field.name} type="hidden" name={field.name} value="" />;
                  }
                  return (
                    <Field
                      key={field.name}
                      field={
                        entity === 'users' && field.name === 'vendorId'
                          ? { ...field, required: true }
                          : field
                      }
                      value={row?.[field.name]}
                      options={options[field.refEntity ?? ''] ?? []}
                      error={state.fieldErrors?.[field.name]}
                      isEdit={isEdit}
                      onValueChange={field.name === 'roleId' ? setSelectedRoleId : undefined}
                    />
                  );
                })}
              </div>

              <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 rounded-full px-5 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                >
                  Batal
                </button>
                <motion.button
                  type="submit"
                  disabled={pending}
                  whileTap={pending ? undefined : { scale: 0.97 }}
                  transition={{ duration: durations.fast, ease: easeSoft }}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-60"
                >
                  {pending ? (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                      className="size-4 rounded-full border-2 border-white/30 border-t-white"
                    />
                  ) : (
                    <Check className="size-4" strokeWidth={2.4} aria-hidden />
                  )}
                  {pending ? 'Menyimpan' : 'Simpan'}
                </motion.button>
              </footer>
            </form>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

const inputClass =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

function Field({
  field,
  value,
  options,
  error,
  isEdit,
  onValueChange,
}: {
  field: FieldDef;
  value: unknown;
  options: Array<{ value: number; label: string; short?: string; key?: string }>;
  error?: string;
  isEdit: boolean;
  onValueChange?: (value: string) => void;
}) {
  const id = useId();
  const [checked, setChecked] = useState(
    value === undefined ? Boolean(field.defaultValue) : Boolean(value),
  );

  if (field.kind === 'boolean') {
    return (
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={id}
          onClick={() => setChecked((v) => !v)}
          className={cn(
            'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
            checked ? 'bg-ok' : 'bg-line-strong',
          )}
        >
          <motion.span
            layout
            transition={springSoft}
            className={cn(
              'absolute top-0.5 size-5 rounded-full bg-white shadow-sm',
              checked ? 'right-0.5' : 'left-0.5',
            )}
          />
        </button>
        {checked ? <input type="hidden" name={field.name} value="on" /> : null}
        <div className="min-w-0">
          <label id={id} className="block text-[14px] font-semibold">
            {field.label}
          </label>
          {field.hint ? (
            <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{field.hint}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14px] font-semibold">
        {field.label}
        {field.required && !(isEdit && field.kind === 'password') ? (
          <span className="ml-1 text-ng">*</span>
        ) : null}
      </label>

      {field.kind === 'select' ? (
        <SelectSearch
          id={id}
          name={field.name}
          required={field.required && !isEdit}
          defaultValue={
            value === undefined || value === null ? String(field.defaultValue ?? '') : String(value)
          }
          options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
        />
      ) : field.kind === 'reference' ? (
        <SelectSearch
          id={id}
          name={field.name}
          required={field.required && !isEdit}
          defaultValue={value === undefined || value === null ? '' : String(value)}
          options={options}
          onValueChange={onValueChange}
        />
      ) : (
        <input
          id={id}
          name={field.name}
          required={field.required && !isEdit}
          type={
            field.kind === 'number' || field.kind === 'decimal'
              ? 'number'
              : field.kind === 'date'
                ? 'date'
                : field.kind === 'time'
                  ? 'time'
                  : field.kind === 'password'
                    ? 'password'
                    : 'text'
          }
          step={field.kind === 'decimal' ? 'any' : undefined}
          inputMode={
            field.kind === 'number' ? 'numeric' : field.kind === 'decimal' ? 'decimal' : undefined
          }
          autoComplete={field.kind === 'password' ? 'new-password' : undefined}
          min={field.min}
          maxLength={field.kind === 'text' || field.kind === 'password' ? field.max : undefined}
          defaultValue={
            field.kind === 'password'
              ? ''
              : value === undefined || value === null
                ? field.defaultValue !== undefined && !Number.isNaN(field.defaultValue)
                  ? String(field.defaultValue)
                  : ''
                : String(value)
          }
          className={inputClass}
        />
      )}

      {error ? (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ng">
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : field.hint ? (
        <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{field.hint}</p>
      ) : null}
    </div>
  );
}
