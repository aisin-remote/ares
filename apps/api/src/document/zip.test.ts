import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip } from './zip';

/**
 * Arsipnya harus terbaca alat lain, bukan hanya oleh kode kita sendiri —
 * supplier membukanya dengan Windows Explorer atau 7-Zip. Diverifikasi dengan
 * `unzip` bila tersedia; kalau tidak, strukturnya diperiksa langsung.
 */
function unzipAda(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('buildZip', () => {
  const entries = [
    { name: 'ORDER-001-order-sheet.pdf', data: Buffer.from('%PDF-1.7\nhalo order sheet\n%%EOF') },
    { name: 'ORDER-001-kanban.pdf', data: Buffer.from('%PDF-1.7\nkartu kanban\n%%EOF') },
    // CSV supplier ditulis UTF-16LE; byte apa pun harus lewat apa adanya.
    { name: 'ORDER-001-order-sheet.csv', data: Buffer.from('no;part\r\n1;A-100\r\n', 'utf16le') },
  ];

  it('menghasilkan arsip dengan tanda tangan ZIP dan memuat semua berkas', () => {
    const zip = buildZip(entries);
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304'); // local header
    expect(zip.indexOf(Buffer.from('504b0506', 'hex'))).toBeGreaterThan(0); // EOCD
    // Jumlah entri pada EOCD.
    const eocd = zip.lastIndexOf(Buffer.from('504b0506', 'hex'));
    expect(zip.readUInt16LE(eocd + 10)).toBe(3);
    for (const entry of entries) expect(zip.includes(Buffer.from(entry.name))).toBe(true);
  });

  it('bisa dibuka kembali dan isinya persis sama', () => {
    if (!unzipAda()) return;
    const dir = mkdtempSync(join(tmpdir(), 'ares-zip-'));
    try {
      const file = join(dir, 'dokumen.zip');
      writeFileSync(file, buildZip(entries));
      // -t memeriksa CRC tiap berkas; gagal berarti arsipnya rusak.
      execFileSync('unzip', ['-t', file], { stdio: 'ignore' });
      execFileSync('unzip', ['-o', '-q', file, '-d', dir]);
      for (const entry of entries) {
        expect(readFileSync(join(dir, entry.name))).toEqual(entry.data);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('arsip kosong tetap sah', () => {
    const zip = buildZip([]);
    expect(zip).toHaveLength(22);
    expect(zip.readUInt16LE(10)).toBe(0);
  });
});
