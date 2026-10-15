import { describe, it, expect } from 'vitest';
import {
  parseScanCode,
  formatScanCode,
  formatDocNo,
  dateKey,
  validateKanbanScan,
  closeScanSession,
  picklistStatusPathOnClose,
  ReasonRequiredError,
  type KanbanForScan,
  type ScanSession,
  type CloseLineInput,
} from './receiving';

const ULID = '01J8Z3M5X8Q9W2Y7V6T5R4S3P2';

describe('parseScanCode (8.3)', () => {
  it('mengenali QR kanban', () => {
    expect(parseScanCode(`ARES:K:${ULID}`)).toEqual({ kind: 'KANBAN', id: ULID });
  });

  it('mengenali barcode picklist beserta revisinya', () => {
    expect(parseScanCode('ARES:P:PL-260917-0042-0')).toEqual({
      kind: 'PICKLIST',
      no: 'PL-260917-0042',
      revision: 0,
    });
    expect(parseScanCode('ARES:P:PL-260917-0042-2')).toEqual({
      kind: 'PICKLIST',
      no: 'PL-260917-0042',
      revision: 2,
    });
    expect(parseScanCode('ARES:P:726092300201')).toEqual({
      kind: 'PICKLIST',
      no: '726092300200',
      revision: 1,
    });
  });

  it('toleran terhadap spasi dan huruf kecil dari scanner', () => {
    expect(parseScanCode(`  ares:k:${ULID.toLowerCase()}\n`)).toEqual({ kind: 'KANBAN', id: ULID });
  });

  it('kode asing ditolak tanpa query', () => {
    expect(parseScanCode('4901234567890')).toBeNull();
    expect(parseScanCode('ARES:X:123')).toBeNull();
    expect(parseScanCode('ARES:K:pendek')).toBeNull();
    expect(parseScanCode('')).toBeNull();
  });
});

describe('formatDocNo (F-21)', () => {
  // 2026-09-17 17:30 UTC = 18 Sep 00:30 WIB → tanggal pabrik, bukan UTC.
  const d = new Date('2026-09-17T17:30:00Z');

  it('yymmdd memakai tanggal Asia/Jakarta', () => {
    expect(dateKey(d)).toBe('260918');
  });

  it('PL-yymmdd-nnnn dan RCP-yymmdd-nnnn, nomor 4 digit', () => {
    expect(formatDocNo('PL', d, 42)).toBe('PL-260918-0042');
    expect(formatDocNo('RCP', d, 7)).toBe('RCP-260918-0007');
    expect(formatDocNo('PL', d, 12345)).toBe('PL-260918-12345');
  });

  it('barcode picklist dari nomor ini terbaca kembali oleh parseScanCode (8.3)', () => {
    const no = formatDocNo('PL', d, 42);
    expect(parseScanCode(`ARES:P:${no}-0`)).toEqual({ kind: 'PICKLIST', no, revision: 0 });
  });

  it('barcode Order Sheet baru membawa nomor recovery yang tercetak', () => {
    const code = formatScanCode({ kind: 'PICKLIST', no: '826092300100', revision: 3 });
    expect(code).toBe('ARES:P:826092300103');
    expect(parseScanCode(code)).toEqual({ kind: 'PICKLIST', no: '826092300100', revision: 3 });
  });
});

