export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Fase rilis PRD §12 tempat halaman ini hidup; kosong = fase 1. */
  phase?: 1 | 2 | 3;
}

/**
 * Fase yang sedang dirilis (NEXT_PUBLIC_ARES_PHASE, bawaan 1). Sidebar hanya
 * menampilkan item dengan phase ≤ nilai ini; rutenya sendiri tetap bisa dibuka
 * lewat URL, jadi halaman fase berikutnya bisa dicoba tanpa muncul di menu
 * operator. Dev boleh 2.
 */
export const ARES_PHASE = (() => {
  const n = Number(process.env.NEXT_PUBLIC_ARES_PHASE ?? 1);
  return n === 2 || n === 3 ? n : 1;
})();

/** Item yang boleh tampil pada fase sekarang; grup kosong ikut hilang. */
export function visibleGroups(groups: NavGroup[], phase: number = ARES_PHASE): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => (i.phase ?? 1) <= phase) }))
    .filter((g) => g.items.length > 0);
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  collapsible?: boolean;
}

/**
 * Menu sidebar (app) — PRD bagian 10.2.
 *
 * Ikon = nama komponen lucide-react, dipetakan di ui/icon-map.ts. Halaman
 * yang belum ada tetap tercantum supaya kerangka navigasinya terlihat utuh;
 * Next menampilkan 404 sampai halamannya dibuat.
 */
/**
 * Menu portal supplier (PRD §10.2).
 *
 * Sengaja pendek: supplier hanya mengurus ordernya sendiri, dan menu panjang
 * di layar kantor supplier justru membuat "order baru" sulit ditemukan.
 */
export const PORTAL_NAV_GROUPS: NavGroup[] = [
  {
    title: 'Order',
    items: [
      { href: '/portal', label: 'Order berjalan', icon: 'ClipboardList' },
      { href: '/portal/riwayat', label: 'Riwayat', icon: 'BarChart3' },
    ],
  },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operasi',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
      { href: '/queue', label: 'Antrean Order', icon: 'ListOrdered', phase: 2 },
      { href: '/picklist', label: 'Picklist', icon: 'ClipboardList' },
      // Sesi yang sedang berjalan; halaman yang sama dengan Penerimaan, tersaring OPEN.
      { href: '/receiving?status=OPEN', label: 'Sesi Scan', icon: 'ScanLine' },
    ],
  },
  {
    title: 'Logistik',
    items: [
      { href: '/receiving', label: 'Penerimaan', icon: 'Truck' },
      { href: '/stock', label: 'Stok WH', icon: 'Boxes', phase: 2 },
      { href: '/consumption', label: 'Konsumsi', icon: 'Factory', phase: 2 },
    ],
  },
  {
    title: 'Integrasi',
    items: [
      { href: '/sap', label: 'SAP Outbox', icon: 'Share2' },
      { href: '/mes', label: 'Sinkron MES', icon: 'RefreshCw', phase: 2 },
    ],
  },
  {
    title: 'Laporan',
    items: [
      { href: '/reports/arrival', label: 'Kedatangan', icon: 'BarChart3', phase: 3 },
      {
        href: '/reports/consumption',
        label: 'Konsumsi & Order',
        icon: 'FileSpreadsheet',
        phase: 3,
      },
    ],
  },
  {
    title: 'Setting',
    items: [
      { href: '/settings/cutoff', label: 'Cutoff Supplier', icon: 'Clock' },
      { href: '/settings/policy', label: 'Kebijakan', icon: 'SlidersHorizontal' },
      { href: '/settings/holiday', label: 'Kalender Libur', icon: 'CalendarDays' },
    ],
  },
  {
    title: 'Master Data',
    collapsible: true,
    items: [
      { href: '/master/vendors', label: 'Supplier', icon: 'Building2' },
      { href: '/master/parts', label: 'Part', icon: 'Package' },
      { href: '/master/vendorParts', label: 'Vendor Part', icon: 'PackageSearch' },
      { href: '/master/bom', label: 'BOM', icon: 'GitBranch' },
      { href: '/master/users', label: 'User & Peran', icon: 'Users' },
    ],
  },
];
