/** Pemformatan untuk dokumen cetak. Hanya tampilan — tidak ada aturan bisnis. */

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * 'YYYY-MM-DD' → '18 Sep 2026'.
 *
 * Diurai sebagai teks, bukan lewat `new Date()`: DELIVERY_DATE sudah tanggal
 * pabrik, dan worker bisa jalan di container ber-TZ UTC yang akan menggeser
 * tanggalnya satu hari ke belakang.
 */
export function tanggalCetak(iso: string): string {
  const [y, m, d] = iso.split('-');
  const bulan = BULAN[Number(m) - 1] ?? m;
  return `${d} ${bulan} ${y}`;
}

/** 'HH:MM:SS' → 'HH:MM'. */
export function jamCetak(t: string): string {
  return t.slice(0, 5);
}

/** Waktu UTC → jam pabrik, untuk baris "dicetak pada". */
export function waktuCetak(at: Date): string {
  return at.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

/** Nomor dokumen lengkap dengan revisinya. */
export function nomorRevisi(picklistNo: string, revision: number): string {
  return revision > 0 ? `${picklistNo} rev ${revision}` : picklistNo;
}
