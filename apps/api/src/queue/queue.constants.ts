/** Nama antrean dipusatkan supaya producer dan worker tidak pernah beda tulisan. */
export const QUEUES = {
  ORDER: 'order',
  SAP: 'sap',
  MES: 'mes',
  DOCUMENT: 'document',
  NOTIFICATION: 'notification',
  STOCK: 'stock',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  // PRD 6.1–6.2: cutoff pilihan PPIC diproses worker, kunci di DB.
  RUN_CUTOFF: 'run-cutoff',
  // PRD 8.2: tarik hasil produksi dari API MES, cursor per sumber.
  MES_SYNC: 'mes-sync',
  // PRD 8.1: sinkron PO open items & master dari SAP.
  SAP_SYNC_PO: 'sap-sync-po',
  SAP_SYNC_MASTER: 'sap-sync-master',
  // Outbox GR ke SAP.
  COLLECT_SAP_OUTBOX: 'collect-sap-outbox',
  FLUSH_SAP_OUTBOX: 'flush-sap-outbox',
  // PDF picklist & kanban dirender di worker.
  RENDER_PDF: 'render-pdf',
  SEND_NOTIFICATION: 'send-notification',
  // Kabar ke PPIC saat supplier mengubah kemasan vendor part-nya sendiri.
  NOTIFY_VENDOR_PART: 'notify-vendor-part',
  // OTP email setelah password akun supplier tervalidasi.
  SEND_LOGIN_OTP: 'send-login-otp',
  SEND_REMINDER: 'send-reminder',
  // F-41: membekukan saldo stok harian supaya layar Stok WH tidak perlu
  // menjumlahkan seluruh riwayat mutasi tiap kali dibuka.
  SNAPSHOT_STOCK: 'snapshot-stock',
} as const;