describe('validateKanbanScan (6.4)', () => {
  const session: ScanSession = { id: 10, picklistNo: 'PL-260917-0042', picklistRevision: 0 };
  const base: KanbanForScan = {
    id: ULID,
    status: 'SHIPPED',
    picklistNo: 'PL-260917-0042',
    picklistRevision: 0,
    receiptId: null,
    receivedAt: null,
  };
  // 01:41 UTC = 08:41 WIB
  const receivedAt = new Date('2026-09-18T01:41:00Z');

  it('SHIPPED milik picklist sesi ini → diterima, hijau', () => {
    expect(validateKanbanScan(base, session)).toEqual({
      result: 'OK',
      autoShipped: false,
      message: 'Diterima',
    });
  });

  it('PRINTED (supplier belum konfirmasi) tetap diterima, ditandai tanpa konfirmasi', () => {
    expect(validateKanbanScan({ ...base, status: 'PRINTED' }, session)).toMatchObject({
      result: 'OK',
      autoShipped: true,
    });
  });

  it('discan lagi di sesi yang sama → kuning "Sudah diterima HH:MM" (jam Jakarta)', () => {
    const v = validateKanbanScan(
      { ...base, status: 'RECEIVED', receiptId: 10, receivedAt },
      session,
    );
    expect(v).toEqual({ result: 'DUPLICATE', message: 'Sudah diterima 08:41' });
  });

  it('RECEIVED di sesi lain → ditolak', () => {
    const v = validateKanbanScan(
      { ...base, status: 'RECEIVED', receiptId: 9, receivedAt },
      session,
    );
    expect(v.result).toBe('REJECTED');
    expect(v.message).toContain('sesi lain');
  });

  it('milik Order Sheet lain → merah "Kanban Order Sheet <nomor>"', () => {
    const v = validateKanbanScan({ ...base, picklistNo: 'PL-260917-0001' }, session);
    expect(v).toEqual({ result: 'REJECTED', message: 'Kanban Order Sheet PL-260917-0001-0' });
  });

  it('CANCELLED → ditolak', () => {
    expect(validateKanbanScan({ ...base, status: 'CANCELLED' }, session).result).toBe('REJECTED');
  });

  it('kode bukan kanban ARES / tidak ada di DB → "Kode tidak dikenal"', () => {
    expect(validateKanbanScan(null, session)).toEqual({
      result: 'REJECTED',
      message: 'Kode tidak dikenal',
    });
  });

  it('MISSING dari revisi sebelumnya, sesi ini revisinya → diterima', () => {
    const rev1 = { ...session, picklistRevision: 1 };
    expect(validateKanbanScan({ ...base, status: 'MISSING' }, rev1)).toMatchObject({
      result: 'OK',
      autoShipped: false,
    });
  });

  it('MISSING tanpa revisi baru → ditolak', () => {
    expect(validateKanbanScan({ ...base, status: 'MISSING' }, session).result).toBe('REJECTED');
  });
});

describe('closeScanSession (6.5)', () => {
  const SESSION = 10;
  const k = (id: string, status: KanbanForScan['status'], receiptId: number | null = null) => ({
    id,
    status,
    receiptId,
  });

  it('semua SHIPPED discan → COMPLETE, receipt berisi pcs per line, tanpa alasan', () => {
    const lines: CloseLineInput[] = [
      {
        picklistLineId: 1,
        qtyPerBox: 100,
        kanbans: [k('a', 'RECEIVED', SESSION), k('b', 'RECEIVED', SESSION)],
      },
      { picklistLineId: 2, qtyPerBox: 50, kanbans: [k('c', 'RECEIVED', SESSION)] },
    ];
    const out = closeScanSession(lines, SESSION);
    expect(out.picklistStatus).toBe('COMPLETE');
    expect(out.missingKanbanIds).toEqual([]);
    expect(out.lines).toEqual([
      { picklistLineId: 1, boxReceived: 2, pcsReceived: 200, boxMissing: 0 },
      { picklistLineId: 2, boxReceived: 1, pcsReceived: 50, boxMissing: 0 },
    ]);
  });

  it('ada SHIPPED tidak discan → kanban itu MISSING, picklist PARTIAL, alasan wajib', () => {
    const lines: CloseLineInput[] = [
      {
        picklistLineId: 1,
        qtyPerBox: 100,
        kanbans: [k('a', 'RECEIVED', SESSION), k('b', 'SHIPPED')],
      },
    ];
    expect(() => closeScanSession(lines, SESSION)).toThrow(ReasonRequiredError);
    expect(() => closeScanSession(lines, SESSION, '   ')).toThrow(ReasonRequiredError);

    const out = closeScanSession(lines, SESSION, 'Truk datang kurang 1 box');
    expect(out.picklistStatus).toBe('PARTIAL');
    expect(out.missingKanbanIds).toEqual(['b']);
    expect(out.lines[0]).toEqual({
      picklistLineId: 1,
      boxReceived: 1,
      pcsReceived: 100,
      boxMissing: 1,
    });
  });

  it('PRINTED yang tidak discan juga dianggap kurang', () => {
    const lines: CloseLineInput[] = [
      { picklistLineId: 1, qtyPerBox: 10, kanbans: [k('a', 'PRINTED')] },
    ];
    const out = closeScanSession(lines, SESSION, 'belum dikirim');
    expect(out.missingKanbanIds).toEqual(['a']);
    expect(out.picklistStatus).toBe('PARTIAL');
  });

  it('CANCELLED (short shipment, 6.3.2) tidak dihitung kurang', () => {
    const lines: CloseLineInput[] = [
      {
        picklistLineId: 1,
        qtyPerBox: 10,
        kanbans: [k('a', 'RECEIVED', SESSION), k('b', 'CANCELLED')],
      },
    ];
    const out = closeScanSession(lines, SESSION);
    expect(out.picklistStatus).toBe('COMPLETE');
    expect(out.lines[0]).toMatchObject({ boxReceived: 1, boxMissing: 0 });
  });

  it('sesi revisi: yang sudah diterima sesi lama tidak dihitung ulang, MISSING lama tetap MISSING', () => {
    const lines: CloseLineInput[] = [
      {
        picklistLineId: 1,
        qtyPerBox: 10,
        kanbans: [
          k('a', 'RECEIVED', 9), // diterima di sesi sebelumnya
          k('b', 'RECEIVED', SESSION), // MISSING lama yang datang sekarang
          k('c', 'MISSING'), // masih belum datang
        ],
      },
    ];
    const out = closeScanSession(lines, SESSION, 'masih kurang 1');
    expect(out.lines[0]).toEqual({
      picklistLineId: 1,
      boxReceived: 1,
      pcsReceived: 10,
      boxMissing: 1,
    });
    // 'c' sudah MISSING — tidak perlu ditandai lagi.
    expect(out.missingKanbanIds).toEqual([]);
    expect(out.picklistStatus).toBe('PARTIAL');
  });

  it('sesi kosong (tidak ada yang discan) → semuanya MISSING, alasan wajib', () => {
    const lines: CloseLineInput[] = [
      { picklistLineId: 1, qtyPerBox: 10, kanbans: [k('a', 'SHIPPED'), k('b', 'SHIPPED')] },
    ];
    expect(() => closeScanSession(lines, SESSION)).toThrow(ReasonRequiredError);
    const out = closeScanSession(lines, SESSION, 'truk tidak datang');
    expect(out.missingKanbanIds).toEqual(['a', 'b']);
    expect(out.lines[0]).toMatchObject({ boxReceived: 0, pcsReceived: 0, boxMissing: 2 });
  });
});

