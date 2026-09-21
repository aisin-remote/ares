import React from 'react';
import type * as ReactPdf from '@react-pdf/renderer';
import type { PicklistDocData } from './document.types';
import { jamCetak, nomorRevisi, tanggalCetak, waktuCetak } from './format';

/**
 * PDF picklist (F-23): satu dokumen per picklist, dipegang supplier saat
 * menyiapkan barang dan dibawa sopir sebagai surat jalan pendamping.
 *
 * Dibuat hitam-putih saja. Supplier mencetak sendiri (asumsi PRD §13.4) dan
 * sebagian hanya punya printer laser hitam-putih; warna tidak boleh menjadi
 * satu-satunya pembawa informasi (PRD 10.5).
 */
export function picklistDocument(
  pdf: typeof ReactPdf,
  data: PicklistDocData,
  barcode: Buffer,
  dicetakPada: Date,
): React.ReactElement<ReactPdf.DocumentProps> {
  const { Document, Page, View, Text, Image, StyleSheet } = pdf;

  const s = StyleSheet.create({
    page: { paddingTop: 28, paddingBottom: 36, paddingHorizontal: 28, fontSize: 9 },
    baris: { flexDirection: 'row' },
    kepala: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    judul: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
    nomor: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 2 },
    lemah: { color: '#555' },
    barcode: { width: 190, height: 34 },
    kotak: { borderWidth: 1, borderColor: '#000', padding: 8, marginBottom: 12 },
    kolom: { flex: 1, paddingRight: 8 },
    label: { fontSize: 7, color: '#555', textTransform: 'uppercase', marginBottom: 2 },
    nilai: { fontSize: 10 },
    besar: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
    thead: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#000', paddingBottom: 4 },
    tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#bbb', paddingVertical: 5 },
    th: { fontSize: 7, color: '#555', textTransform: 'uppercase' },
    kanan: { textAlign: 'right' },
    total: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderColor: '#000',
      paddingTop: 5,
      marginTop: 2,
    },
    kaki: { position: 'absolute', bottom: 18, left: 28, right: 28, fontSize: 7, color: '#555' },
  });

  /*
   * Lebar kolom dijaga berjumlah 100 supaya tabel tidak pernah melebihi kertas.
   *
   * Dua kolom diukur terhadap isi terburuknya, bukan dikira-kira: back number
   * 10 karakter tebal butuh ~56pt dan 'PO / item' (mis. 4500123456 / 00010)
   * butuh ~84pt pada Helvetica 9pt. Terlalu sempit sedikit saja, teksnya
   * membungkus dan tabel jadi dua kali lebih tinggi.
   */
  const w = {
    no: 4,
    part: 24,
    back: 11,
    rak: 7,
    po: 18,
    qtyBox: 8,
    box: 6,
    pcs: 10,
    serial: 12,
  } as const;

  return (
    <Document
      title={`Picklist ${nomorRevisi(data.picklistNo, data.revision)}`}
      author="ARES"
      subject={`Order ke ${data.vendorName}`}
    >
      <Page size="A4" style={s.page}>
        <View style={s.kepala}>
          <View>
            <Text style={s.judul}>PICKLIST</Text>
            <Text style={s.nomor}>{nomorRevisi(data.picklistNo, data.revision)}</Text>
            <Text style={s.lemah}>
              {data.type === 'MANUAL' ? 'Order manual' : 'Order dari cutoff'} · cycle {data.cycle}
            </Text>
          </View>
          <View>
            <Image src={barcode} style={s.barcode} />
            {/* Code128 tidak terbaca mata; nomornya dicetak lagi supaya sesi
                scan tetap bisa dibuka manual saat barcode rusak (F-34). */}
            <Text style={[s.lemah, { textAlign: 'center', marginTop: 2, fontSize: 8 }]}>
              {data.picklistNo}-{data.revision}
            </Text>
          </View>
        </View>

        <View style={[s.kotak, s.baris]}>
          <View style={s.kolom}>
            <Text style={s.label}>Supplier</Text>
            <Text style={s.nilai}>{data.vendorName}</Text>
            <Text style={s.lemah}>{data.sapVendorNo}</Text>
            {data.vendorAddress ? <Text style={s.lemah}>{data.vendorAddress}</Text> : null}
          </View>
          <View style={s.kolom}>
            <Text style={s.label}>Kirim ke</Text>
            <Text style={s.nilai}>{data.plantName}</Text>
            <Text style={s.lemah}>{data.plantCode}</Text>
          </View>
          <View style={s.kolom}>
            <Text style={s.label}>Tanggal kirim</Text>
            <Text style={s.besar}>{tanggalCetak(data.deliveryDate)}</Text>
            <Text style={s.label}>Jam kedatangan</Text>
            <Text style={s.besar}>{jamCetak(data.arrivalTime)}</Text>
          </View>
          <View style={{ width: 90 }}>
            <Text style={s.label}>Cycle</Text>
            <Text style={s.besar}>{data.cycle}</Text>
            <Text style={s.label}>Box / kanban</Text>
            <Text style={s.besar}>
              {data.totalBox} / {data.totalKanban}
            </Text>
          </View>
        </View>

        {/* fixed: judul kolom ikut tercetak di tiap halaman lanjutan —
            picklist 30 baris jadi dua halaman, dan halaman kedua tanpa judul
            kolom tidak bisa dibaca orang gudang. */}
        <View style={s.thead} fixed>
          <Text style={[s.th, { width: `${w.no}%` }]}>No</Text>
          <Text style={[s.th, { width: `${w.part}%` }]}>Part</Text>
          <Text style={[s.th, { width: `${w.back}%` }]}>Back no</Text>
          <Text style={[s.th, { width: `${w.rak}%` }]}>Rak</Text>
          <Text style={[s.th, { width: `${w.po}%` }]}>PO / item</Text>
          <Text style={[s.th, s.kanan, { width: `${w.qtyBox}%` }]}>Qty/box</Text>
          <Text style={[s.th, s.kanan, { width: `${w.box}%` }]}>Box</Text>
          <Text style={[s.th, s.kanan, { width: `${w.pcs}%` }]}>Pcs</Text>
          <Text style={[s.th, s.kanan, { width: `${w.serial}%` }]}>Serial kanban</Text>
        </View>

        {data.lines.map((l) => (
          <View key={l.no} style={s.tr} wrap={false}>
            <Text style={{ width: `${w.no}%` }}>{l.no}</Text>
            <View style={{ width: `${w.part}%` }}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>{l.partNo}</Text>
              <Text style={s.lemah}>{l.partName}</Text>
            </View>
            <Text style={{ width: `${w.back}%`, fontFamily: 'Helvetica-Bold' }}>{l.backNo}</Text>
            <Text style={{ width: `${w.rak}%` }}>{l.rack ?? '-'}</Text>
            <Text style={{ width: `${w.po}%` }}>
              {l.sapPoNo} / {l.sapPoItem}
            </Text>
            <Text style={[s.kanan, { width: `${w.qtyBox}%` }]}>
              {l.qtyPerBox} {l.uom}
            </Text>
            <Text style={[s.kanan, { width: `${w.box}%`, fontFamily: 'Helvetica-Bold' }]}>
              {l.boxOrdered}
            </Text>
            <Text style={[s.kanan, { width: `${w.pcs}%` }]}>{l.pcs}</Text>
            <Text style={[s.kanan, { width: `${w.serial}%` }]}>
              {l.serialFrom != null ? `${l.serialFrom}–${l.serialTo}` : '-'}
            </Text>
          </View>
        ))}

        <View style={s.total}>
          <Text style={{ width: `${w.no + w.part + w.back + w.rak + w.po + w.qtyBox}%` }}>
            Total {data.lines.length} part
          </Text>
          <Text style={[s.kanan, { width: `${w.box}%`, fontFamily: 'Helvetica-Bold' }]}>
            {data.totalBox}
          </Text>
          <Text style={[s.kanan, { width: `${w.pcs}%`, fontFamily: 'Helvetica-Bold' }]}>
            {data.totalPcs}
          </Text>
          <Text style={[s.kanan, { width: `${w.serial}%` }]}>{data.totalKanban} kanban</Text>
        </View>

        {data.note ? (
          <View style={{ marginTop: 10 }}>
            <Text style={s.label}>Catatan</Text>
            <Text>{data.note}</Text>
          </View>
        ) : null}

        <Text
          style={s.kaki}
          render={({ pageNumber, totalPages }) =>
            // Nomor picklist ikut di kaki halaman: kepala dokumen hanya ada di
            // halaman pertama, sedangkan lembar yang tercecer di meja supplier
            // harus tetap bisa dikenali milik order yang mana.
            `${nomorRevisi(data.picklistNo, data.revision)} · ARES · dicetak ${waktuCetak(dicetakPada)} · halaman ${pageNumber} dari ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
