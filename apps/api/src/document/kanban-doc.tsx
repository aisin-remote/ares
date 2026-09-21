import React from 'react';
import type * as ReactPdf from '@react-pdf/renderer';
import type { KanbanDocData } from './document.types';
import { jamCetak, nomorRevisi, tanggalCetak } from './format';

/**
 * Ukuran kartu: seperdelapan A4 (105 × 74 mm), 8 kartu per halaman.
 *
 * ponytail: ukuran fisik kartu masih pertanyaan terbuka di PRD §13 dan butuh
 * persetujuan gudang di fase 0. Dipilih seperdelapan A4 karena supplier
 * mencetak sendiri di printer laser biasa (asumsi §13.4) dan pembagian ini
 * tidak menyisakan kertas. Kalau gudang minta lain, cukup ubah konstanta ini
 * (mis. A6 4 kartu/halaman) — tata letak kartunya memakai persen, bukan mm.
 */
const KARTU = { lebar: '50%', tinggi: '25%', perHalaman: 8 } as const;

/**
 * PDF kartu kanban (F-24): satu kartu per box, sekali pakai.
 *
 * QR hanya berisi ID kanban (F-22, 8.3); semua detail lain dibaca dari
 * database saat discan. Jadi kartunya boleh seinformatif mungkin untuk mata
 * operator tanpa membuat QR-nya makin padat dan makin sulit terbaca.
 */
export function kanbanDocument(
  pdf: typeof ReactPdf,
  data: KanbanDocData,
  qr: Map<string, Buffer>,
): React.ReactElement<ReactPdf.DocumentProps> {
  const { Document, Page, View, Text, Image, StyleSheet } = pdf;

  const s = StyleSheet.create({
    page: { padding: 0, flexDirection: 'row', flexWrap: 'wrap' },
    kartu: {
      width: KARTU.lebar,
      height: KARTU.tinggi,
      // Garis potong tipis dipakai bersama antar kartu, bukan kotak ganda:
      // setelah dipotong tidak ada garis dobel di tepi kartu.
      borderRightWidth: 0.25,
      borderBottomWidth: 0.25,
      borderColor: '#999',
      // Printer laser biasa tidak mencetak sampai tepi kertas; isi kartu
      // ditahan di dalam batas aman supaya back number dan QR tidak terpotong.
      padding: 14,
      justifyContent: 'space-between',
    },
    atas: { flexDirection: 'row', justifyContent: 'space-between' },
    backNo: { fontFamily: 'Helvetica-Bold', lineHeight: 1 },
    partNo: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 4 },
    partName: { fontSize: 8, color: '#333' },
    qty: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginTop: 4 },
    qr: { width: 62, height: 62 },
    serial: { fontSize: 11, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 2 },
    pita: { borderTopWidth: 0.5, borderColor: '#999', paddingTop: 4, fontSize: 7, color: '#333' },
    pitaBaris: { flexDirection: 'row', justifyContent: 'space-between' },
    tebal: { fontFamily: 'Helvetica-Bold' },
  });

  /*
   * Back number dicetak sebesar mungkin, tetapi kolom kirinya hanya ~207pt
   * sebelum menyentuh QR. BACK_NO adalah varchar(32) tanpa validasi panjang,
   * jadi ukurannya menyesuaikan isi: yang pendek tetap terbaca dari lorong
   * rak, yang panjang tetap muat tanpa menimpa QR.
   */
  const ukuranBackNo = (teks: string) => (teks.length <= 5 ? 44 : teks.length <= 8 ? 30 : 22);

  const total = data.cards.length;
  const halaman: (typeof data.cards)[] = [];
  for (let i = 0; i < data.cards.length; i += KARTU.perHalaman) {
    halaman.push(data.cards.slice(i, i + KARTU.perHalaman));
  }
  // Picklist tanpa kanban tidak mungkin terjadi, tapi PDF tanpa halaman
  // membuat react-pdf melempar error — lebih baik satu halaman kosong.
  if (halaman.length === 0) halaman.push([]);

  return (
    <Document
      title={`Kanban ${nomorRevisi(data.picklistNo, data.revision)}`}
      author="ARES"
      subject={`Kartu kanban untuk ${data.vendorName}`}
    >
      {halaman.map((kartuHalaman, i) => (
        <Page key={i} size="A4" style={s.page}>
          {kartuHalaman.map((k) => (
            <View key={k.kanbanId} style={s.kartu} wrap={false}>
              <View style={s.atas}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[s.backNo, { fontSize: ukuranBackNo(k.backNo) }]}>{k.backNo}</Text>
                  <Text style={s.partNo}>{k.partNo}</Text>
                  <Text style={s.partName}>{k.partName}</Text>
                  <Text style={s.qty}>
                    {k.qtyPerBox} {k.uom} / box
                  </Text>
                </View>
                <View>
                  {qr.get(k.kanbanId) ? <Image src={qr.get(k.kanbanId)!} style={s.qr} /> : null}
                  <Text style={s.serial}>
                    {k.serial} / {total}
                  </Text>
                </View>
              </View>

              <View style={s.pita}>
                <View style={s.pitaBaris}>
                  <Text style={s.tebal}>{nomorRevisi(data.picklistNo, data.revision)}</Text>
                  <Text>cycle {data.cycle}</Text>
                </View>
                <View style={s.pitaBaris}>
                  <Text>{data.vendorName}</Text>
                  <Text>
                    {tanggalCetak(data.deliveryDate)} {jamCetak(data.arrivalTime)}
                  </Text>
                </View>
                <View style={s.pitaBaris}>
                  <Text>Rak {k.rack ?? '-'}</Text>
                  <Text>{k.boxType ?? ''}</Text>
                </View>
              </View>
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
}
