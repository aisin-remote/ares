'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from './cn';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

/**
 * Pilihan dengan kotak pencarian — pengganti Select2.
 *
 * Sebelumnya layar ini memakai jQuery + Select2 hanya untuk menambahkan
 * pencarian di atas `<select>`. Dua pustaka itu 178 KB setelah diminifikasi,
 * 16% dari seluruh JavaScript aplikasi, untuk perilaku yang muat dalam satu
 * berkas — persis yang dilarang aturan 12 di CLAUDE.md. Perilakunya dipertahankan
 * sama persis: satu pilihan, bisa dicari, bisa dikosongkan bila tidak wajib.
 *
 * Daftarnya dirender lewat portal ke `document.body` dengan `position: fixed`.
 * Panel geser master memakai `overflow-y-auto` dan animasi `transform`; di
 * dalamnya, elemen `absolute` akan terpotong tepi panel dan elemen `fixed` pun
 * ikut terkurung karena `transform` membuat containing block baru. Portal
 * melepaskannya dari kedua masalah itu sekaligus.
 *
 * ponytail: pencocokan pakai `includes` biasa, cukup sampai ribuan opsi
 * (kapasitas PRD §9 = 3.000 vendor part). Kalau daftarnya tumbuh jauh di atas
 * itu, saring di server lewat parameter `q` alih-alih mengirim semuanya.
 */
export function SelectSearch({
  id,
  name,
  options,
  value,
  defaultValue,
  placeholder = '— pilih —',
  ariaLabel,
  required = false,
  disabled = false,
  pill = false,
  onValueChange,
}: {
  id?: string;
  name?: string;
  options: readonly SelectOption[];
  /** Diisi → terkendali; dibiarkan kosong → komponen menyimpan pilihannya sendiri. */
  value?: string | number;
  defaultValue?: string | number;
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
  disabled?: boolean;
  pill?: boolean;
  onValueChange?: (value: string) => void;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(String(defaultValue ?? ''));
  const current = controlled ? String(value) : inner;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; atas: boolean }>({
    left: 0,
    top: 0,
    width: 0,
    atas: false,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((option) => String(option.value) === current);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((option) => option.label.toLowerCase().includes(q)) : [...options];
  }, [options, query]);

  const ukur = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Muat ke bawah bila ada ruang; kalau tidak, balik ke atas pemicu.
    const atas = r.bottom + 300 > window.innerHeight && r.top > window.innerHeight - r.bottom;
    setBox({
      left: r.left,
      top: atas ? r.top : r.bottom + 4,
      width: r.width,
      atas,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) ukur();
  }, [open, ukur]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const tutupDiLuar = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Capture supaya ikut menangkap gulir kontainer mana pun, bukan hanya window.
    const ikut = () => ukur();
    document.addEventListener('pointerdown', tutupDiLuar);
    window.addEventListener('scroll', ikut, true);
    window.addEventListener('resize', ikut);
    return () => {
      document.removeEventListener('pointerdown', tutupDiLuar);
      window.removeEventListener('scroll', ikut, true);
      window.removeEventListener('resize', ikut);
    };
  }, [open, ukur]);

  function buka() {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, options.findIndex((option) => String(option.value) === current)));
    setOpen(true);
  }

  function pilih(option: SelectOption) {
    if (option.disabled) return;
    const next = String(option.value);
    if (!controlled) setInner(next);
    setOpen(false);
    triggerRef.current?.focus();
    onValueChange?.(next);
  }

  function kosongkan() {
    if (!controlled) setInner('');
    onValueChange?.('');
  }

  function tombolDaftar(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filtered.length) return;
      const arah = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + arah + filtered.length) % filtered.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[active];
      if (option) pilih(option);
    }
  }

  const tinggi = pill ? 'h-11' : 'h-11';
  const radius = pill ? 'rounded-full' : 'rounded-2xl';

  return (
    <div className="relative min-w-0">
      {/* Pembawa nilai untuk <form>; tombol di atas tidak ikut terkirim. */}
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : buka())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            buka();
          }
        }}
        className={cn(
          'flex w-full items-center gap-2 border border-line bg-surface pl-4 text-left text-[15px]',
          'outline-none transition-colors duration-200 hover:border-line-strong',
          'focus-visible:border-line-strong focus-visible:bg-card disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-line-strong bg-card',
          tinggi,
          radius,
          !required && current ? 'pr-2' : 'pr-3',
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-ink-muted')}>
          {selected?.label ?? placeholder}
        </span>
        {!required && current ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Kosongkan pilihan"
            onClick={(e) => {
              e.stopPropagation();
              kosongkan();
            }}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-line hover:text-ink"
          >
            <X className="size-3.5" strokeWidth={2.2} aria-hidden />
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-ink-muted transition-transform duration-200',
            open && 'rotate-180',
          )}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {open
        ? createPortal(
            <div
              ref={popupRef}
              style={{
                left: box.left,
                width: box.width,
                ...(box.atas
                  ? { bottom: window.innerHeight - box.top + 4 }
                  : { top: box.top }),
              }}
              className="a-rise fixed z-[80] overflow-hidden rounded-2xl border border-line-strong bg-card shadow-lift"
              onKeyDown={tombolDaftar}
            >
              <div className="border-b border-line p-2">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  type="search"
                  aria-label="Cari pilihan"
                  aria-controls={listId}
                  placeholder="Cari…"
                  className="h-9 w-full rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-line-strong focus:bg-card"
                />
              </div>
              <ul
                id={listId}
                role="listbox"
                aria-label={ariaLabel ?? placeholder}
                className="scroll-slim max-h-64 overflow-y-auto py-1"
              >
                {filtered.length ? (
                  filtered.map((option, i) => {
                    const dipilih = String(option.value) === current;
                    return (
                      <li
                        key={String(option.value)}
                        role="option"
                        aria-selected={dipilih}
                        aria-disabled={option.disabled}
                        ref={
                          i === active
                            ? (el) => el?.scrollIntoView({ block: 'nearest' })
                            : undefined
                        }
                        onMouseEnter={() => setActive(i)}
                        // pointerdown, bukan click: pointerdown di luar tidak boleh
                        // menutup daftar sebelum pilihannya terbaca.
                        onPointerDown={(e) => {
                          e.preventDefault();
                          pilih(option);
                        }}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 px-3 py-2 text-[14px]',
                          option.disabled && 'cursor-not-allowed opacity-45',
                          i === active && !option.disabled && 'bg-surface',
                          dipilih && 'font-semibold',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {dipilih ? (
                          <Check className="size-4 shrink-0" strokeWidth={2.4} aria-hidden />
                        ) : null}
                      </li>
                    );
                  })
                ) : (
                  <li className="px-3 py-3 text-[14px] text-ink-muted">Tidak ada hasil</li>
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
