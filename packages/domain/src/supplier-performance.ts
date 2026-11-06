/** F-50: satu observasi = order asal; query sudah menggabungkan seluruh recovery. */
export interface SupplierPerformanceOrder {
  id: number;
  publicId: string;
  orderNo: string;
  vendorId: number;
  vendorName: string;
  vendorCode: string;
  status: string;
  scheduledAt: Date;
  createdAt: Date;
  confirmedAt: Date | null;
  firstScanAt: Date | null;
  hasReceiving: boolean;
  autoShipped: boolean;
  lines: Array<{ partId: number; orderedPcs: number; orderedBoxes: number; receivedPcs: number; receivedBoxes: number }>;
}

export function performancePeriod(input: { from?: string; to?: string; tolerance?: string }, now: Date) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const from = input.from || `${today.slice(0, 7)}-01`;
  const to = input.to || today;
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!valid(from) || !valid(to) || from > to) throw new Error('Isi periode tanggal yang valid dan berurutan.');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) throw new Error('Maksimal 93 hari per laporan. Persempit periode yang dipilih.');
  const toleranceMinutes = Number(input.tolerance || 0);
  if (!Number.isInteger(toleranceMinutes) || toleranceMinutes < 0 || toleranceMinutes > 120)
    throw new Error('Toleransi kedatangan harus 0–120 menit.');
  return { from, to, toleranceMinutes,
    asOf: new Date(Math.min(now.getTime(), Date.parse(`${to}T23:59:59.999+07:00`))) };
}

function emptyMetrics() {
  return { orders: 0, dueOrders: 0, upcoming: 0, onTime: 0, late: 0, notArrived: 0, unknownArrival: 0,
    arrivalSample: 0, orderedPcs: 0, receivedPcs: 0, fulfilledPcs: 0, shortPcs: 0, extraPcs: 0,
    orderedBoxes: 0, receivedBoxes: 0, confirmationSample: 0, confirmationTotalMinutes: 0,
    invalidConfirmation: 0, withoutConfirmation: 0, autoShipped: 0 };
}
type Counts = ReturnType<typeof emptyMetrics>;
function rates(counts: Counts) {
  return { ...counts,
    onTimePercent: counts.arrivalSample ? counts.onTime / counts.arrivalSample * 100 : null,
    fulfillmentPercent: counts.orderedPcs ? counts.fulfilledPcs / counts.orderedPcs * 100 : null,
    averageConfirmationMinutes: counts.confirmationSample ? counts.confirmationTotalMinutes / counts.confirmationSample : null,
  };
}

export function calculateSupplierPerformance(input: SupplierPerformanceOrder[], asOf: Date, toleranceMinutes: number) {
  const total = emptyMetrics();
  const grouped = new Map<number, Counts & { vendorId: number; vendorName: string; vendorCode: string }>();
  const orders = input.filter((order) => order.status !== 'CANCELLED').map((order) => {
    const counts = emptyMetrics();
    counts.orders = 1;
    const due = order.scheduledAt.getTime() + toleranceMinutes * 60_000 <= asOf.getTime();
    const arrived = order.firstScanAt && order.firstScanAt <= asOf ? order.firstScanAt : null;
    const arrival = !due ? 'UPCOMING' : arrived
      ? arrived.getTime() <= order.scheduledAt.getTime() + toleranceMinutes * 60_000 ? 'ON_TIME' : 'LATE'
      : order.hasReceiving ? 'UNKNOWN' : 'NOT_ARRIVED';
    const confirmed = order.confirmedAt && order.confirmedAt <= asOf ? order.confirmedAt : null;
    const confirmationMinutes = confirmed && confirmed >= order.createdAt
      ? (confirmed.getTime() - order.createdAt.getTime()) / 60_000 : null;
    if (!due) counts.upcoming = 1;
    else {
      counts.dueOrders = 1;
      if (arrival === 'UNKNOWN') counts.unknownArrival = 1;
      else {
        counts.arrivalSample = 1;
        if (arrival === 'ON_TIME') counts.onTime = 1;
        if (arrival === 'LATE') counts.late = 1;
        if (arrival === 'NOT_ARRIVED') counts.notArrived = 1;
      }
      for (const line of order.lines) {
        counts.orderedPcs += line.orderedPcs;
        counts.receivedPcs += line.receivedPcs;
        counts.fulfilledPcs += Math.min(line.orderedPcs, line.receivedPcs);
        counts.shortPcs += Math.max(0, line.orderedPcs - line.receivedPcs);
        counts.extraPcs += Math.max(0, line.receivedPcs - line.orderedPcs);
        counts.orderedBoxes += line.orderedBoxes;
        counts.receivedBoxes += line.receivedBoxes;
      }
      if (confirmationMinutes !== null) { counts.confirmationSample = 1; counts.confirmationTotalMinutes = confirmationMinutes; }
      else if (confirmed) counts.invalidConfirmation = 1;
      else counts.withoutConfirmation = 1;
      if (order.autoShipped) counts.autoShipped = 1;
    }
    const group = grouped.get(order.vendorId) ?? { ...emptyMetrics(), vendorId: order.vendorId,
      vendorName: order.vendorName, vendorCode: order.vendorCode };
    for (const key of Object.keys(counts) as Array<keyof Counts>) { total[key] += counts[key]; group[key] += counts[key]; }
    grouped.set(order.vendorId, group);
    return { ...order, arrival, confirmationMinutes, ...rates(counts) };
  });
  return { total: rates(total), orders,
    suppliers: [...grouped.values()].map((group) => ({ ...group, ...rates(group) }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName, 'id')) };
}

/** F-52: CSV ber-BOM dibuka di Excel; nama supplier tidak boleh menjadi formula. */
export function supplierPerformanceCsv(report: ReturnType<typeof calculateSupplierPerformance>, period: { from: string; to: string; asOf: Date; toleranceMinutes: number }) {
  const quote = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows: Array<Array<string | number | null>> = [
    ['PERIODE JADWAL', period.from, period.to],
    ['BATAS PENILAIAN UTC', period.asOf.toISOString(), 'TOLERANSI MENIT', period.toleranceMinutes],
    ['KEDATANGAN', 'Scan kanban valid pertama; bukan check-in truk. Recovery digabung ke order asal.'],
    ['SUPPLIER', 'KODE', 'ORDER ASAL', 'JATUH TEMPO', 'TEPAT WAKTU', 'TERLAMBAT', 'BELUM TIBA', 'DATA BELUM CUKUP',
      'SAMPEL KEDATANGAN', 'TEPAT WAKTU (%)', 'PCS KEBUTUHAN', 'PCS DITERIMA', 'PCS TERPENUHI', 'PCS BELUM DITERIMA',
      'PCS LEBIH', 'KELENGKAPAN (%)', 'RATA KONFIRMASI MENIT', 'SAMPEL KONFIRMASI', 'WAKTU KONFIRMASI TIDAK KONSISTEN', 'TANPA KONFIRMASI'],
    ...report.suppliers.map((row) => [row.vendorName, row.vendorCode, row.orders, row.dueOrders, row.onTime, row.late,
      row.notArrived, row.unknownArrival, row.arrivalSample, row.onTimePercent, row.orderedPcs, row.receivedPcs,
      row.fulfilledPcs, row.shortPcs, row.extraPcs, row.fulfillmentPercent, row.averageConfirmationMinutes,
      row.confirmationSample, row.invalidConfirmation, row.withoutConfirmation]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(quote).join(';')).join('\r\n');
}
