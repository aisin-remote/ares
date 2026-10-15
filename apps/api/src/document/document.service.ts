import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  and,
  asc,
  eq,
  ne,
  kanbans,
  parts,
  picklistHeaders,
  picklistLines,
  plants,
  vendorParts,
  vendors,
  type Database,
} from '@ares/db';
import { formatScanCode, orderSheetDisplayNo } from '@ares/domain';
import { InjectDb } from '../db/db.module';
import { code128Png, qrPng, reactPdf } from './pdf-runtime';
import { picklistDocument } from './picklist-doc';
import { kanbanDocument } from './kanban-doc';
import { orderSheetCsv } from './order-sheet-csv';
import type { DocKind, KanbanCardData, PicklistDocData, PicklistDocLine } from './document.types';
import { buildZip } from './zip';

/**
 * Render dan penyimpanan PDF picklist & kanban (F-23, F-24, F-27).
 *
 * Berkas disimpan di disk dan dibaca apa adanya saat dicetak ulang; tidak ada
 * render kedua. Selain hemat, ini juga menjaga dokumen tetap sama dengan yang
 * sudah dipegang supplier walaupun master (back number, rak, nama part)
 * berubah sesudah picklist terbit.
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  private dir(): string {
    return join(process.env.STORAGE_DIR ?? './storage', 'picklist');
  }

  /** Revisi ikut di nama berkas: unduhan revisi baru tidak boleh menimpa yang lama (F-25). */
  fileName(picklistNo: string, revision: number, kind: DocKind): string {
    const no = orderSheetDisplayNo(picklistNo, revision);
    if (kind === 'csv') return `${no}-order-sheet.csv`;
    const label = kind === 'picklist' ? 'order-sheet' : kind;
    return `${no}-${label}.pdf`;
  }

  /** Nama penyimpanan lama dipertahankan agar dokumen yang sudah dibuat tetap dapat dibaca. */
  private storageFileName(picklistNo: string, revision: number, kind: DocKind): string {
    return `${picklistNo}-r${revision}-${kind}.${kind === 'csv' ? 'csv' : 'pdf'}`;
  }

  private path(picklistNo: string, revision: number, kind: DocKind): string {
    return join(this.dir(), this.storageFileName(picklistNo, revision, kind));
  }

  /**
   * Dipanggil worker (JOBS.RENDER_PDF). Idempoten: menjalankan ulang job yang
   * sama hanya menimpa berkas dengan isi yang sama.
   */
  async render(picklistId: number): Promise<{ picklistNo: string; kanbanCount: number } | null> {
    const data = await this.dataFor(picklistId);

    /*
     * Order bisa dibatalkan sebelum job ini sempat jalan (Redis lambat, job
     * diulang). Tetap merendernya berbahaya: supplier mengunduh, mencetak,
     * mengirim barang, lalu setiap kartunya ditolak di gudang. Job ditandai
     * selesai tanpa mengisi PDF_READY_AT supaya layar tidak menawarkan unduhan.
     */
    if (data.status === 'CANCELLED') {
      this.logger.warn(`picklist ${data.picklist.picklistNo} sudah dibatalkan, PDF tidak dirender`);
      return null;
    }
    const pdf = await reactPdf();
    const sekarang = new Date();

    const barcode = await code128Png(
      formatScanCode({
        kind: 'PICKLIST',
        no: data.picklist.picklistNo,
        revision: data.picklist.revision,
      }),
    );
    const picklistQr = await qrPng(
      formatScanCode({
        kind: 'PICKLIST',
        no: data.picklist.picklistNo,
        revision: data.picklist.revision,
      }),
    );
    // Semua QR dibuat lebih dulu: bwip-js asinkron, sedangkan komponen
    // react-pdf dirender sinkron dan tidak bisa menunggu di tengah jalan.
    const qr = new Map<string, Buffer>();
    for (const kartu of data.kanban.cards) {
      qr.set(kartu.kanbanId, await qrPng(formatScanCode({ kind: 'KANBAN', id: kartu.kanbanId })));
    }

    const [isiPicklist, isiKanban] = await Promise.all([
      pdf.renderToBuffer(picklistDocument(pdf, data.picklist, barcode, picklistQr, sekarang)),
      pdf.renderToBuffer(kanbanDocument(pdf, data.kanban, qr)),
    ]);
    const isiCsv = orderSheetCsv(data.picklist);

    await mkdir(this.dir(), { recursive: true });
    const { picklistNo, revision } = data.picklist;
    await writeFile(this.path(picklistNo, revision, 'picklist'), isiPicklist);
    await writeFile(this.path(picklistNo, revision, 'kanban'), isiKanban);
    await writeFile(this.path(picklistNo, revision, 'csv'), isiCsv);

    await this.db
      .update(picklistHeaders)
      .set({ pdfReadyAt: sekarang })
      .where(eq(picklistHeaders.id, picklistId));

    this.logger.log(
      `Dokumen ${picklistNo} rev ${revision} selesai: PDF ${isiPicklist.length} + ${isiKanban.length}, CSV ${isiCsv.length} byte, ${data.kanban.cards.length} kartu`,
    );
    return { picklistNo, kanbanCount: data.kanban.cards.length };
  }

  /**
   * Berkas untuk diunduh. Keberadaannya diperiksa SEBELUM stream dibuka —
   * error yang dilempar setelah header terkirim akan memutus unduhan di tengah
   * jalan tanpa pesan apa pun.
   */
  /**
   * Ketiga dokumen satu Order Sheet dalam satu ZIP (F-26).
   *
   * Supplier hampir selalu memerlukan ketiganya sekaligus — Order Sheet untuk
   * arsip, kanban untuk ditempel, CSV untuk sistemnya sendiri. Tiga tombol
   * berjejer memaksa tiga klik dan tiga dialog simpan; satu berkas cukup.
   *
   * Dibaca ke memori, bukan di-stream: ketiganya berukuran puluhan sampai
   * ratusan kilobyte dan ZIP memerlukan direktori pusat di akhir berkas.
   * Dokumen yang belum selesai dirender dilewati; kalau belum ada satu pun,
   * jawabannya 404 dengan pesan yang sama seperti unduhan satuan.
   */
  async bundle(
    picklistId: number,
    scope: number | null,
    plantId?: number,
  ): Promise<{ data: Buffer; fileName: string }> {
    const kinds: DocKind[] = ['picklist', 'kanban', 'csv'];
    const entries: Array<{ name: string; data: Buffer }> = [];
    let gagal: NotFoundException | null = null;

    for (const kind of kinds) {
      try {
        const { path, fileName } = await this.fileFor(picklistId, kind, scope, plantId);
        entries.push({ name: fileName, data: await readFile(path) });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        // Satu dokumen yang belum selesai dirender tidak menahan dua lainnya;
        // galatnya disimpan untuk dipakai bila ternyata tidak ada satu pun.
        gagal = error;
      }
    }
    if (entries.length === 0) throw gagal ?? new NotFoundException('Dokumen tidak ditemukan');

    // Nama arsip mengikuti nomor dokumen: `<nomor>-dokumen.zip`.
    const no = entries[0]!.name.replace(/-(order-sheet|kanban)\.(pdf|csv)$/, '');
    return { data: buildZip(entries), fileName: `${no}-dokumen.zip` };
  }

  async fileFor(
    picklistId: number,
    kind: DocKind,
    scope: number | null,
    plantId?: number,
  ): Promise<{ path: string; fileName: string }> {
    const [row] = await this.db
      .select({
        picklistNo: picklistHeaders.picklistNo,
        revision: picklistHeaders.revision,
        status: picklistHeaders.status,
      })
      .from(picklistHeaders)
      // Kondisi vendor ikut di WHERE yang sama dengan id: path berkas
      // diturunkan dari hasil query ini, jadi baris kosong berarti nama
      // berkasnya tidak pernah terbentuk — nama yang tertebak pun tidak
      // membuka apa pun (aturan repo 9).
      .where(
        and(
          eq(picklistHeaders.id, picklistId),
          scope ? eq(picklistHeaders.vendorId, scope) : undefined,
          plantId ? eq(picklistHeaders.plantId, plantId) : undefined,
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Order Sheet tidak ditemukan');
    if (row.status === 'CANCELLED') {
      throw new NotFoundException(
        `Order Sheet ${row.picklistNo} sudah dibatalkan; dokumennya tidak boleh dicetak lagi (F-20).`,
      );
    }

    const path = this.path(row.picklistNo, row.revision, kind);
    if (!existsSync(path)) {
      const label = kind === 'picklist' ? 'Order Sheet' : kind === 'kanban' ? 'kanban' : 'CSV';
      throw new NotFoundException(
        `${label} untuk ${row.picklistNo} belum selesai dibuat. Coba lagi beberapa saat lagi.`,
      );
    }
    return { path, fileName: this.fileName(row.picklistNo, row.revision, kind) };
  }

  /**
   * Data cetak kedua dokumen dalam tiga query.
   *
   * ponytail: query sendiri, bukan memakai PicklistService.get(), karena
   * dokumen butuh kolom yang tidak dipakai layar (alamat supplier, pabrik
   * tujuan, UOM, tipe box) dan layar tidak perlu ikut menanggung join-nya.
   */
  private async dataFor(picklistId: number) {
    const [header] = await this.db
      .select({
        picklistNo: picklistHeaders.picklistNo,
        revision: picklistHeaders.revision,
        type: picklistHeaders.type,
        status: picklistHeaders.status,
        cycle: picklistHeaders.cycle,
        cutoffAt: picklistHeaders.cutoffAt,
        deliveryDate: picklistHeaders.deliveryDate,
        arrivalTime: picklistHeaders.arrivalTime,
        note: picklistHeaders.note,
        vehicleNo: picklistHeaders.vehicleNo,
        vendorName: vendors.name,
        sapVendorNo: vendors.sapVendorNo,
        vendorAddress: vendors.address,
        vendorScheduleCode: vendors.scheduleCode,
        truckStation: vendors.truckStation,
        plantCode: plants.code,
        plantName: plants.name,
      })
      .from(picklistHeaders)
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .innerJoin(plants, eq(picklistHeaders.plantId, plants.id))
      .where(eq(picklistHeaders.id, picklistId))
      .limit(1);
    if (!header) throw new NotFoundException(`Order Sheet ${picklistId} tidak ditemukan`);

    const lineRows = await this.db
      .select({
        id: picklistLines.id,
        partNo: parts.partNo,
        partName: parts.name,
        sapMaterialNo: parts.sapMaterialNo,
        uom: parts.uom,
        backNo: vendorParts.backNo,
        rack: vendorParts.rack,
        boxType: vendorParts.boxType,
        qtyPerBox: picklistLines.qtyPerBox,
        boxOrdered: picklistLines.boxOrdered,
        pcs: picklistLines.pcs,
        sapPoNo: picklistLines.sapPoNo,
        sapPoItem: picklistLines.sapPoItem,
      })
      .from(picklistLines)
      .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .where(eq(picklistLines.picklistId, picklistId))
      .orderBy(asc(picklistLines.id));

    // Kanban yang dibatalkan tidak ikut dicetak, dan rentang serial per baris
    // diambil dari daftar yang sama supaya tidak ada query keempat.
    const kanbanRows = await this.db
      .select({
        id: kanbans.id,
        picklistLineId: kanbans.picklistLineId,
        serial: kanbans.serial,
      })
      .from(kanbans)
      .innerJoin(picklistLines, eq(kanbans.picklistLineId, picklistLines.id))
      .where(and(eq(picklistLines.picklistId, picklistId), ne(kanbans.status, 'CANCELLED')))
      .orderBy(asc(picklistLines.id), asc(kanbans.serial));

    const lines: PicklistDocLine[] = lineRows.map((l, i) => {
      const serial = kanbanRows.filter((k) => k.picklistLineId === l.id).map((k) => k.serial);
      return {
        no: i + 1,
        partNo: l.partNo,
        partName: l.partName,
        sapMaterialNo: l.sapMaterialNo,
        uom: l.uom,
        backNo: l.backNo,
        rack: l.rack,
        boxType: l.boxType,
        qtyPerBox: l.qtyPerBox,
        boxOrdered: l.boxOrdered,
        pcs: l.pcs,
        sapPoNo: l.sapPoNo,
        sapPoItem: l.sapPoItem,
        serialFrom: serial.length > 0 ? Math.min(...serial) : null,
        serialTo: serial.length > 0 ? Math.max(...serial) : null,
      };
    });

    const lineById = new Map(lineRows.map((l) => [l.id, l]));
    const cards: KanbanCardData[] = kanbanRows.map((k) => {
      const l = lineById.get(k.picklistLineId)!;
      return {
        kanbanId: k.id,
        serial: k.serial,
        partNo: l.partNo,
        partName: l.partName,
        supplierPartNo: l.sapMaterialNo,
        uom: l.uom,
        backNo: l.backNo,
        rack: l.rack,
        boxType: l.boxType,
        qtyPerBox: l.qtyPerBox,
      };
    });

    const { status, ...isiHeader } = header;
    const picklist: PicklistDocData = {
      ...isiHeader,
      sapVendorNo: isiHeader.sapVendorNo ?? '',
      lines,
      totalBox: lines.reduce((n, l) => n + l.boxOrdered, 0),
      totalPcs: lines.reduce((n, l) => n + l.pcs, 0),
      totalKanban: cards.length,
    };

    return {
      status,
      picklist,
      kanban: {
        picklistNo: header.picklistNo,
        revision: header.revision,
        cycle: header.cycle,
        cutoffAt: header.cutoffAt,
        deliveryDate: header.deliveryDate,
        arrivalTime: header.arrivalTime,
        vendorName: header.vendorName,
        sapVendorNo: header.sapVendorNo ?? '',
        plantCode: header.plantCode,
        plantName: header.plantName,
        truckStation: header.truckStation,
        cards,
      },
    };
  }
}
