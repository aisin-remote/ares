import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const ROOT = 'D:/fabian/00_Project/AI Project/ares';
const BUILD_DIR = path.join(ROOT, '.codex-ppt-build');
const SCREENSHOT_DIR = path.join(BUILD_DIR, 'screenshots-desktop');
const DRAFT_DIR = path.join(BUILD_DIR, 'draft-complete-v3');

const SOURCE_META = {
  path: 'C:/Users/fabian/Downloads/Presentation1.pptx',
  sha256: '1d5eab8b4a845b67ff572068bf7c24e4a60b7bab2148ae472ca7155ffcf887b3',
  slideSizeEmu: { cx: 12192000, cy: 6858000 },
};

const COLORS = {
  paper: '#F7F8F5',
  ink: '#10272F',
  muted: '#5D6C70',
  teal: '#1E6786',
  tealDeep: '#124B62',
  tealPale: '#DCEBF0',
  line: '#D6E0DE',
  white: '#FFFFFF',
  screen: '#11140F',
};

const flows = [
  {
    role: 'MP PRD',
    title: 'Scan konsumsi material di Avicenna',
    body: 'MP PRD mengambil material dan memindai kanban. ARES menerima hasil konsumsi dari Avicenna sebagai sumber antrean kebutuhan.',
    output: 'Konsumsi komponen tercatat',
    image: '01-consumption.jpg',
    alt: 'Log konsumsi produksi ARES yang menampilkan hasil scan material dari Avicenna.',
  },
  {
    role: 'INTEGRASI OTOMATIS',
    title: 'Konsumsi masuk ke antrean ARES',
    body: 'ARES mengonversi konsumsi komponen menjadi kebutuhan order dan mengelompokkannya ke jadwal cutoff supplier.',
    output: 'Kebutuhan terkumpul per cutoff',
    image: '02-order-queue.jpg',
    alt: 'Ringkasan antrean Order Sheet ARES yang dikelompokkan per supplier.',
  },
  {
    role: 'PPIC WAREHOUSE',
    title: 'Antrean dikelompokkan per supplier',
    body: 'PPIC membuka supplier, lalu memeriksa part, jumlah kanban, sisa, dan status cutoff sebelum membuat Order Sheet.',
    output: 'Draft order siap ditinjau',
    image: '03-supplier-queue-detail.jpg',
    alt: 'Detail antrean supplier dengan daftar part dan jumlah kanban yang akan dipesan.',
  },
  {
    role: 'PPIC WAREHOUSE',
    title: 'Order Sheet diterbitkan',
    body: 'PPIC meninjau jumlah kanban, melakukan penyesuaian bila perlu, lalu menerbitkan Order Sheet. ARES membuat dokumen order dan kanban untuk supplier.',
    output: 'Order Sheet resmi diterbitkan',
    image: '04-publish-order-sheet.jpg',
    alt: 'Halaman persiapan Order Sheet sebelum diterbitkan untuk supplier.',
  },
  {
    role: 'ARES NOTIFICATION',
    title: 'Supplier menerima email order baru',
    body: 'Setelah PPIC menerbitkan Order Sheet, ARES mengirim email ke akun supplier aktif. Email memuat nomor order, jadwal kirim, jumlah box, dan tautan portal.',
    output: 'Supplier mendapat tautan order',
    image: '05-email-notification.jpg',
    alt: 'Preview email otomatis ARES yang memberi tahu supplier tentang Order Sheet baru.',
  },
  {
    role: 'SUPPLIER',
    title: 'Supplier melihat order baru',
    body: 'Supplier membuka Order aktif, memilih order, lalu mengunduh Order Sheet, kartu Kanban, dan CSV dari halaman detail.',
    output: 'Dokumen order siap diunduh',
    image: '05-supplier-orders.jpg',
    alt: 'Portal supplier ARES yang menampilkan daftar Order aktif dari Aisin.',
  },
  {
    role: 'SUPPLIER',
    title: 'Supplier mengonfirmasi pengiriman',
    body: 'Supplier mengisi jumlah box yang benar-benar naik truk, ETA, dan nomor kendaraan sebelum keberangkatan.',
    output: 'ETA dan jumlah kirim tercatat',
    image: '06-shipping-confirmation.jpg',
    alt: 'Form konfirmasi kirim supplier dengan jumlah box, ETA, dan nomor kendaraan.',
  },
  {
    role: 'ARES / SUPPLIER',
    title: 'ARES membuat Order Sheet recovery',
    body: 'Jika supplier mengirim sebagian, ARES menerbitkan revisi berisi sisa box yang belum terkirim. Supplier mengunduh dokumen recovery untuk pengiriman berikutnya.',
    output: 'Sisa kirim menjadi order revisi',
    image: '08-recovery-order.jpg',
    alt: 'Detail Order Sheet recovery dengan revisi dan catatan sisa box pengiriman parsial.',
  },
  {
    role: 'SUPPLIER',
    title: 'Barang dikirim ke Aisin',
    body: 'Supplier membawa barang, kanban yang terpasang pada box, dan Delivery Sheet. Status order berubah menjadi Dikirim dan menunggu Receiving.',
    output: 'Order menunggu proses receiving',
    image: '07-shipped-order.jpg',
    alt: 'Detail order supplier dengan status Dikirim dan progress proses pengiriman.',
  },
  {
    role: 'PPIC WAREHOUSE',
    title: 'Delivery Sheet membuka sesi receiving',
    body: 'Petugas memindai barcode Delivery Sheet untuk memilih pengiriman. ARES membuka sesi receiving dan menampilkan target box yang harus diterima.',
    output: 'Sesi receiving siap menerima scan',
    image: '10-delivery-sheet-scan.jpg',
    alt: 'Halaman penerimaan ARES dengan input barcode Delivery Sheet untuk membuka sesi scan.',
  },
  {
    role: 'PPIC WAREHOUSE',
    title: 'Receiving memindai setiap kanban',
    body: 'Di dalam sesi receiving, petugas memindai QR kanban pada setiap box. ARES mencatat box yang diterima dan mengonsumsi order asal.',
    output: 'Penerimaan dan progress scan tercatat',
    image: '08-receiving-scan.jpg',
    alt: 'Layar receiving ARES untuk memindai QR kanban dari pengiriman supplier.',
  },
];

