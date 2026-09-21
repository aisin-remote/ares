/**
 * PRD 6.4 (validasi scan kanban) dan 6.5 (penutupan sesi scan).
 *
 * Fungsi murni: service receiving memuat kanban + sesi dari DB, memanggil
 * fungsi di sini, lalu menulis hasilnya (status kanban, receipt, mutasi stok,
 * outbox). Tidak ada keputusan bisnis di service.
 */
import type { KanbanStatus, PicklistStatus } from '@ares/contracts';
import { assertTransition } from './picklist';

// ─── 8.3 Kode scan ──────────────────────────────────────────────────────────

export type ScanCode =
  | { kind: 'KANBAN'; id: string }
  | { kind: 'PICKLIST'; no: string; revision: number };

/** yymmdd pada zona pabrik (Asia/Jakarta) — kunci TM_SEQUENCE.DATE_KEY. */
export function dateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

/** Nomor dokumen F-21: `PL-260917-0042`; harus terbaca kembali oleh parseScanCode. */
export function formatDocNo(code: 'PL' | 'RCP', d: Date, n: number): string {
  return `${code}-${dateKey(d)}-${String(n).padStart(4, '0')}`;
}

/** Prefix `ARES:` membuat kode asing ditolak tanpa query (8.3). */
export function parseScanCode(raw: string): ScanCode | null {
  const s = raw.trim().toUpperCase();
  const k = /^ARES:K:([0-9A-Z]{26})$/.exec(s);
  if (k) return { kind: 'KANBAN', id: k[1]! };
  const p = /^ARES:P:([A-Z]+-\d{6}-\d+)-(\d+)$/.exec(s);
  if (p) return { kind: 'PICKLIST', no: p[1]!, revision: Number(p[2]) };
  return null;
}

/**
 * Kebalikan parseScanCode: isi barcode picklist (Code128) dan QR kanban (8.3).
 *
 * Dokumen PDF tidak boleh merangkai string `ARES:...` sendiri — sekali meleset
 * dari regex di atas, kartu yang sudah tercetak ditolak scanner dan sesi scan
 * tidak bisa dibuka (F-34).
 */
export function formatScanCode(code: ScanCode): string {
  return code.kind === 'KANBAN' ? `ARES:K:${code.id}` : `ARES:P:${code.no}-${code.revision}`;
}

// ─── 6.4 Validasi scan kanban ───────────────────────────────────────────────

export interface ScanSession {
  /** ID receipt (sesi) yang sedang terbuka. */
  id: number;
  picklistNo: string;
  picklistRevision: number;
}

/** Kanban hasil lookup; `null` bila kode tidak dikenal / tidak ada di DB. */
export interface KanbanForScan {
  id: string;
  status: KanbanStatus;
  /** Nomor + revisi picklist yang menerbitkannya. */
  picklistNo: string;
  picklistRevision: number;
  /** Sesi yang menerimanya bila status RECEIVED. */
  receiptId: number | null;
  receivedAt: Date | null;
}

export type ScanVerdict =
  /** Hijau + bunyi pendek. `autoShipped`: kanban masih PRINTED, catat SHIPPED_AUTO (tanpa konfirmasi supplier). */
  | { result: 'OK'; autoShipped: boolean; message: string }
  /** Kuning: sudah discan di sesi ini, tidak ada perubahan. */
  | { result: 'DUPLICATE'; message: string }
  /** Merah. */
  | { result: 'REJECTED'; message: string };

const reject = (message: string): ScanVerdict => ({ result: 'REJECTED', message });

