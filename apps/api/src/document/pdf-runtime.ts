import type * as ReactPdf from '@react-pdf/renderer';

/**
 * Jembatan ke dua paket ESM dari kode CommonJS.
 *
 * `@react-pdf/renderer` 4 adalah ESM murni, sedangkan apps/api dikompilasi ke
 * CommonJS. TypeScript menurunkan `await import()` menjadi `require()` pada
 * module CommonJS, dan `require()` menolak paket ESM (`ERR_REQUIRE_ESM`).
 * `new Function` menyembunyikan import dinamisnya dari kompiler sehingga tetap
 * berupa `import()` sungguhan saat dijalankan.
 *
 * ponytail: trik ini hilang sendiri kalau apps/api pindah ke module NodeNext;
 * selama Nest masih CJS, satu tempat ini yang menanggungnya.
 */
const imporEsm = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;

type BwipToBuffer = (opts: Record<string, unknown>) => Promise<Buffer>;

let pdfModul: typeof ReactPdf | undefined;
let bwipToBuffer: BwipToBuffer | undefined;

/** Modul react-pdf, dimuat sekali lalu dipakai ulang (impor pertama ~1 detik). */
export async function reactPdf(): Promise<typeof ReactPdf> {
  pdfModul ??= (await imporEsm('@react-pdf/renderer')) as typeof ReactPdf;
  return pdfModul;
}

async function bwip(): Promise<BwipToBuffer> {
  if (!bwipToBuffer) {
    const m = (await imporEsm('bwip-js')) as {
      toBuffer?: BwipToBuffer;
      default?: { toBuffer?: BwipToBuffer };
    };
    const fn = m.toBuffer ?? m.default?.toBuffer;
    if (!fn) throw new Error('bwip-js: fungsi toBuffer tidak ditemukan');
    bwipToBuffer = fn;
  }
  return bwipToBuffer;
}

/**
 * Barcode picklist (8.3). Code128 tidak membawa teks yang terbaca manusia,
 * jadi nomornya selalu dicetak lagi sebagai teks di bawah gambar — sesi scan
 * dibuka dengan barcode ini (F-34), dan barcode rusak tidak boleh menghentikan
 * penerimaan barang.
 */
export async function code128Png(text: string): Promise<Buffer> {
  return (await bwip())({ bcid: 'code128', text, scale: 3, height: 12, includetext: false });
}

/**
 * QR kanban (8.3): error correction M sesuai PRD — kartu kena minyak dan
 * tergores di gudang, level L terlalu rapuh untuk itu.
 */
export async function qrPng(text: string): Promise<Buffer> {
  // padding 20px = 4 modul pada scale 5, yaitu quiet zone minimum QR. Tanpa
  // itu kode menempel ke tepi gambar dan scanner gudang sering gagal sekali
  // baca - di meja receiving satu scan gagal berarti satu box tertahan.
  return (await bwip())({ bcid: 'qrcode', text, eclevel: 'M', scale: 5, padding: 20 });
}
