'use client';

import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NAV_GROUPS, visibleGroups, type NavGroup } from './nav-config';
import { BrandMark } from './brand-mark';
import { initials } from './topbar';
import { usePreferences } from './preferences-provider';
import type { SidebarMode } from '@/lib/preferences';
import { iconFor } from '../ui/icon-map';
import { springSnappy, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

/** Lebar sidebar mode ikon; tooltip menempel di tepi kanannya. */
const RAIL_WIDTH = 76;

interface Tooltip {
  top: number;
  label: string;
}

/**
 * Navigasi utama.
 *
 * Pil hitam penanda menu aktif memakai `layoutId`, sehingga saat berpindah
 * halaman ia MELUNCUR dari posisi lama ke posisi baru alih-alih berkedip
 * hilang-muncul.
 *
 * Lipat/buka mengikuti pola Sentra: satu tombol di kepala sidebar
 * (PanelLeftClose/Open) yang mengubah preferensi `sidebar` — sama dengan
 * pilihan di panel pengaturan, jadi keduanya selalu sepakat dan diingat per
 * perangkat. Saat terlipat, tombolnya bersembunyi di balik huruf "A" dan
 * muncul ketika kepala sidebar disapu kursor; nama menu tampil sebagai
 * tooltip di tepi kanan rel.
 */
export function Sidebar({
  userName,
  role,
  groups = NAV_GROUPS,
  subtitle = 'e-Kanban Supplier',
  homeHref = '/dashboard',
  open = false,
  mode = 'penuh',
}: {
  userName: string;
  role: string | null;
  /** Menu yang ditampilkan; portal memakai daftar berbeda dengan kerangka sama. */
  groups?: NavGroup[];
  /** Baris kecil di bawah wordmark, mis. nama vendor untuk portal (PRD §10.2). */
  subtitle?: string;
  homeHref?: string;
  /** Hanya berlaku di bawah lg; di layar lebar sidebar selalu tampak. */
  open?: boolean;
  /** 'ikon' menyusutkan sidebar jadi deretan ikon saja. */
  mode?: SidebarMode;
}) {
  const pathname = usePathname();
  const { set } = usePreferences();
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const tooltipId = useId();

  /*
   * Mode ikon hanya berlaku saat sidebar menjadi bagian tetap tata letak.
   * Sebagai panel geser ia sudah menutupi halaman, jadi menyusutkannya tidak
   * memberi ruang apa pun — yang ada isinya malah jadi lebih sulit dikenali.
   */
  const ringkas = mode === 'ikon' && !open;

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    setTooltip(null);
    // Lepas fokus: kalau tetap di tombol, logo yang bersembunyi di baliknya
    // (mode ikon) tidak pernah muncul lagi sampai pengguna mengklik tempat lain.
    e.currentTarget.blur();
    set('sidebar', mode === 'ikon' ? 'penuh' : 'ikon');
  };
  const toggleLabel = mode === 'ikon' ? 'Buka sidebar' : 'Minimalkan sidebar';
  const ToggleIcon = mode === 'ikon' ? PanelLeftOpen : PanelLeftClose;

  const showTooltip = (el: HTMLElement, label: string) => {
    if (!ringkas) return;
    const r = el.getBoundingClientRect();
    setTooltip({ top: r.top + r.height / 2, label });
  };

  return (
    <aside
      /*
       * Di bawah lg: panel geser di atas isi halaman. Mulai lg: kembali
       * menjadi kolom biasa di dalam flex.
       *
       * Saat tertutup dipakai `invisible`, bukan sekadar digeser keluar layar.
       * Panel yang hanya digeser tetap ada di urutan Tab: menekan Tab dari
       * halaman akan memindahkan fokus ke menu yang tidak terlihat, dan
       * pengguna keyboard kehilangan jejak di mana fokusnya berada.
       * `visibility` ikut ditransisikan supaya animasi menutupnya tetap
       * terlihat — tanpa itu panel langsung lenyap alih-alih meluncur.
       */
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-line bg-shell',
        'transition-[transform,visibility,width] duration-300 ease-[var(--ease-out-soft)] motion-reduce:transition-none',
        // Lebar dasar selalu ada: mode ikon hanya berlaku mulai lg, karena di
        // bawah itu sidebar berperan sebagai panel geser.
        'w-[264px]',
        ringkas && 'lg:w-[76px]',
        'lg:visible lg:static lg:z-auto lg:translate-x-0 lg:shadow-none',
        open ? 'visible translate-x-0 shadow-shell' : 'invisible -translate-x-full',
      )}
    >
      {/* ── Kepala: wordmark + tombol lipat ─────────────────────────────── */}
      <div
        className={cn(
          // Setinggi topbar (76px) supaya garis bawah keduanya sejajar.
          'group/kepala relative flex h-[76px] shrink-0 items-center',
          ringkas ? 'justify-center px-0' : 'gap-2 pl-5 pr-3',
        )}
      >
        <Link
          href={homeHref}
          title="ARES"
          className={cn(
            'block min-w-0 flex-1',
            // Terlipat: logo minggir saat kepala disapu kursor atau tombolnya
            // difokus lewat keyboard — bukan setiap kali tombol punya fokus.
            ringkas &&
              'flex-none transition-[visibility] group-hover/kepala:invisible group-has-[button:focus-visible]/kepala:invisible',
          )}
        >
          <BrandMark compact={ringkas} tagline={subtitle} />
        </Link>

        {/*
         * Hanya di layar lebar: di bawah lg sidebar adalah panel geser dan
         * tombol tutupnya ada di topbar. Saat terlipat tombol ini menumpang
         * di tempat huruf "A" — tampak begitu kepala disapu atau difokus.
         */}
        <button
          type="button"
          onClick={toggle}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={mode !== 'ikon'}
          className={cn(
            'hidden size-9 shrink-0 place-items-center rounded-full text-ink-muted outline-none transition-[opacity,color,background-color] hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/20 lg:grid',
            ringkas &&
              'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/kepala:opacity-100 focus-visible:opacity-100',
          )}
        >
          <ToggleIcon className="size-[18px]" strokeWidth={1.8} aria-hidden />
        </button>
      </div>

      {/* Scrollbar-nya baru tampak saat sidebar disapu kursor (batang saja, tanpa panah). */}
      <nav className={cn('scroll-hover flex-1 overflow-y-auto pb-4', ringkas ? 'px-3' : 'px-4')}>
        {visibleGroups(
          groups === NAV_GROUPS && role !== 'admin' && role !== 'ppic'
            ? groups.filter((group) => group.title !== 'Setting' && group.title !== 'Master Data')
            : groups,
        ).map((group) => (
          <Group
            key={group.title}
            group={group}
            pathname={pathname}
            ringkas={ringkas}
            tooltipId={tooltip ? tooltipId : undefined}
            onEnter={showTooltip}
            onLeave={() => setTooltip(null)}
          />
        ))}
      </nav>

      {/*
       * Identitas pengguna — jangkar bawah sidebar, ada di kedua mode supaya
       * rel ikon tidak terlihat mengambang. Tombol Keluar ada di menu topbar.
       * Di mode ikon tinggal avatarnya; nama dan peran muncul sebagai tooltip.
       */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-3 border-t border-line py-4',
          ringkas ? 'justify-center px-0' : 'px-5',
        )}
        onPointerEnter={(e) => {
          if (ringkas && e.pointerType !== 'touch') {
            showTooltip(e.currentTarget, `${userName} · ${role ?? 'tanpa role'}`);
          }
        }}
        onPointerLeave={() => setTooltip(null)}
      >
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-bold text-white"
          aria-hidden={!ringkas}
          aria-label={ringkas ? `${userName}, ${role ?? 'tanpa role'}` : undefined}
        >
          {initials(userName)}
        </span>
        {ringkas ? null : (
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-bold leading-tight">{userName}</span>
            <span className="mt-0.5 block text-[12px] capitalize text-ink-muted">
              {role ?? 'tanpa role'}
            </span>
          </span>
        )}
      </div>

      {/*
       * Tooltip mode ikon dirender ke body: nav menggulir (overflow), jadi
       * apa pun yang dilebarkan ke kanan dari dalamnya akan terpotong.
       * `pl-3` menjembatani celah antara rel dan gelembung supaya kursor
       * yang menyeberang tidak membuatnya lenyap.
       */}
      {ringkas && tooltip
        ? createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              data-nav-tooltip
              className="a-fade pointer-events-auto fixed z-[60] hidden -translate-y-1/2 pl-3 lg:block"
              style={{ top: tooltip.top, left: RAIL_WIDTH - 12 }}
              onPointerLeave={() => setTooltip(null)}
            >
              <span className="block whitespace-nowrap rounded-xl bg-ink px-3.5 py-2 text-[13px] font-semibold text-card shadow-lift">
                {tooltip.label}
              </span>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}

