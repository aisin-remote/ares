import {
  LayoutDashboard,
  ListOrdered,
  ClipboardList,
  ScanLine,
  Truck,
  Boxes,
  Factory,
  Share2,
  RefreshCw,
  BarChart3,
  FileSpreadsheet,
  Clock,
  SlidersHorizontal,
  CalendarDays,
  Building2,
  Package,
  PackageSearch,
  GitBranch,
  Users,
  Database,
  type LucideIcon,
} from 'lucide-react';

/**
 * Pemetaan nama ikon (string) ke komponennya.
 *
 * Menu (nav-config.ts) dan definisi entitas menyebut ikon sebagai string,
 * bukan komponen — supaya bisa dipakai juga oleh API yang tidak punya React.
 * Penerjemahannya dilakukan di sini, di sisi UI.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  ListOrdered,
  ClipboardList,
  ScanLine,
  Truck,
  Boxes,
  Factory,
  Share2,
  RefreshCw,
  BarChart3,
  FileSpreadsheet,
  Clock,
  SlidersHorizontal,
  CalendarDays,
  Building2,
  Package,
  PackageSearch,
  GitBranch,
  Users,
};

/** Mengembalikan ikon Database sebagai cadangan agar UI tidak pernah kosong. */
export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Database;
}
