/**
 * Transisi antar halaman portal — sama dengan (app).
 *
 * Padding halaman memang tinggal di template, bukan di ShellFrame; tanpa
 * berkas ini isi portal menempel ke tepi layar dan kehilangan animasi
 * kemunculannya.
 */
export default function PortalTemplate({ children }: { children: React.ReactNode }) {
  return <div className="a-rise p-6 lg:p-8">{children}</div>;
}
