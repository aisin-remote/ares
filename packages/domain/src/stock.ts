/**
 * Saldo stok WH dari snapshot + selisih (F-41).
 *
 * TT_STOCK_MUTATION bersifat append-only dan hanya bertambah, jadi
 * menjumlahkannya utuh setiap kali layar dibuka makin lama makin mahal.
 * Snapshot harian memotong pekerjaan itu: saldo = baris beku terakhir +
 * mutasi yang terjadi setelahnya.
 *
 * Fungsi di sini murni supaya aturannya bisa diuji tanpa database, dan supaya
 * hanya ada SATU tempat yang tahu bahwa AS_OF itu batas eksklusif.
 */

/** Baris beku hasil job snapshot. Tidak ada baris = belum pernah dibekukan. */
export interface StockSnapshotRow {
  balancePcs: number;
  mutationCount: number;
  lastAt: Date | null;
}

/** Ringkasan mutasi yang terjadi pada atau setelah AS_OF snapshot. */
export interface StockDeltaRow {
  deltaPcs: number;
  mutationCount: number;
  lastAt: Date | null;
}

export interface StockBalance {
  pcs: number;
  mutations: number;
  lastAt: Date | null;
}

/**
 * Menggabungkan saldo beku dengan mutasi sesudahnya.
 *
 * Keduanya boleh kosong: part yang belum pernah dibekukan tetapi sudah ada
 * mutasinya, dan part yang sudah dibekukan tetapi hari ini diam, sama-sama
 * harus menghasilkan angka yang benar.
 */
export function combineStock(
  snapshot: StockSnapshotRow | null,
  delta: StockDeltaRow | null,
): StockBalance {
  const pcs = (snapshot?.balancePcs ?? 0) + (delta?.deltaPcs ?? 0);
  const mutations = (snapshot?.mutationCount ?? 0) + (delta?.mutationCount ?? 0);
  return { pcs, mutations, lastAt: laterOf(snapshot?.lastAt ?? null, delta?.lastAt ?? null) };
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Tanggal-tanggal yang masih harus dibekukan, dari snapshot terakhir sampai
 * `today`.
 *
 * `today` ikut dibekukan dan memang harus: AS_OF eksklusif, jadi
 * AS_OF = hari ini berarti "saldo pada awal hari ini" — datanya sudah lengkap
 * dan justru itu snapshot yang membuat layar hari ini paling murah. Yang tidak
 * pernah dibuat adalah AS_OF besok, karena mutasi hari ini belum selesai.
 *
 * `lastAsOf` null artinya belum pernah ada snapshot; pemanggil memberi
 * `earliest` (tanggal mutasi pertama) supaya job tidak menyusuri kalender dari
 * tahun nol. Snapshot pertama bertanggal sehari SETELAH mutasi pertama, karena
 * AS_OF eksklusif: AS_OF = tanggal mutasi pertama isinya pasti nol. Tidak ada
 * mutasi sama sekali → tidak ada yang perlu dibekukan.
 *
 * Hasil dibatasi `maxDays` agar satu job tidak pernah menulis ratusan hari
 * sekaligus setelah sistem lama menganggur; sisanya diambil job berikutnya.
 */
export function pendingSnapshotDates(
  { lastAsOf, earliest, today }: { lastAsOf: string | null; earliest: string | null; today: string },
  maxDays = 31,
): string[] {
  const mulai = lastAsOf ? addDays(lastAsOf, 1) : earliest && addDays(earliest, 1);
  if (!mulai) return [];
  const dates: string[] = [];
  for (let d = mulai; d <= today && dates.length < maxDays; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** Tambah hari pada YYYY-MM-DD tanpa terpengaruh zona waktu mesin. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
