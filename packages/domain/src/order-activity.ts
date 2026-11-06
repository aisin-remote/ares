/** F-54: hanya ringkasan operasional yang boleh keluar ke halaman, bukan snapshot audit mentah. */
export function describeOrderActivity(entity: string, action: string, before: unknown, after: unknown) {
  const old = before && typeof before === 'object' ? before as Record<string, unknown> : {};
  const next = after && typeof after === 'object' ? after as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === 'string' ? value : null;
  if (entity === 'TT_RECEIPT_H') {
    if (action === 'OPEN') return { title: 'Sesi receiving dibuka', detail: text(next.receiptNo) };
    if (action === 'CLOSE') return { title: 'Receiving selesai', detail: [
      typeof next.boxReceived === 'number' ? `${next.boxReceived} box diterima` : null,
      Array.isArray(next.missingKanbanIds) && next.missingKanbanIds.length
        ? `${next.missingKanbanIds.length} box belum diterima` : null,
      text(next.reason),
    ].filter(Boolean).join(' · ') || null };
    if (action === 'CANCEL') return { title: 'Penerimaan dibatalkan', detail: text(next.note) };
    return null;
  }
  if (entity !== 'TT_PICKLIST_H') return null;
  switch (action) {
    case 'ISSUE': return { title: 'Order Sheet diterbitkan', detail: 'Order manual' };
    case 'ISSUE_AUTO': return { title: 'Order Sheet diterbitkan', detail: 'Dari antrean konsumsi' };
    case 'CREATE_REVISION': return { title: 'Order recovery diterbitkan', detail: 'Sisa pengiriman dari order sebelumnya' };
    case 'DOWNLOAD': return { title: 'Dokumen diunduh supplier', detail: 'Unduhan pertama dokumen order' };
    case 'CONFIRM_SHIPMENT': return { title: 'Pengiriman dikonfirmasi supplier', detail: [
      text(next.vehicleNo), next.revision ? 'Sisa pengiriman dibuatkan order recovery' : null,
    ].filter(Boolean).join(' · ') || null };
    case 'OVERRIDE_SHIPMENT': return { title: 'Jumlah pengiriman dikoreksi PPIC', detail: text(next.reason) };
    case 'CANCEL': return { title: 'Order Sheet dibatalkan', detail: text(next.reason) ?? text(next.note) };
    case 'RESEND_EMAIL': return { title: 'Pemberitahuan email diminta ulang', detail: 'Permintaan kirim ke akun supplier aktif' };
    default:
      if (next.eta !== undefined && next.eta !== old.eta)
        return { title: 'Perkiraan tiba diperbarui', detail: null };
      return null;
  }
}
