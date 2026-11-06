'use client';

import { useEffect, useId, useState } from 'react';
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

const RAIL_WIDTH = 76;
const GROUP_ICONS: Record<string, string> = {
  Operasional: 'LayoutDashboard',
  Order: 'ClipboardList',
  Data: 'PackageSearch',
  Laporan: 'BarChart3',
  Setting: 'SlidersHorizontal',
  Logistik: 'Truck',
  Integrasi: 'Share2',
  'Master Data': 'Database',
};

interface Tooltip {
  top: number;
  label: string;
}

interface RailMenu {
  top: number;
  maxHeight: number;
  group: NavGroup;
}

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
  const [railMenu, setRailMenu] = useState<RailMenu | null>(null);
  const tooltipId = useId();
  const railMenuId = useId();
  const ringkas = mode === 'ikon' && !open;
  const menuGroups = visibleGroups(
    groups === NAV_GROUPS && role !== 'admin' && role !== 'ppic'
      ? groups.filter((group) => group.title !== 'Setting' && group.title !== 'Master Data')
      : groups,
  );
  const activeHref = menuGroups
    .flatMap((group) => group.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  useEffect(() => {
    setRailMenu(null);
    setTooltip(null);
  }, [pathname, ringkas]);

  useEffect(() => {
    if (!railMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRailMenu(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [railMenu]);

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    setTooltip(null);
    e.currentTarget.blur();
    set('sidebar', mode === 'ikon' ? 'penuh' : 'ikon');
  };
  const toggleLabel = mode === 'ikon' ? 'Buka sidebar' : 'Minimalkan sidebar';
  const ToggleIcon = mode === 'ikon' ? PanelLeftOpen : PanelLeftClose;

  const showTooltip = (el: HTMLElement, label: string) => {
    if (!ringkas) return;
    const rect = el.getBoundingClientRect();
    const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
    setTooltip({ top: (rect.top + rect.height / 2) / zoom, label });
  };

  const showRailMenu = (el: HTMLElement, group: NavGroup) => {
    if (!ringkas) return;
    const rect = el.getBoundingClientRect();
    // Portal ke body ikut zoom halaman; koordinat viewport perlu dikembalikan ke ukuran CSS.
    const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
    const top = Math.max(12, rect.top / zoom);
    setTooltip(null);
    setRailMenu({ top, maxHeight: window.innerHeight / zoom - top - 12, group });
  };

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-[264px] shrink-0 flex-col border-r border-line bg-shell',
        'transition-[transform,visibility,width] duration-300 ease-[var(--ease-out-soft)] motion-reduce:transition-none',
        ringkas && 'lg:w-[76px]',
        'lg:visible lg:static lg:z-auto lg:translate-x-0 lg:shadow-none',
        open ? 'visible translate-x-0 shadow-shell' : 'invisible -translate-x-full',
      )}
    >
      <div
        className={cn(
          'group/kepala relative flex h-[76px] shrink-0 items-center',
          ringkas ? 'justify-center px-0' : 'gap-2 pl-5 pr-3',
        )}
      >
        <Link
          href={homeHref}
          title="ARES"
          className={cn(
            'block min-w-0 flex-1',
            ringkas &&
              'flex-none transition-[visibility] group-hover/kepala:invisible group-has-[button:focus-visible]/kepala:invisible',
          )}
        >
          <BrandMark compact={ringkas} tagline={subtitle} />
        </Link>

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

      <nav className={cn('scroll-hover flex-1 overflow-y-auto pb-4', ringkas ? 'px-3' : 'px-4')}>
        {menuGroups.length === 0 ? (
          <p className={cn('text-[13px] text-ink-muted', ringkas ? 'px-1 text-center' : 'px-3')}>
            {ringkas ? '—' : 'Belum ada menu untuk role Anda. Hubungi administrator.'}
          </p>
        ) : (
          menuGroups.map((group) => (
            <Group
              key={group.title}
              group={group}
              activeHref={activeHref}
              ringkas={ringkas}
              railMenuId={railMenuId}
              railOpen={railMenu?.group.title === group.title}
              onOpenRail={showRailMenu}
              onCloseRail={() => setRailMenu(null)}
            />
          ))
        )}
      </nav>

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
            <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
              {role ?? 'tanpa role'}
            </span>
          </span>
        )}
      </div>

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

      {ringkas && railMenu
        ? createPortal(
            <AnimatePresence>
              <motion.div
                id={railMenuId}
                key={railMenu.group.title}
                role="menu"
                data-nav-flyout
                initial={{ opacity: 0, x: -10, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -8, scale: 0.98 }}
                transition={{ duration: durations.fast, ease: easeSoft }}
                className="fixed z-[60] hidden min-w-[220px] origin-left pl-3 lg:block"
                style={{ top: railMenu.top, left: RAIL_WIDTH - 12, maxHeight: railMenu.maxHeight }}
                onPointerLeave={(e) => {
                  if (!isNavOverlay(e.relatedTarget)) setRailMenu(null);
                }}
                onBlur={(e) => {
                  if (!isNavOverlay(e.relatedTarget)) setRailMenu(null);
                }}
              >
                <div
                  className="scroll-hover overflow-y-auto rounded-2xl border border-line bg-shell p-2 shadow-lift"
                  style={{ maxHeight: railMenu.maxHeight }}
                >
                  <div className="px-3 pb-2 pt-1.5 text-[14px] font-bold text-ink">
                    {railMenu.group.title}
                  </div>
                  <ul className="relative ml-3 py-0.5 pl-4">
                    {railMenu.group.items.map((item) => {
                      const active = activeHref === item.href;
                      return (
                        <li
                          key={item.href}
                          className="relative before:pointer-events-none before:absolute before:-left-4 before:top-0 before:h-1/2 before:w-4 before:rounded-bl-lg before:border-b before:border-l before:border-line before:content-[''] after:pointer-events-none after:absolute after:-left-4 after:bottom-0 after:top-1/2 after:border-l after:border-line after:content-[''] last:after:hidden"
                        >
                          <Link
                            href={item.href}
                            role="menuitem"
                            aria-current={active ? 'page' : undefined}
                            onClick={() => setRailMenu(null)}
                            className={cn(
                              'relative block rounded-lg px-3 py-2.5 text-[13px] outline-none transition-colors',
                              'focus-visible:ring-2 focus-visible:ring-ink/20',
                              active
                                ? 'bg-surface font-bold text-ink'
                                : 'font-medium text-ink-soft hover:bg-surface hover:text-ink',
                            )}
                          >
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </motion.div>
            </AnimatePresence>,
            document.body,
          )
        : null}
    </aside>
  );
}

function Group({
  group,
  activeHref,
  ringkas,
  railMenuId,
  railOpen,
  onOpenRail,
  onCloseRail,
}: {
  group: NavGroup;
  activeHref?: string;
  ringkas: boolean;
  railMenuId: string;
  railOpen: boolean;
  onOpenRail: (el: HTMLElement, group: NavGroup) => void;
  onCloseRail: () => void;
}) {
  const hasActive = group.items.some((item) => activeHref === item.href);
  const [open, setOpen] = useState(!group.collapsible || hasActive);
  const groupId = useId();

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);
  const GroupIcon = iconFor(GROUP_ICONS[group.title] ?? 'Database');

  const closeRailIfOutside = (target: EventTarget | null) => {
    if (!isNavOverlay(target)) onCloseRail();
  };

  return (
    <div className={cn('mb-1.5', ringkas && 'mb-1')}>
      <button
        type="button"
        data-nav-link
        data-nav-rail-trigger={ringkas ? '' : undefined}
        onClick={(e) => {
          if (ringkas) {
            onOpenRail(e.currentTarget, group);
          } else if (group.collapsible) {
            setOpen((value) => !value);
          }
        }}
        onPointerEnter={(e) => {
          if (ringkas && e.pointerType !== 'touch') onOpenRail(e.currentTarget, group);
        }}
        onPointerLeave={(e) => closeRailIfOutside(e.relatedTarget)}
        onFocus={(e) => {
          if (ringkas) onOpenRail(e.currentTarget, group);
        }}
        onBlur={(e) => closeRailIfOutside(e.relatedTarget)}
        aria-label={ringkas ? group.title : undefined}
        aria-controls={ringkas ? railMenuId : groupId}
        aria-expanded={ringkas ? railOpen : open}
        className={cn(
          'group relative flex w-full items-center rounded-xl outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-ink/20',
          ringkas ? 'size-[52px] justify-center' : 'justify-between px-3.5 py-2.5',
          ringkas && hasActive
            ? 'bg-accent text-white shadow-lift'
            : (ringkas && railOpen) || (!ringkas && (open || hasActive))
              ? 'bg-surface text-ink'
              : 'text-ink-soft hover:bg-surface hover:text-ink',
        )}
      >
        <span className={cn('relative flex items-center', ringkas ? 'justify-center' : 'gap-3')}>
          <GroupIcon
            className="sidebar-nav-icon size-[18px] shrink-0"
            strokeWidth={hasActive ? 2 : 1.7}
            aria-hidden
          />
          {ringkas ? null : <span className="text-[14px] font-bold">{group.title}</span>}
        </span>
        {ringkas || !group.collapsible ? null : (
          <motion.span
            animate={{ rotate: open ? 0 : -90 }}
            transition={{ duration: durations.base, ease: easeSoft }}
          >
            <ChevronDown className="size-3.5" strokeWidth={2.2} aria-hidden />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {!ringkas && open ? (
          <motion.div
            id={groupId}
            initial={group.collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="overflow-hidden"
          >
            <ul className="relative mb-2 ml-[22px] mt-1 py-0.5 pl-5">
              {group.items.map((item) => {
                const active = activeHref === item.href;
                return (
                  <li
                    key={item.href}
                    className="relative before:pointer-events-none before:absolute before:-left-5 before:top-0 before:h-1/2 before:w-5 before:rounded-bl-lg before:border-b before:border-l before:border-line before:content-[''] after:pointer-events-none after:absolute after:-left-5 after:bottom-0 after:top-1/2 after:border-l after:border-line after:content-[''] last:after:hidden"
                  >
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      data-nav-link
                      className={cn(
                        'group relative block rounded-lg px-3 py-2 text-[13px] outline-none',
                        'focus-visible:ring-2 focus-visible:ring-ink/20',
                        active ? 'font-bold text-ink' : 'font-medium text-ink-soft hover:text-ink',
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="nav-pill"
                          transition={springSnappy}
                          className="absolute inset-0 rounded-lg bg-surface"
                        />
                      ) : (
                        <span className="absolute inset-0 rounded-lg bg-transparent transition-colors duration-200 group-hover:bg-surface" />
                      )}
                      <span className="relative">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function isNavOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('[data-nav-flyout],[data-nav-rail-trigger]'))
  );
}