describe('formatScanCode (8.3)', () => {
  it('QR kanban berisi ID saja, dengan prefix ARES', () => {
    expect(formatScanCode({ kind: 'KANBAN', id: ULID })).toBe(`ARES:K:${ULID}`);
  });

  it('barcode picklist memuat nomor dan revisi', () => {
    expect(formatScanCode({ kind: 'PICKLIST', no: 'PL-260917-0042', revision: 0 })).toBe(
      'ARES:P:PL-260917-0042-0',
    );
  });

  it('apa pun yang dibentuk terbaca kembali oleh parseScanCode', () => {
    const kode: Array<Parameters<typeof formatScanCode>[0]> = [
      { kind: 'KANBAN', id: ULID },
      { kind: 'PICKLIST', no: 'PL-260917-0042', revision: 0 },
      // Revisi dua digit: pernah dipotong oleh regex yang hanya menerima \d.
      { kind: 'PICKLIST', no: 'PL-260917-0042', revision: 12 },
    ];
    for (const k of kode) expect(parseScanCode(formatScanCode(k))).toEqual(k);
  });

  it('nomor dari formatDocNo ikut bulat bolak-balik (F-21 + 8.3)', () => {
    const no = formatDocNo('PL', new Date('2026-09-17T17:30:00Z'), 42);
    expect(parseScanCode(formatScanCode({ kind: 'PICKLIST', no, revision: 3 }))).toEqual({
      kind: 'PICKLIST',
      no,
      revision: 3,
    });
  });
});

describe('picklistStatusPathOnClose (6.5 + catatan 6.4)', () => {
  it('SHIPPED → langsung COMPLETE / PARTIAL', () => {
    expect(picklistStatusPathOnClose('SHIPPED', 'COMPLETE')).toEqual(['COMPLETE']);
    expect(picklistStatusPathOnClose('SHIPPED', 'PARTIAL')).toEqual(['PARTIAL']);
  });

  it('belum dikonfirmasi supplier → lewat SHIPPED dulu (konfirmasi otomatis)', () => {
    expect(picklistStatusPathOnClose('DOWNLOADED', 'COMPLETE')).toEqual(['SHIPPED', 'COMPLETE']);
    expect(picklistStatusPathOnClose('ISSUED', 'PARTIAL')).toEqual(['DOWNLOADED', 'SHIPPED', 'PARTIAL']);
  });

  it('PARTIAL: revisi yang tuntas → COMPLETE, yang masih kurang tidak berpindah', () => {
    expect(picklistStatusPathOnClose('PARTIAL', 'COMPLETE')).toEqual(['COMPLETE']);
    expect(picklistStatusPathOnClose('PARTIAL', 'PARTIAL')).toEqual([]);
  });

  it('COMPLETE / CANCELLED tidak bisa ditutup lagi', () => {
    expect(() => picklistStatusPathOnClose('COMPLETE', 'COMPLETE')).not.toThrow();
    expect(() => picklistStatusPathOnClose('COMPLETE', 'PARTIAL')).toThrow(/COMPLETE/);
    expect(() => picklistStatusPathOnClose('CANCELLED', 'COMPLETE')).toThrow(/CANCELLED/);
  });
});
