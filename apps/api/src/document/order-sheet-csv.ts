import type { PicklistDocData } from './document.types';
import { nomorRevisi } from './format';

export const ORDER_SHEET_CSV_HEADERS = [
  'Data category', 'Production Company', 'Production Company Name',
  'Product control plant code', 'Product Code', 'Shipping Origin',
  'Shipping Origin Plant Code', 'Shipping Origin Name', 'Shipping Destination',
  'Process Plant Code', 'Dock Code', 'Supplier name(to)', 'Part #', 'Part Name',
  'Supplier Part #', 'Customer Code', 'Customer name', 'Customer parts number',
  'Upper limit', 'Lower limit', 'Spec', 'Master Data Category',
  'Kan/Ordering instructions Category', 'Back Number', 'Shipping Date',
  'Shipping Time', 'Delivery Date', 'Delivery Time', 'Truck No.', 'Order by type',
  'Box Qty', 'Order unit minimum order quantity', 'UOM', 'Ordering Quantity',
  '# of Kanban', 'DO#',
] as const;

function csvDate(date: string): string {
  return date.replaceAll('-', '/');
}

function jakartaCutoff(at: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}/${value('month')}/${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  };
}

/** Format legacy supplier: UTF-16LE BOM, tab, CRLF, seluruh sel quoted + apostrophe. */
export function orderSheetCsv(data: PicklistDocData): Buffer {
  const cutoff = jakartaCutoff(data.cutoffAt);
  const rows: string[][] = data.lines.map((line) => [
    '1', data.plantCode, data.plantName, data.plantCode, data.plantCode,
    data.sapVendorNo, data.vendorScheduleCode ?? '', data.vendorName, data.plantCode,
    data.plantCode, data.truckStation ?? line.rack ?? '', data.plantName,
    line.partNo, line.partName, line.sapMaterialNo, '', '', '', '', '', '', '1', '1',
    line.backNo, cutoff.date, cutoff.time, csvDate(data.deliveryDate),
    data.arrivalTime.slice(0, 5), data.vehicleNo ?? '', '2', String(line.qtyPerBox),
    String(line.qtyPerBox), line.uom, String(line.pcs), String(line.boxOrdered),
    nomorRevisi(data.picklistNo, data.revision),
  ]);
  const quote = (value: string) => `"'${value.replaceAll('"', '""')}"`;
  const text = [ORDER_SHEET_CSV_HEADERS, ...rows]
    .map((row) => row.map((value) => quote(String(value))).join('\t'))
    .join('\r\n') + '\r\n';
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}
