'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, ClipboardList, LogOut, ScanLine } from 'lucide-react';
import { BrandMark } from './brand-mark';
import { cn } from '../ui/cn';

const WAREHOUSE_MENU = [
  { href: '/receiving', label: 'Receiving', icon: ScanLine, permission: 'receipt.read' },
  { href: '/stock', label: 'Stok WH', icon: Boxes, permission: 'stock.read' },
  { href: '/picklist', label: 'Order Sheet', icon: ClipboardList, permission: 'picklist.read' },
];

/** Kerangka handheld gudang: tetap satu kolom pada layar komputer maupun scanner. */
export function WarehouseFrame({
  userName,
  permissions,
  children,
}: {
  userName: string;
  permissions: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex h-dvh w-full max-w-[560px] flex-col border-x border-line bg-surface">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-shell px-4 py-3">
        <Link href="/receiving" aria-label="ARES Receiving" className="shrink-0">
          <BrandMark compact />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold">{userName}</div>
          <div className="text-[12px] text-ink-muted">Gudang · Receiving</div>
        </div>
        <form action="/api/logout" method="post">
          <button
            type="submit"
            aria-label="Keluar"
            title="Keluar"
            className="grid size-11 place-items-center rounded-full border border-line bg-card text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            <LogOut className="size-5" aria-hidden />
          </button>
        </form>
      </header>
      <main className="scroll-slim min-h-0 flex-1 overflow-y-auto">{children}</main>
      <nav
        aria-label="Menu gudang"
        className="flex shrink-0 border-t border-line bg-shell px-2 pb-[env(safe-area-inset-bottom)] pt-2"
      >
        {WAREHOUSE_MENU.filter((item) => permissions.includes(item.permission)).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[12px] font-semibold',
                active ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-card hover:text-ink',
              )}
            >
              <Icon className="size-5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
