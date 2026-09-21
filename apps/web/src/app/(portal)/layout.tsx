import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getVendorName } from '@/lib/queries';
import { ShellFrame } from '@/components/shell/shell-frame';
import { PORTAL_NAV_GROUPS } from '@/components/shell/nav-config';

/**
 * Kerangka portal supplier (PRD §10.2).
 *
 * Kerangkanya sama persis dengan layar internal — sidebar, topbar, tema,
 * preferensi — hanya menunya yang berbeda dan wordmark yang menyebut nama
 * vendor. Supplier yang menelepon PPIC akan menyebut apa yang dilihatnya; dua
 * tampilan berbeda untuk dokumen yang sama membuat percakapan itu lebih sulit,
 * bukan lebih mudah.
 *
 * Penjagaan di sini hanya soal menu. Yang menentukan supplier tidak bisa
 * melihat order supplier lain adalah `vendorId` yang ikut di setiap query
 * (aturan repo 9) — bukan layout ini.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // Akun internal tidak punya VENDOR_ID; portal bukan tempatnya.
  if (user.vendorId == null) redirect('/dashboard');

  const vendorName = await getVendorName(user.vendorId);

  return (
    <ShellFrame
      userName={user.name}
      role={user.role}
      groups={PORTAL_NAV_GROUPS}
      subtitle={vendorName ?? 'Portal supplier'}
      homeHref="/portal"
    >
      {children}
    </ShellFrame>
  );
}