const screenshotAssets = new Map();

function addText(slide, text, position, style = {}, name = undefined) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    name,
    position,
    fill: 'none',
    line: { style: 'solid', fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontFamily: 'Aptos',
    color: COLORS.ink,
    ...style,
  };
  return shape;
}

function addFlowSlide(presentation, flow, index) {
  const slide = presentation.slides.add();
  slide.background.fill = COLORS.paper;

  slide.shapes.add({
    geometry: 'rect',
    name: `top-accent-${index + 1}`,
    position: { left: 0, top: 0, width: 1280, height: 14 },
    fill: COLORS.teal,
    line: { style: 'solid', fill: COLORS.teal, width: 0 },
  });

  slide.shapes.add({
    geometry: 'roundRect',
    name: `flow-badge-${index + 1}`,
    position: { left: 64, top: 55, width: 105, height: 34 },
    fill: COLORS.teal,
    line: { style: 'solid', fill: COLORS.teal, width: 0 },
    borderRadius: 'rounded-xl',
  });
  addText(
    slide,
    `FLOW ${String(index + 1).padStart(2, '0')}`,
    { left: 77, top: 62, width: 82, height: 21 },
    { fontSize: 13, bold: true, color: COLORS.white },
    `flow-label-${index + 1}`,
  );

  addText(
    slide,
    flow.role,
    { left: 188, top: 62, width: 320, height: 22 },
    { fontSize: 13, bold: true, color: COLORS.tealDeep, letterSpacing: 1.2 },
    `role-${index + 1}`,
  );

  addText(
    slide,
    flow.title,
    { left: 64, top: 118, width: 330, height: 170 },
    { fontSize: 34, bold: true, color: COLORS.ink },
    `title-${index + 1}`,
  );

  slide.shapes.add({
    geometry: 'rect',
    name: `title-rule-${index + 1}`,
    position: { left: 64, top: 300, width: 72, height: 5 },
    fill: COLORS.teal,
    line: { style: 'solid', fill: COLORS.teal, width: 0 },
  });

  addText(
    slide,
    flow.body,
    { left: 64, top: 329, width: 326, height: 164 },
    { fontSize: 18, color: COLORS.muted },
    `body-${index + 1}`,
  );

  addText(
    slide,
    'OUTPUT PROSES',
    { left: 64, top: 516, width: 170, height: 22 },
    { fontSize: 12, bold: true, color: COLORS.teal, letterSpacing: 1.1 },
    `output-label-${index + 1}`,
  );
  addText(
    slide,
    flow.output,
    { left: 64, top: 546, width: 326, height: 72 },
    { fontSize: 21, bold: true, color: COLORS.ink },
    `output-${index + 1}`,
  );

  slide.shapes.add({
    geometry: 'roundRect',
    name: `screen-frame-${index + 1}`,
    position: { left: 412, top: 52, width: 828, height: 526 },
    fill: COLORS.screen,
    line: { style: 'solid', fill: COLORS.tealDeep, width: 2 },
    borderRadius: 'rounded-2xl',
    shadow: 'shadow-lg',
  });
  slide.images.add({
    blob: screenshotAssets.get(flow.image),
    contentType: 'image/jpeg',
    alt: flow.alt,
    fit: 'contain',
    position: { left: 428, top: 66, width: 796, height: 498 },
    geometry: 'roundRect',
    borderRadius: 'rounded-xl',
  });

  addText(
    slide,
    'ARES · e-Kanban supplier',
    { left: 64, top: 657, width: 280, height: 20 },
    { fontSize: 11, color: COLORS.muted },
    `footer-brand-${index + 1}`,
  );
  addText(
    slide,
    `${String(index + 1).padStart(2, '0')} / ${String(flows.length).padStart(2, '0')}`,
    { left: 520, top: 655, width: 58, height: 22 },
    { fontSize: 12, bold: true, color: COLORS.tealDeep },
    `footer-page-${index + 1}`,
  );
}

