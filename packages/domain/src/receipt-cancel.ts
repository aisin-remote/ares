/** F-40: kembali ke keadaan sebelum sesi penerimaan; scan lama tetap tercatat. */
export function picklistStatusAfterReceiptCancel(input: {
  shippedAt: Date | null;
  downloadedAt: Date | null;
}): 'SHIPPED' | 'DOWNLOADED' | 'ISSUED' {
  if (input.shippedAt) return 'SHIPPED';
  if (input.downloadedAt) return 'DOWNLOADED';
  return 'ISSUED';
}

/** Kanban yang diterima tanpa konfirmasi supplier kembali menjadi PRINTED. */
export function kanbanStatusAfterReceiptCancel(autoShipped: boolean): 'PRINTED' | 'SHIPPED' {
  return autoShipped ? 'PRINTED' : 'SHIPPED';
}
