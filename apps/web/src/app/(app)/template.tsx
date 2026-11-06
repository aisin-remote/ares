import { getSessionUser } from '@/lib/session';

/**
 * Transisi antar halaman.
 *
 * Harus template.tsx, bukan layout.tsx: Next membuat instance baru setiap kali
 * rute berganti. Elemen baru berarti animasi CSS-nya otomatis berjalan lagi —
 * itulah yang membuat tiap navigasi terasa berpindah.
 *
 * Bukan Server/Client Component khusus: tanpa JavaScript pun animasinya tetap
 * jalan, dan isinya tetap terlihat kalau animasi tidak didukung.
 */
export default async function AppTemplate({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className={user?.role === 'warehouse' ? 'a-rise p-4' : 'a-rise p-6 lg:p-8'}>
      {children}
    </div>
  );
}
