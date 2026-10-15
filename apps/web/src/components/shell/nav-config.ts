export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Fase rilis PRD §12 tempat halaman ini hidup; kosong = fase 1. */
  phase?: 1 | 2 | 3;
  permission?: string;
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

export function authorizedGroups(groups: NavGroup[], permissions: string[]): NavGroup[] {
  const allowed = new Set(permissions);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || allowed.has(item.permission)),
    }))
    .filter((group) => group.items.length > 0);
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
  {
    title: 'Data',
    items: [
      // Atribut kemasan yang tercetak di kanban; qty/box tetap diatur PPIC (F-02).
      {
        href: '/portal/vendor-part',
        label: 'Vendor part',
        icon: 'PackageSearch',
        permission: 'vendorPart.self',
      },
    ],
  },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operasi',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: 'LayoutDashboard',
        permission: 'picklist.read',
      },
      {
        href: '/queue',
        label: 'Antrean Order',
        icon: 'ListOrdered',
        phase: 2,
        permission: 'queue.write',
      },
      {
        href: '/picklist',
        label: 'Order Sheet',
        icon: 'ClipboardList',
        permission: 'picklist.read',
      },
    ],
  },
  {
    title: 'Logistik',
    items: [
      { href: '/receiving', label: 'Receiving', icon: 'Truck', permission: 'receipt.read' },
      { href: '/stock', label: 'Stok WH', icon: 'Boxes', phase: 2, permission: 'stock.read' },
      {
        href: '/consumption',
        label: 'Konsumsi',
        icon: 'Factory',
        phase: 2,
        permission: 'mes.read',
      },
    ],
  },
  {
    title: 'Integrasi',
    items: [
      { href: '/sap', label: 'SAP Outbox', icon: 'Share2', permission: 'outbox.read' },
      { href: '/mes', label: 'Sinkron MES', icon: 'RefreshCw', phase: 2, permission: 'mes.read' },
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
      {
        href: '/settings/cutoff',
        label: 'Cutoff Supplier',
        icon: 'Clock',
        permission: 'setting.write',
      },
      {
        href: '/settings/policy',
        label: 'Kebijakan',
        icon: 'SlidersHorizontal',
        permission: 'setting.write',
      },
      {
        href: '/settings/holiday',
        label: 'Kalender Libur',
        icon: 'CalendarDays',
        permission: 'setting.write',
      },
    ],
  },
  {
    title: 'Master Data',
    collapsible: true,
    items: [
      { href: '/master/vendors', label: 'Supplier', icon: 'Building2', permission: 'master.read' },
      { href: '/master/parts', label: 'Part', icon: 'Package', permission: 'master.read' },
      {
        href: '/master/vendorParts',
        label: 'Vendor Part',
        icon: 'PackageSearch',
        permission: 'master.read',
      },
      { href: '/master/bom', label: 'BOM', icon: 'GitBranch', permission: 'master.read' },
      { href: '/master/users', label: 'User & Peran', icon: 'Users', permission: 'user.write' },
    ],
  },
];
