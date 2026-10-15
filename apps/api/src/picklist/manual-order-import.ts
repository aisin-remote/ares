import ExcelJS from 'exceljs';

const MAX_ROWS = 500;
const HEADERS = ['NOMOR_MATERIAL_SAP', 'JUMLAH_BOX'] as const;

export interface ManualOrderWorkbook {
  sapVendorNo: string;
  deliveryDate: string;
  cutoffTime?: string;
  note?: string;
  lines: Array<{ row: number; sapMaterialNo: string; boxes: number }>;
}

export class ManualOrderImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualOrderImportError';
  }
}

/** F-17: satu workbook = satu picklist manual; detail part mulai baris 9. */
export async function parseManualOrderWorkbook(buffer: Buffer): Promise<ManualOrderWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ManualOrderImportError('Berkas bukan Excel (.xlsx) yang bisa dibaca');
  }
  const sheet = workbook.getWorksheet('ORDER_MANUAL') ?? workbook.worksheets[0];
  if (!sheet) throw new ManualOrderImportError('Berkas Excel tidak punya lembar kerja');
  if (sheet.rowCount > MAX_ROWS + 8 || sheet.columnCount > 10) {
    throw new ManualOrderImportError(`Berkas terlalu besar; maksimal ${MAX_ROWS} baris part dan 10 kolom`);
  }

  const headers = HEADERS.map((_, index) => text(sheet.getRow(8).getCell(index + 1).value).toUpperCase());
  if (headers.some((value, index) => value !== HEADERS[index])) {
    throw new ManualOrderImportError('Format template tidak dikenali. Unduh dan gunakan template Order Manual terbaru');
  }

  const sapVendorNo = text(sheet.getCell('B3').value);
  const deliveryDate = isoDate(sheet.getCell('B4').value);
  const cutoffTime = clockTime(sheet.getCell('B5').value);
  const note = text(sheet.getCell('B6').value);
  if (!sapVendorNo) throw new ManualOrderImportError('NOMOR_VENDOR_SAP di sel B3 wajib diisi');
  if (sapVendorNo.length > 16) throw new ManualOrderImportError('NOMOR_VENDOR_SAP maksimal 16 karakter');
  if (!deliveryDate) throw new ManualOrderImportError('TANGGAL_KIRIM di sel B4 harus berupa tanggal yang valid');
  if (text(sheet.getCell('B5').value) && !cutoffTime) {
    throw new ManualOrderImportError('JAM_CUTOFF di sel B5 harus berformat HH:mm atau dikosongkan');
  }
  if (note.length > 255) throw new ManualOrderImportError('CATATAN di sel B6 maksimal 255 karakter');

  const lines: ManualOrderWorkbook['lines'] = [];
  const seen = new Map<string, number>();
  for (let rowNumber = 9; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const sapMaterialNo = text(row.getCell(1).value);
    const rawBoxes = unwrap(row.getCell(2).value);
    if (!sapMaterialNo && (rawBoxes == null || rawBoxes === '')) continue;
    const boxes = typeof rawBoxes === 'number' ? rawBoxes : Number(text(rawBoxes as ExcelJS.CellValue));
    if (!sapMaterialNo) throw new ManualOrderImportError(`Baris ${rowNumber}: NOMOR_MATERIAL_SAP wajib diisi`);
    if (sapMaterialNo.length > 40) throw new ManualOrderImportError(`Baris ${rowNumber}: nomor material maksimal 40 karakter`);
    if (!Number.isSafeInteger(boxes) || boxes < 1) {
      throw new ManualOrderImportError(`Baris ${rowNumber}: JUMLAH_BOX harus bilangan bulat minimal 1`);
    }
    const duplicateAt = seen.get(sapMaterialNo);
    if (duplicateAt) {
      throw new ManualOrderImportError(`Baris ${rowNumber}: material ${sapMaterialNo} sudah dipakai di baris ${duplicateAt}`);
    }
    seen.set(sapMaterialNo, rowNumber);
    lines.push({ row: rowNumber, sapMaterialNo, boxes });
  }
  if (lines.length === 0) throw new ManualOrderImportError('Isi minimal satu part mulai baris 9');
  return {
    sapVendorNo,
    deliveryDate,
    cutoffTime: cutoffTime || undefined,
    note: note || undefined,
    lines,
  };
}

function unwrap(value: ExcelJS.CellValue): Exclude<ExcelJS.CellValue, ExcelJS.CellFormulaValue> | null {
  if (value && typeof value === 'object' && 'result' in value) return value.result ?? null;
  return value as Exclude<ExcelJS.CellValue, ExcelJS.CellFormulaValue> | null;
}

function text(value: ExcelJS.CellValue): string {
  const unwrapped = unwrap(value);
  return unwrapped == null ? '' : String(unwrapped).trim();
}

function isoDate(value: ExcelJS.CellValue): string | null {
  const unwrapped = unwrap(value);
  if (unwrapped instanceof Date) {
    return Number.isNaN(unwrapped.getTime()) ? null : unwrapped.toISOString().slice(0, 10);
  }
  const raw = unwrapped == null ? '' : String(unwrapped).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
}

function clockTime(value: ExcelJS.CellValue): string | null {
  const unwrapped = unwrap(value);
  if (unwrapped == null || unwrapped === '') return '';
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) {
    const seconds = Math.round((((unwrapped % 1) + 1) % 1) * 86_400) % 86_400;
    return `${two(Math.floor(seconds / 3600))}:${two(Math.floor((seconds % 3600) / 60))}:00`;
  }
  if (unwrapped instanceof Date && !Number.isNaN(unwrapped.getTime())) {
    return `${two(unwrapped.getUTCHours())}:${two(unwrapped.getUTCMinutes())}:00`;
  }
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(unwrapped).trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? `${two(hour)}:${two(minute)}:00` : null;
}

const two = (value: number) => String(value).padStart(2, '0');