function Group({
  group,
  pathname,
  ringkas,
  tooltipId,
  onEnter,
  onLeave,
}: {
  group: NavGroup;
  pathname: string;
  ringkas: boolean;
  tooltipId?: string;
  onEnter: (el: HTMLElement, label: string) => void;
  onLeave: () => void;
}) {
  const hasActive = group.items.some((i) => isActive(pathname, i.href));
  // Grup yang dilipat tetap terbuka kalau salah satu isinya sedang aktif —
  // pengguna tidak boleh kehilangan jejak posisinya setelah berpindah halaman.
  const [open, setOpen] = useState(!group.collapsible || hasActive);

  /*
   * Dalam mode ikon, grup yang bisa dilipat ditampilkan terbuka begitu saja.
   * Judul grupnya tidak muat, dan tombol lipat tanpa judul hanya menyisakan
   * anak panah yang tidak menjelaskan apa pun. Pemisah tipis sudah cukup
   * menandai bahwa kelompoknya berganti.
   */
  const terbuka = ringkas ? true : open;

  return (
    <div
      className={cn('mb-5', ringkas && 'mb-3 border-t border-line pt-3 first:border-0 first:pt-0')}
    >
      {ringkas ? null : group.collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          {group.title}
          <motion.span
            animate={{ rotate: open ? 0 : -90 }}
            transition={{ duration: durations.base, ease: easeSoft }}
          >
            <ChevronDown className="size-3.5" strokeWidth={2.2} aria-hidden />
          </motion.span>
        </button>
      ) : (
        <div className="px-3 pb-2 text-[12px] font-semibold text-ink-muted">{group.title}</div>
      )}

      <AnimatePresence initial={false}>
        {terbuka ? (
          <motion.ul
            initial={group.collapsible && !ringkas ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="space-y-0.5 overflow-hidden pt-1"
          >
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = iconFor(item.icon);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    // Tanpa teks, nama menu harus tetap sampai ke pembaca layar.
                    aria-label={ringkas ? item.label : undefined}
                    aria-describedby={ringkas ? tooltipId : undefined}
                    onClick={onLeave}
                    onPointerEnter={(e) => {
                      if (e.pointerType !== 'touch') onEnter(e.currentTarget, item.label);
                    }}
                    onPointerLeave={(e) => {
                      // Menyeberang ke gelembungnya sendiri bukan alasan menutup.
                      const ke = e.relatedTarget;
                      if (!(ke instanceof Element) || !ke.closest('[data-nav-tooltip]')) onLeave();
                    }}
                    onFocus={(e) => onEnter(e.currentTarget, item.label)}
                    onBlur={onLeave}
                    data-nav-link
                    className={cn(
                      'group relative flex items-center rounded-lg py-2.5',
                      'text-[14px] font-semibold outline-none',
                      'focus-visible:ring-2 focus-visible:ring-ink/20',
                      ringkas ? 'justify-center px-0' : 'gap-3 px-3.5',
                      active ? 'text-white' : 'text-ink-soft hover:text-ink',
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="nav-pill"
                        transition={springSnappy}
                        className="absolute inset-0 rounded-lg bg-accent"
                      />
                    ) : (
                      <span className="absolute inset-0 rounded-lg bg-transparent transition-colors duration-200 group-hover:bg-surface" />
                    )}
                    <Icon
                      className="sidebar-nav-icon relative size-[18px] shrink-0"
                      strokeWidth={active ? 2 : 1.7}
                      aria-hidden
                    />
                    {ringkas ? null : <span className="relative">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
