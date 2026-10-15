import React from 'react';
import type * as ReactPdf from '@react-pdf/renderer';
import type { KanbanDocData } from './document.types';
import { jamCetak, nomorRevisi, tanggalCetak, tanggalJamPabrik } from './format';
import { AISIN_LOGO } from './aisin-logo';

/** Tiga kartu horizontal per A4, mengikuti kartu purchase yang dipakai supplier. */
export function kanbanDocument(
  pdf: typeof ReactPdf,
  data: KanbanDocData,
  qr: Map<string, Buffer>,
): React.ReactElement<ReactPdf.DocumentProps> {
  const { Document, Page, View, Text, Image, StyleSheet } = pdf;
  const no = nomorRevisi(data.picklistNo, data.revision);
  const s = StyleSheet.create({
    page: { padding: 12, fontFamily: 'Helvetica' },
    card: { height: 260, borderWidth: 1.2, borderColor: '#111', marginBottom: 7, padding: 8 },
    row: { flexDirection: 'row' },
    cell: { borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: '#555', padding: 4 },
    label: { fontSize: 6, color: '#444', marginBottom: 2 },
    value: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
    purchase: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
    badge: { backgroundColor: '#111', color: '#fff', paddingVertical: 4, paddingHorizontal: 9,
      fontSize: 8, fontFamily: 'Helvetica-Bold' },
    logo: { width: 66, height: 29, objectFit: 'contain' },
    qr: { width: 74, height: 74 },
    back: { backgroundColor: '#111', color: '#fff', fontFamily: 'Helvetica-Bold',
      fontSize: 30, textAlign: 'center', paddingVertical: 7 },
    big: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
    serial: { fontSize: 19, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
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
              <View style={[s.row, { alignItems: 'center', marginBottom: 5 }]}>
                <View style={{ width: '33%' }}><Text style={s.purchase}>&lt;PURCHASE&gt;</Text></View>
                <View style={{ width: '34%', alignItems: 'center' }}><Text style={s.badge}>Additional</Text></View>
                <View style={{ width: '33%', alignItems: 'flex-end' }}>
                  <Image src={AISIN_LOGO} style={s.logo} />
                </View>
              </View>
              <View style={[s.row, { borderTopWidth: 0.8, borderLeftWidth: 0.8, borderColor: '#555' }]}>
                <View style={[s.cell, { width: '24%' }]}><Text style={s.label}>Supplier code / name</Text><Text style={s.value}>{data.sapVendorNo}</Text><Text style={{ fontSize: 7 }}>{data.vendorName}</Text></View>
                <View style={[s.cell, { width: '52%' }]}><Text style={s.label}>Part number / name</Text><Text style={[s.value, { fontSize: 13 }]}>{card.partNo}</Text><Text style={{ fontSize: 8 }}>{card.partName}</Text></View>
                <View style={[s.cell, { width: '24%', borderRightWidth: 0 }]}><Text style={s.label}>Order Sheet / Cycle</Text><Text style={s.value}>{no}</Text><Text>Cycle {data.cycle}</Text></View>
              </View>
              <View style={[s.row, { borderLeftWidth: 0.8, borderColor: '#555' }]}>
                <View style={{ width: '76%' }}>
                  <View style={s.row}>
                    <View style={[s.cell, { width: '34%' }]}><Text style={s.label}>Shipping date / time</Text><Text style={s.value}>{tanggalJamPabrik(data.cutoffAt)}</Text></View>
                    <View style={[s.cell, { width: '33%' }]}><Text style={s.label}>Delivery date / time</Text><Text style={s.value}>{tanggalCetak(data.deliveryDate)}</Text><Text>{jamCetak(data.arrivalTime)}</Text></View>
                    <View style={[s.cell, { width: '33%' }]}><Text style={s.label}>Supplier part no.</Text><Text style={s.value}>{card.supplierPartNo}</Text></View>
                  </View>
                  <View style={s.row}>
                    <View style={[s.cell, { width: '45%', borderBottomWidth: 0 }]}><Text style={s.label}>DO#</Text><Text style={s.value}>{no}</Text></View>
                    <View style={[s.cell, { width: '55%', borderBottomWidth: 0 }]}><Text style={s.label}>Box qty / UOM</Text><Text style={s.big}>{card.qtyPerBox} {card.uom}</Text></View>
                  </View>
                </View>
                <View style={[s.cell, { width: '24%', borderRightWidth: 0, borderBottomWidth: 0, alignItems: 'center' }]}>
                  {qr.get(card.kanbanId) ? <Image src={qr.get(card.kanbanId)!} style={s.qr} /> : null}
                </View>
              </View>
              <View style={[s.row, { marginTop: 6, alignItems: 'stretch' }]}>
                <View style={{ width: '43%', paddingRight: 6 }}><Text style={s.label}>Back number</Text><Text style={s.back}>{card.backNo}</Text></View>
                <View style={{ width: '27%', paddingHorizontal: 6, borderLeftWidth: 0.6, borderColor: '#555' }}><Text style={s.label}>Dock code</Text><Text style={[s.big, { fontSize: 27 }]}>{data.truckStation ?? card.rack ?? '-'}</Text></View>
                <View style={{ width: '30%', paddingLeft: 6, borderLeftWidth: 0.6, borderColor: '#555' }}><Text style={s.label}>Serial</Text><Text style={s.serial}>{String(card.serial).padStart(5, '0')}</Text><Text style={{ fontSize: 7, textAlign: 'right' }}>{card.boxType ?? ''}</Text></View>
              </View>
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
}
