import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { and, asc, auditLogs, bomLines, eq, inArray, parts, type Database } from '@ares/db';
import {
  explodeBom,
  leafRequirements,
  summarizeRequirements,
  CircularBomError,
  type BomLine,
} from '@ares/domain';
import { InjectDb } from '../db/db.module';
import type { MasterActor } from './master.service';

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
}

interface ParsedRow {
  row: number;
  parentPartNo: string;
  componentPartNo: string;
  qtyPer: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * BOM (F-03): upload Excel dan penguraian.
 *
 * Aturan penguraiannya milik packages/domain (explodeBom, termasuk deteksi
 * siklus); di sini hanya membaca baris dari DB/Excel dan menulis hasilnya.
 */
@Injectable()
export class BomService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Upload Excel, kolom A–E: part jadi, komponen, qty per, berlaku dari,
   * berlaku sampai (opsional). Baris pertama dianggap judul bila kolom C
   * bukan angka. Baris yang salah dilaporkan per nomor baris dan dilewati —
   * baris lain tetap masuk, supaya satu typo tidak membatalkan 500 baris.
   * (induk, komponen, mulai berlaku) yang sudah ada diperbarui, bukan digandakan.
   */
  async importExcel(buffer: Buffer, fileName: string, actor: MasterActor): Promise<ImportResult> {
    const rows = await parseWorkbook(buffer);
    if (rows.parsed.length === 0 && rows.errors.length === 0) {
      throw new BadRequestException('Berkas Excel kosong atau tidak punya baris data');
    }

    const partNos = [...new Set(rows.parsed.flatMap((r) => [r.parentPartNo, r.componentPartNo]))];
    const partRows = partNos.length
      ? await this.db
          .select({ id: parts.id, partNo: parts.partNo })
          .from(parts)
          .where(inArray(parts.partNo, partNos))
      : [];
    const idByPartNo = new Map(partRows.map((p) => [p.partNo, p.id]));

    const errors = [...rows.errors];
    const valid: Array<ParsedRow & { parentPartId: number; componentPartId: number }> = [];
    for (const r of rows.parsed) {
      const parentPartId = idByPartNo.get(r.parentPartNo);
      const componentPartId = idByPartNo.get(r.componentPartNo);
      if (!parentPartId)
        errors.push({
          row: r.row,
          message: `Part jadi "${r.parentPartNo}" tidak ada di master part`,
        });
      else if (!componentPartId)
        errors.push({
          row: r.row,
          message: `Komponen "${r.componentPartNo}" tidak ada di master part`,
        });
      else if (parentPartId === componentPartId)
        errors.push({ row: r.row, message: 'Part tidak bisa menjadi komponen dirinya sendiri' });
      else valid.push({ ...r, parentPartId, componentPartId });
    }

    let inserted = 0;
    let updated = 0;
    await this.db.transaction(async (tx) => {
      for (const r of valid) {
        const [existing] = await tx
          .select({ id: bomLines.id })
          .from(bomLines)
          .where(
            and(
              eq(bomLines.parentPartId, r.parentPartId),
              eq(bomLines.componentPartId, r.componentPartId),
              eq(bomLines.effectiveFrom, r.effectiveFrom),
            ),
          );
        const values = { qtyPer: String(r.qtyPer), effectiveTo: r.effectiveTo };
        if (existing) {
          await tx.update(bomLines).set(values).where(eq(bomLines.id, existing.id));
          updated += 1;
        } else {
          await tx.insert(bomLines).values({
            parentPartId: r.parentPartId,
            componentPartId: r.componentPartId,
            effectiveFrom: r.effectiveFrom,
            ...values,
          });
          inserted += 1;
        }
      }
      // F-54: satu jejak per upload, bukan per baris — yang dicari auditor
      // adalah "siapa mengunggah berkas apa, hasilnya berapa".
      await tx.insert(auditLogs).values({
        entity: 'bom',
        entityId: 'import',
        action: 'IMPORT',
        userId: actor.userId,
        before: null,
        after: { fileName, inserted, updated, errors: errors.length },
      });
    });

    return { inserted, updated, skipped: errors.length, errors };
  }

