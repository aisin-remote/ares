export interface NavItem {
  href: string;
  label: string;
  icon: string;
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
      { href: '/queue', label: 'Antrean Order', icon: 'ListOrdered' },
      { href: '/picklist', label: 'Picklist', icon: 'ClipboardList' },
      { href: '/receiving/session', label: 'Sesi Scan', icon: 'ScanLine' },
    ],
  },
  {
    title: 'Logistik',
    items: [
      { href: '/receiving', label: 'Penerimaan', icon: 'Truck' },
      { href: '/stock', label: 'Stok WH', icon: 'Boxes' },
      { href: '/consumption', label: 'Konsumsi', icon: 'Factory' },
    ],
  },
  {
    title: 'Integrasi',
    items: [
      { href: '/sap', label: 'SAP Outbox', icon: 'Share2' },
      { href: '/mes', label: 'Sinkron MES', icon: 'RefreshCw' },
    ],
  },
  {
    title: 'Laporan',
    items: [
      { href: '/reports/arrival', label: 'Kedatangan', icon: 'BarChart3' },
      { href: '/reports/consumption', label: 'Konsumsi & Order', icon: 'FileSpreadsheet' },
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
      { href: '/master/suppliers', label: 'Supplier', icon: 'Building2' },
      { href: '/master/parts', label: 'Part', icon: 'Package' },
      { href: '/master/vendor-parts', label: 'Vendor Part', icon: 'PackageSearch' },
      { href: '/master/bom', label: 'BOM', icon: 'GitBranch' },
      { href: '/master/users', label: 'User & Peran', icon: 'Users' },
    ],
  },
];
