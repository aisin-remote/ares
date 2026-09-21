/**
 * Status dan pilihan kebijakan yang dipakai bersama oleh skema DB (mysqlEnum)
 * dan aturan domain (transisi). Satu sumber supaya keduanya tidak bisa
 * bergeser diam-diam. Rujukan: PRD §3 (siklus hidup), §7 (kolom).
 */

export const PICKLIST_STATUSES = ['ISSUED', 'DOWNLOADED', 'SHIPPED', 'PARTIAL', 'COMPLETE', 'CANCELLED'] as const;
export type PicklistStatus = (typeof PICKLIST_STATUSES)[number];

export const PICKLIST_TYPES = ['AUTO', 'MANUAL'] as const;
export type PicklistType = (typeof PICKLIST_TYPES)[number];

/** SHORT = supplier konfirmasi kirim kurang dari order (6.3.2). */
export const PICKLIST_LINE_STATUSES = ['OPEN', 'SHORT', 'RECEIVED', 'CANCELLED'] as const;
export type PicklistLineStatus = (typeof PICKLIST_LINE_STATUSES)[number];

export const KANBAN_STATUSES = ['PRINTED', 'SHIPPED', 'RECEIVED', 'MISSING', 'CANCELLED'] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

/** SHIPPED_AUTO = diterima tanpa konfirmasi supplier (catatan di 6.4). */
export const KANBAN_EVENT_TYPES = ['PRINTED', 'SHIPPED', 'SHIPPED_AUTO', 'RECEIVED', 'MISSING', 'CANCELLED'] as const;
export type KanbanEventType = (typeof KANBAN_EVENT_TYPES)[number];

/** Receipt = sesi scan: OPEN saat dibuka dengan barcode picklist, CLOSED saat ditutup (6.5.3). */
export const RECEIPT_STATUSES = ['OPEN', 'CLOSED', 'CANCELLED'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const SCAN_RESULTS = ['OK', 'DUPLICATE', 'REJECTED'] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

export const STOCK_MUTATION_TYPES = ['RECEIPT', 'CONSUMPTION', 'ADJUST'] as const;
export type StockMutationType = (typeof STOCK_MUTATION_TYPES)[number];

/** F-07: pembulatan pcs → box saat cutoff (6.1.2). */
export const ROUNDINGS = ['FLOOR', 'CEIL'] as const;
export type Rounding = (typeof ROUNDINGS)[number];

/** F-06: tindak lanjut short shipment (6.3). */
export const SHORT_SHIP_POLICIES = ['CARRY_OVER', 'REVISION'] as const;
export type ShortShipPolicy = (typeof SHORT_SHIP_POLICIES)[number];

/** F-05: cutoff jatuh di libur → maju ke hari kerja sebelumnya (BEFORE) atau mundur (AFTER). */
export const HOLIDAY_SHIFTS = ['BEFORE', 'AFTER'] as const;
export type HolidayShift = (typeof HOLIDAY_SHIFTS)[number];