/** HH:MM jam pabrik (Asia/Jakarta). */
function hhmm(d: Date | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function validateKanbanScan(
  kanban: KanbanForScan | null,
  session: ScanSession,
): ScanVerdict {
  if (!kanban) return reject('Kode tidak dikenal');
  // Revisi memakai nomor yang sama (F-25), jadi pembandingnya nomor saja.
  if (kanban.picklistNo !== session.picklistNo) {
    return reject(`Kanban picklist ${kanban.picklistNo}-${kanban.picklistRevision}`);
  }
  switch (kanban.status) {
    case 'SHIPPED':
      return { result: 'OK', autoShipped: false, message: 'Diterima' };
    case 'PRINTED':
      return { result: 'OK', autoShipped: true, message: 'Diterima (tanpa konfirmasi supplier)' };
    case 'RECEIVED':
      return kanban.receiptId === session.id
        ? { result: 'DUPLICATE', message: `Sudah diterima ${hhmm(kanban.receivedAt)}` }
        : reject(`Sudah diterima di sesi lain ${hhmm(kanban.receivedAt)}`.trim());
    case 'MISSING':
      // Hanya berlaku bila sesi ini adalah revisi dari picklist yang menandainya hilang.
      return session.picklistRevision > kanban.picklistRevision
        ? { result: 'OK', autoShipped: false, message: 'Diterima (kanban revisi sebelumnya)' }
        : reject('Kanban hilang di sesi sebelumnya, belum ada revisi');
    case 'CANCELLED':
      return reject('Kanban sudah dibatalkan');
  }
}

// ─── 6.5 Penutupan sesi scan ────────────────────────────────────────────────

export interface CloseLineInput {
  picklistLineId: number;
  qtyPerBox: number;
  kanbans: ReadonlyArray<{ id: string; status: KanbanStatus; receiptId: number | null }>;
}

export interface CloseLineResult {
  picklistLineId: number;
  /** Diterima di sesi INI — dasar baris receipt dan mutasi stok (6.5.3–6.5.4). */
  boxReceived: number;
  pcsReceived: number;
  /** Belum datang (SHIPPED/PRINTED/MISSING) setelah sesi ditutup. */
  boxMissing: number;
}

export interface CloseResult {
  /** COMPLETE bila tidak ada lagi kanban yang belum datang (6.5.1), selain itu PARTIAL (6.5.2). */
  picklistStatus: 'COMPLETE' | 'PARTIAL';
  /** Kanban SHIPPED/PRINTED yang tidak discan → tandai MISSING. Yang sudah MISSING tidak diulang. */
  missingKanbanIds: string[];
  lines: CloseLineResult[];
}

/** 6.5.2: penutupan dengan kanban kurang wajib beralasan (F-37). */
export class ReasonRequiredError extends Error {
  constructor() {
    super('Alasan wajib diisi bila ada kanban yang belum diterima');
    this.name = 'ReasonRequiredError';
  }
}

export function closeScanSession(
  lines: readonly CloseLineInput[],
  sessionId: number,
  reason?: string,
): CloseResult {
  const missingKanbanIds: string[] = [];
  const results: CloseLineResult[] = lines.map((line) => {
    let boxReceived = 0;
    let boxMissing = 0;
    for (const k of line.kanbans) {
      switch (k.status) {
        case 'RECEIVED':
          if (k.receiptId === sessionId) boxReceived++;
          break;
        case 'CANCELLED':
          break;
        case 'SHIPPED':
        case 'PRINTED':
          missingKanbanIds.push(k.id);
          boxMissing++;
          break;
        case 'MISSING':
          boxMissing++;
          break;
      }
    }
    return {
      picklistLineId: line.picklistLineId,
      boxReceived,
      pcsReceived: boxReceived * line.qtyPerBox,
      boxMissing,
    };
  });

  const picklistStatus = results.some((r) => r.boxMissing > 0) ? 'PARTIAL' : 'COMPLETE';
  if (picklistStatus === 'PARTIAL' && !reason?.trim()) throw new ReasonRequiredError();

  return { picklistStatus, missingKanbanIds, lines: results };
}

/**
 * Status picklist yang harus dilalui saat sesi ditutup. Picklist yang belum
 * dikonfirmasi supplier (ISSUED/DOWNLOADED) lewat SHIPPED dulu — konfirmasi
 * otomatis, sama seperti kanban PRINTED yang diterima (catatan 6.4). PARTIAL
 * yang tetap PARTIAL tidak berpindah. Transisi yang tidak sah melempar
 * InvalidTransitionError (COMPLETE/CANCELLED tidak bisa ditutup lagi).
 */
export function picklistStatusPathOnClose(
  from: PicklistStatus,
  to: 'COMPLETE' | 'PARTIAL',
): PicklistStatus[] {
  const path: PicklistStatus[] = [];
  let cur = from;
  if (cur === 'ISSUED' || cur === 'DOWNLOADED') {
    assertTransition('picklist', cur, cur === 'ISSUED' ? 'DOWNLOADED' : 'SHIPPED');
    if (cur === 'ISSUED') path.push('DOWNLOADED');
    path.push('SHIPPED');
    cur = 'SHIPPED';
  }
  if (cur !== to) {
    assertTransition('picklist', cur, to);
    path.push(to);
  }
  return path;
}
