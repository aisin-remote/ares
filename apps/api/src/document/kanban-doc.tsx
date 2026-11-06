import React from 'react';
import type * as ReactPdf from '@react-pdf/renderer';
import type { KanbanDocData } from './document.types';
import { jamCetak, nomorRevisi, tanggalCetak, tanggalJamPabrik } from './format';
import { AISIN_LOGO } from './aisin-logo';

/**
 * Tiga kartu horizontal per A4, mengikuti kartu purchase yang dipakai supplier.
 *
 * Satu kartu = satu tabel tertutup: hanya bingkai luar yang punya garis tepi,
 * tiap baris memberi garis bawah dan tiap sel garis kanan. Garis vertikal
 * selalu jatuh di 24 / 50 / 76 % lebar kartu, jadi sejajar di semua baris dan
 * tidak ada garis yang menggantung atau tumpang tindih.
 */
export function kanbanDocument(
  pdf: typeof ReactPdf,
  data: KanbanDocData,
  qr: Map<string, Buffer>,
): React.ReactElement<ReactPdf.DocumentProps> {
  const { Document, Page, View, Text, Image, StyleSheet } = pdf;
  const no = nomorRevisi(data.picklistNo, data.revision);
  const LINE = 0.8;
  const INK = '#111';
  // Lebar kolom terhadap kartu; bagian kiri baris tengah = 76 %, jadi dihitung ulang terhadap 76.
  const col = { a: '24%', c: '26%', d: '24%' } as const;
  const inLeft = (pct: number) => `${(pct / 76) * 100}%`;
  const s = StyleSheet.create({
    page: { paddingVertical: 14, paddingHorizontal: 14, fontFamily: 'Helvetica', color: INK },
    card: { height: 262, borderWidth: 1.4, borderColor: INK, marginBottom: 8 },
    row: { flexDirection: 'row', borderBottomWidth: LINE, borderColor: INK },
    cell: { borderRightWidth: LINE, borderColor: INK, paddingVertical: 4, paddingHorizontal: 6 },
    last: { borderRightWidth: 0 },
    label: { fontSize: 6, color: '#555', marginBottom: 2 },
    value: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
    small: { fontSize: 7 },
    header: { height: 38, alignItems: 'center', paddingHorizontal: 8 },
    badge: { backgroundColor: INK, color: '#fff', paddingVertical: 4, paddingHorizontal: 10, fontSize: 8, fontFamily: 'Helvetica-Bold' },
    // Rasio logo 916×272: tinggi 32 pt cukup agar nama perusahaan di bawah wordmark tetap terbaca.
    logo: { width: 108, height: 32, objectFit: 'contain' },
    qr: { width: 80, height: 80 },
    fill: { flexGrow: 1, justifyContent: 'center' },
  });
  const pages: (typeof data.cards)[] = [];
  for (let i = 0; i < data.cards.length; i += 3) pages.push(data.cards.slice(i, i + 3));
  if (pages.length === 0) pages.push([]);

  return (
    <Document title={`Kanban ${no}`} author="ARES" subject={`Kanban ${data.vendorName}`}>
      {pages.map((cards, page) => (
        <Page key={page} size="A4" style={s.page}>
          {cards.map((card) => (
            <View key={card.kanbanId} style={s.card} wrap={false}>
              {/* Kepala kartu */}
              <View style={[s.row, s.header]}>
                <View style={{ width: '33%' }}><Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>&lt;PURCHASE&gt;</Text></View>
                <View style={{ width: '34%', alignItems: 'center' }}><Text style={s.badge}>Additional</Text></View>
                <View style={{ width: '33%', alignItems: 'flex-end' }}><Image src={AISIN_LOGO} style={s.logo} /></View>
              </View>

              {/* Baris 1: supplier | part | order sheet */}
              <View style={[s.row, { height: 44 }]}>
                <View style={[s.cell, { width: col.a }]}>
                  <Text style={s.label}>Supplier code / name</Text>
                  <Text style={s.value}>{data.sapVendorNo}</Text>
                  <Text style={s.small}>{data.vendorName}</Text>
                </View>
                <View style={[s.cell, { width: '52%' }]}>
                  <Text style={s.label}>Part number / name</Text>
                  <Text style={[s.value, { fontSize: 13 }]}>{card.partNo}</Text>
                  <Text style={{ fontSize: 8 }}>{card.partName}</Text>
                </View>
                <View style={[s.cell, s.last, { width: col.d }]}>
                  <Text style={s.label}>Order Sheet / Cycle</Text>
                  <Text style={s.value}>{no}</Text>
                  <Text style={{ fontSize: 8 }}>Cycle {data.cycle}</Text>
                </View>
              </View>

              {/* Baris 2: dua sub-baris di kiri, QR di kanan setinggi keduanya */}
              <View style={[s.row, { height: 84 }]}>
                <View style={{ width: '76%', borderRightWidth: LINE, borderColor: INK }}>
                  <View style={[s.row, { height: 42 }]}>
                    <View style={[s.cell, { width: inLeft(24) }]}>
                      <Text style={s.label}>Shipping date / time</Text>
                      <Text style={s.value}>{tanggalJamPabrik(data.cutoffAt)}</Text>
                    </View>
                    <View style={[s.cell, { width: inLeft(26) }]}>
                      <Text style={s.label}>Delivery date / time</Text>
                      <Text style={s.value}>{tanggalCetak(data.deliveryDate)} · {jamCetak(data.arrivalTime)}</Text>
                    </View>
                    <View style={[s.cell, s.last, { width: inLeft(26) }]}>
                      <Text style={s.label}>Supplier part no.</Text>
                      <Text style={s.value}>{card.supplierPartNo}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', height: 42 }}>
                    <View style={[s.cell, { width: inLeft(24) }]}>
                      <Text style={s.label}>DO#</Text>
                      <Text style={s.value}>{no}</Text>
                    </View>
                    <View style={[s.cell, s.last, { width: inLeft(52) }]}>
                      <Text style={s.label}>Box qty / UOM</Text>
                      <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold' }}>{card.qtyPerBox} {card.uom}</Text>
                    </View>
                  </View>
                </View>
                <View style={{ width: col.d, alignItems: 'center', justifyContent: 'center' }}>
                  {qr.get(card.kanbanId) ? <Image src={qr.get(card.kanbanId)!} style={s.qr} /> : null}
                </View>
              </View>

              {/* Baris 3: back number | dock code | serial — mengisi sisa tinggi kartu */}
              <View style={{ flexDirection: 'row', flexGrow: 1 }}>
                {/* Label selalu di atas, nilai di tengah sisa tinggi sel: sejajar di ketiga kolom. */}
                <View style={[s.cell, { width: '50%', backgroundColor: INK }]}>
                  <Text style={[s.label, { color: '#bbb' }]}>Back number</Text>
                  <View style={s.fill}>
                    <Text style={{ color: '#fff', fontSize: 40, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{card.backNo}</Text>
                  </View>
                </View>
                <View style={[s.cell, { width: col.c }]}>
                  <Text style={s.label}>Dock code</Text>
                  <View style={s.fill}>
                    <Text style={{ fontSize: 24, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{data.truckStation ?? card.rack ?? '-'}</Text>
                  </View>
                </View>
                <View style={[s.cell, s.last, { width: col.d }]}>
                  <Text style={s.label}>Serial</Text>
                  <View style={s.fill}>
                    <Text style={{ fontSize: 24, fontFamily: 'Helvetica-Bold', textAlign: 'right' }}>{String(card.serial).padStart(5, '0')}</Text>
                    <Text style={[s.small, { textAlign: 'right', marginTop: 2 }]}>{card.boxType ?? ''}</Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
}
