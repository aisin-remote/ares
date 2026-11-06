/** Data siap cetak untuk kedua dokumen (F-23, F-24); tanpa tipe Drizzle. */

export interface PicklistDocLine {
  no: number;
  partNo: string;
  partName: string;
  sapMaterialNo: string;
  uom: string;
  backNo: string;
  rack: string | null;
  boxType: string | null;
  qtyPerBox: number;
  boxOrdered: number;
  pcs: number;
  sapPoNo: string;
  sapPoItem: string;
  /** Rentang serial kanban untuk baris ini, supaya tumpukan kartu mudah dicocokkan. */
  serialFrom: number | null;
  serialTo: number | null;
}

export interface PicklistDocData {
  picklistNo: string;
  revision: number;
  type: string;
  cycle: number;
  cutoffAt: Date;
  /** YYYY-MM-DD, sudah tanggal pabrik. */
  deliveryDate: string;
  /** HH:MM:SS, sudah jam pabrik. */
  arrivalTime: string;
  note: string | null;
  vendorName: string;
  sapVendorNo: string;
  vendorAddress: string | null;
  vendorScheduleCode: string | null;
  truckStation: string | null;
  vehicleNo: string | null;
  plantCode: string;
  plantName: string;
  lines: PicklistDocLine[];
  totalBox: number;
  totalPcs: number;
  totalKanban: number;
}

export interface KanbanCardData {
  kanbanId: string;
  serial: number;
  partNo: string;
  partName: string;
  supplierPartNo: string;
  uom: string;
  backNo: string;
  rack: string | null;
  boxType: string | null;
  qtyPerBox: number;
}

export interface KanbanDocData {
  picklistNo: string;
  revision: number;
  cycle: number;
  cutoffAt: Date;
  deliveryDate: string;
  arrivalTime: string;
  vendorName: string;
  sapVendorNo: string;
  plantCode: string;
  plantName: string;
  truckStation: string | null;
  cards: KanbanCardData[];
}

/** Delivery Sheet (F-30): susunan Order Sheet, berisi qty yang dikonfirmasi kirim. */
export interface DeliverySheetLine extends PicklistDocLine {
  boxShipped: number;
  shippedPcs: number;
  undeliveredPcs: number;
}

export interface DeliverySheetData extends Omit<PicklistDocData, 'lines'> {
  shippedAt: Date;
  lines: DeliverySheetLine[];
  /** PO SAP unik dari semua line; dicetak sebagai PO#. */
  poNumbers: string[];
  totalBoxShipped: number;
}

/** Receipt Sheet: satu receipt (sesi scan) yang sudah CLOSED. */
export interface ReceiptSheetLine extends PicklistDocLine {
  boxReceived: number;
  orderPcs: number;
  receivedPcs: number;
  undeliveredPcs: number;
}

export interface ReceiptSheetData extends Omit<PicklistDocData, 'lines'> {
  receiptNo: string;
  receivedAt: Date;
  shippedAt: Date | null;
  /** Penerimaan ke-n untuk DO yang sama (receipt batal tetap dihitung). */
  repeatNo: number;
  lines: ReceiptSheetLine[];
  poNumbers: string[];
  totalBoxReceived: number;
}

export type DocKind = 'picklist' | 'kanban' | 'csv' | 'delivery';