  /** Penguraian BOM satu part jadi pada tanggal tertentu (bawaan: hari ini). */
  async explode(partId: number, qty: number, onDate?: string) {
    const [root] = await this.db
      .select({ id: parts.id, partNo: parts.partNo, name: parts.name })
      .from(parts)
      .where(eq(parts.id, partId));
    if (!root) throw new NotFoundException(`Part #${partId} tidak ditemukan`);

    // BOM seluruh pabrik cukup kecil untuk dibaca sekali (PRD §9: 3.000 vendor part).
    const rows = await this.db
      .select({
        parentPartId: bomLines.parentPartId,
        componentPartId: bomLines.componentPartId,
        qtyPer: bomLines.qtyPer,
        effectiveFrom: bomLines.effectiveFrom,
        effectiveTo: bomLines.effectiveTo,
      })
      .from(bomLines)
      .orderBy(asc(bomLines.parentPartId), asc(bomLines.id));
    const lines: BomLine[] = rows.map((r) => ({
      parentPartId: r.parentPartId,
      componentPartId: r.componentPartId,
      qtyPer: Number(r.qtyPer),
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    }));

    let exploded;
    try {
      exploded = explodeBom(partId, qty, lines, { onDate });
    } catch (e) {
      if (e instanceof CircularBomError) throw new BadRequestException(e.message);
      throw e;
    }
    const totals = summarizeRequirements(exploded);
    const leaves = leafRequirements(exploded, lines);

    const ids = [...new Set(exploded.map((l) => l.partId))];
    const partRows = ids.length
      ? await this.db
          .select({ id: parts.id, partNo: parts.partNo, name: parts.name, uom: parts.uom })
          .from(parts)
          .where(inArray(parts.id, ids))
      : [];
    const info = new Map(partRows.map((p) => [p.id, p]));
    const describe = (id: number) => ({
      partId: id,
      partNo: info.get(id)?.partNo ?? String(id),
      name: info.get(id)?.name ?? '',
      uom: info.get(id)?.uom ?? 'PC',
    });

    return {
      root: { ...root, qty },
      onDate: onDate ?? new Date().toISOString().slice(0, 10),
      lines: exploded.map((l) => ({
        ...describe(l.partId),
        level: l.level,
        qty: l.qty,
        path: l.path,
      })),
      totals: [...totals].map(([id, q]) => ({ ...describe(id), qty: q })),
      leaves: [...leaves].map(([id, q]) => ({ ...describe(id), qty: q })),
    };
  }
}

/** Baca lembar pertama; kembalikan baris yang terbaca dan yang cacat. */
async function parseWorkbook(
  buffer: Buffer,
): Promise<{ parsed: ParsedRow[]; errors: ImportRowError[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('Berkas bukan Excel (.xlsx) yang bisa dibaca');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new BadRequestException('Berkas Excel tidak punya lembar kerja');
  if (ws.actualRowCount > 20_000 || ws.columnCount > 20) {
    throw new BadRequestException('Berkas BOM terlalu besar; maksimal 20.000 baris dan 20 kolom');
  }

  const parsed: ParsedRow[] = [];
  const errors: ImportRowError[] = [];
  ws.eachRow((row, n) => {
    const cell = (i: number) => row.getCell(i).value;
    const text = (v: ExcelJS.CellValue) =>
      v == null
        ? ''
        : typeof v === 'object' && 'result' in v
          ? String(v.result ?? '')
          : String(v).trim();
    const a = text(cell(1));
    const b = text(cell(2));
    const cRaw = cell(3);
    if (!a && !b && !text(cRaw)) return; // baris kosong
    const qtyPer = typeof cRaw === 'number' ? cRaw : Number(text(cRaw).replace(',', '.'));
    // Baris judul: kolom C bukan angka pada baris pertama.
    if (n === 1 && !Number.isFinite(qtyPer)) return;

    const from = toIsoDate(cell(4));
    const to = toIsoDate(cell(5));
    if (!a || !b) errors.push({ row: n, message: 'Part jadi dan komponen wajib diisi' });
    else if (a.length > 64 || b.length > 64)
      errors.push({ row: n, message: 'Nomor part maksimal 64 karakter' });
    else if (!Number.isFinite(qtyPer) || qtyPer <= 0)
      errors.push({ row: n, message: 'Qty per harus angka lebih dari 0' });
    else if (!from) errors.push({ row: n, message: 'Berlaku dari harus tanggal (YYYY-MM-DD)' });
    else if (text(cell(5)) && !to)
      errors.push({ row: n, message: 'Berlaku sampai harus tanggal (YYYY-MM-DD) atau kosong' });
    else
      parsed.push({
        row: n,
        parentPartNo: a,
        componentPartNo: b,
        qtyPer,
        effectiveFrom: from,
        effectiveTo: to,
      });
  });
  return { parsed, errors };
}

/** Sel tanggal Excel datang sebagai Date (UTC tengah malam) atau teks. */
function toIsoDate(v: ExcelJS.CellValue): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(typeof v === 'object' && 'result' in v ? (v.result ?? '') : v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
}
