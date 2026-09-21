/** Data siap cetak untuk kedua dokumen (F-23, F-24); tanpa tipe Drizzle. */

export interface PicklistDocLine {
  no: number;
  partNo: string;
  partName: string;
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
  /** YYYY-MM-DD, sudah tanggal pabrik. */
  deliveryDate: string;
  /** HH:MM:SS, sudah jam pabrik. */
  arrivalTime: string;
  note: string | null;
  vendorName: string;
  sapVendorNo: string;
  vendorAddress: string | null;
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
  deliveryDate: string;
  arrivalTime: string;
  vendorName: string;
  cards: KanbanCardData[];
}

export type DocKind = 'picklist' | 'kanban';