await fs.mkdir(DRAFT_DIR, { recursive: true });

for (const flow of flows) {
  const imagePath = path.join(SCREENSHOT_DIR, flow.image);
  await fs.access(imagePath);
  screenshotAssets.set(flow.image, new Uint8Array(await fs.readFile(imagePath)));
}

const presentation = Presentation.create({
  slideSize: { width: 1280, height: 720 },
});

for (const [index, flow] of flows.entries()) {
  addFlowSlide(presentation, flow, index);
}

const metadata = {
  source: SOURCE_META,
  design: {
    basis: 'reference',
    families: ['Aptos'],
    palette: COLORS,
  },
};
await fs.writeFile(path.join(DRAFT_DIR, 'build-metadata.json'), JSON.stringify(metadata, null, 2));

const pptx = await PresentationFile.exportPptx(presentation);
const draftPath = path.join(DRAFT_DIR, 'ARES-End-to-End-Flow-Complete-v3-draft.pptx');
await pptx.save(draftPath);

const inspect = await presentation.inspect({
  select: '$.slides[*]',
  include: [
    'id', 'index', 'title', 'elements.id', 'elements.kind', 'elements.name',
    'elements.text', 'elements.position', 'elements.style', 'elements.alt',
  ],
});
await fs.writeFile(path.join(DRAFT_DIR, 'inspection.ndjson'), inspect.ndjson, 'utf8');

for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, '0')}`;
  const png = await presentation.export({ slide, format: 'png', scale: 1.5 });
  await fs.writeFile(path.join(DRAFT_DIR, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: 'layout', detail: 'full' });
  await fs.writeFile(path.join(DRAFT_DIR, `${stem}.layout.json`), await layout.text(), 'utf8');
}

const montage = await presentation.export({ format: 'webp', montage: true, scale: 0.5 });
await fs.writeFile(path.join(DRAFT_DIR, 'montage.webp'), new Uint8Array(await montage.arrayBuffer()));

console.log(JSON.stringify({ draftPath, slides: presentation.slides.items.length }));
