import { requirePermission } from '@/lib/session';
import { cn } from '@/components/ui/cn';

/**
 * Layout untuk layar stasiun di lantai produksi.
 *
 * Tanpa sidebar dan tanpa bilah pencarian — mengikuti pola Avicenna MES, yang memakai
 * layout terpisah (layouts/app.blade.php) berisi navbar tipis saja untuk
 * halaman scan, bukan layout admin bersidebar.
 *
 * Alasannya praktis: layar ini menyala sepanjang shift dan hanya dipakai untuk
 * satu pekerjaan. Menu yang tidak akan pernah ditekan hanya memakan ruang yang
 * seharusnya jadi tempat status besar, dan membuka peluang operator tersasar
 * ke halaman lain saat tidak sengaja menyenggol layar sentuh.
 */
export default async function StationLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission('receipt.read');

  return (
    <div
      className={cn(
        '@container min-h-screen bg-surface',
        user.role === 'warehouse' && 'mx-auto w-full max-w-[560px] border-x border-line',
      )}
    >
      {children}
    </div>
  );
}
