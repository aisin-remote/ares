import React from 'react';
import type * as ReactPdf from '@react-pdf/renderer';
import type { PicklistDocData } from './document.types';
import { jamCetak, nomorRevisi, tanggalCetak, tanggalJamPabrik, waktuCetak } from './format';

/** Order Sheet supplier, mengikuti susunan form operasional AIIA. */
export function picklistDocument(
  pdf: typeof ReactPdf,
  data: PicklistDocData,
  barcode: Buffer,
  qr: Buffer,
  dicetakPada: Date,
): React.ReactElement<ReactPdf.DocumentProps> {
  const { Document, Page, View, Text, Image, StyleSheet } = pdf;
  const no = nomorRevisi(data.picklistNo, data.revision);
  const s = StyleSheet.create({
    page: { padding: 22, paddingBottom: 35, fontSize: 7.5, fontFamily: 'Helvetica', color: '#111' },
    row: { flexDirection: 'row' },
    badge: { backgroundColor: '#111', color: '#fff', paddingVertical: 5, paddingHorizontal: 12,
      fontFamily: 'Helvetica-Bold', fontSize: 9, alignSelf: 'flex-start' },
    title: { fontSize: 15, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 2 },
    subtitle: { fontSize: 7, textAlign: 'center', marginTop: 3 },
    qr: { width: 66, height: 66 },
    meta: { borderWidth: 0.7, borderColor: '#222', marginTop: 7 },
    cell: { padding: 4, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#777' },
    label: { fontSize: 6, color: '#555', marginBottom: 2 },
    value: { fontFamily: 'Helvetica-Bold', fontSize: 8 },
    table: { marginTop: 8, borderWidth: 0.7, borderColor: '#222' },
    th: { paddingVertical: 4, paddingHorizontal: 2, fontSize: 5.8, fontFamily: 'Helvetica-Bold',
      textAlign: 'center', borderRightWidth: 0.4, borderColor: '#777' },
    td: { paddingVertical: 5, paddingHorizontal: 2, borderRightWidth: 0.4,
      borderTopWidth: 0.4, borderColor: '#aaa', fontSize: 6.5 },
    right: { textAlign: 'right' },
    center: { textAlign: 'center' },
    instructions: { borderWidth: 0.7, borderColor: '#222', padding: 6, marginTop: 9, minHeight: 42 },
    barcode: { width: 225, height: 38, alignSelf: 'center', marginTop: 10 },
    footer: { position: 'absolute', left: 22, right: 22, bottom: 14, fontSize: 6, color: '#555' },
  });
  const w = [4, 8, 21, 9, 7, 7, 8, 7, 10, 9, 10] as const;
  const heads = ['No', 'Dock Code', 'AISIN Part # / Supplier Part #', 'Back number', 'Box qty',
    'Order unit', 'Order qty', '# of Box', 'Confirmed qty', 'Shipping completed', 'PO / item'];

  return (
    <Document title={`Order Sheet ${no}`} author="ARES" subject={`Order ke ${data.vendorName}`}>
      <Page size="A4" style={s.page}>
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <View style={{ width: 90 }}><Text style={s.badge}>Additional</Text></View>
          <View style={{ flex: 1 }}><Text style={s.title}>Order Sheet (PURCHASE)</Text><Text style={s.subtitle}>Order No. {no}</Text></View>
          <View style={{ width: 90, alignItems: 'flex-end' }}><Image src={qr} style={s.qr} /></View>
        </View>

        <View style={s.meta}>
          <View style={s.row}>
            <View style={[s.cell, { width: '25%' }]}><Text style={s.label}>Customer / Plant</Text><Text style={s.value}>{data.plantName}</Text><Text>{data.plantCode}</Text></View>
            <View style={[s.cell, { width: '40%' }]}><Text style={s.label}>Supplier</Text><Text style={s.value}>{data.vendorName}</Text><Text>{data.sapVendorNo}{data.vendorAddress ? ` · ${data.vendorAddress}` : ''}</Text></View>
            <View style={[s.cell, { width: '20%' }]}><Text style={s.label}>Delivery order no.</Text><Text style={s.value}>{no}</Text></View>
            <View style={[s.cell, { width: '15%', borderRightWidth: 0 }]}><Text style={s.label}>Total boxes</Text><Text style={[s.value, { fontSize: 12 }]}>{data.totalBox}</Text></View>
          </View>
          <View style={s.row}>
            <View style={[s.cell, { width: '25%', borderBottomWidth: 0 }]}><Text style={s.label}>Shipping date / time</Text><Text style={s.value}>{tanggalJamPabrik(data.cutoffAt)}</Text></View>
            <View style={[s.cell, { width: '25%', borderBottomWidth: 0 }]}><Text style={s.label}>Delivery date / time</Text><Text style={s.value}>{tanggalCetak(data.deliveryDate)} · {jamCetak(data.arrivalTime)}</Text></View>
            <View style={[s.cell, { width: '20%', borderBottomWidth: 0 }]}><Text style={s.label}>Truck no.</Text><Text style={s.value}>{data.vehicleNo ?? '-'}</Text></View>
            <View style={[s.cell, { width: '15%', borderBottomWidth: 0 }]}><Text style={s.label}>Cycle</Text><Text style={s.value}>{data.cycle}</Text></View>
            <View style={[s.cell, { width: '15%', borderRightWidth: 0, borderBottomWidth: 0 }]}><Text style={s.label}>Type</Text><Text style={s.value}>{data.type}</Text></View>
          </View>
        </View>

        <View style={s.table}>
          <View style={[s.row, { backgroundColor: '#d9d9d9' }]} fixed>
            {heads.map((head, i) => <Text key={head} style={[s.th, { width: `${w[i]}%`, borderRightWidth: i === heads.length - 1 ? 0 : 0.4 }]}>{head}</Text>)}
          </View>
          {data.lines.map((line, row) => (
            <View key={line.no} style={[s.row, row % 2 ? { backgroundColor: '#eee' } : {}]} wrap={false}>
              <Text style={[s.td, s.center, { width: `${w[0]}%` }]}>{line.no}</Text>
              <Text style={[s.td, s.center, { width: `${w[1]}%` }]}>{data.truckStation ?? line.rack ?? '-'}</Text>
              <View style={[s.td, { width: `${w[2]}%` }]}><Text style={{ fontFamily: 'Helvetica-Bold' }}>{line.partNo}</Text><Text>{line.partName}</Text><Text>{line.sapMaterialNo}</Text></View>
              <Text style={[s.td, s.center, { width: `${w[3]}%`, fontFamily: 'Helvetica-Bold' }]}>{line.backNo}</Text>
              <Text style={[s.td, s.right, { width: `${w[4]}%` }]}>{line.qtyPerBox}</Text>
              <Text style={[s.td, s.center, { width: `${w[5]}%` }]}>{line.uom}</Text>
              <Text style={[s.td, s.right, { width: `${w[6]}%` }]}>{line.pcs}</Text>
              <Text style={[s.td, s.right, { width: `${w[7]}%`, fontFamily: 'Helvetica-Bold' }]}>{line.boxOrdered}</Text>
              <Text style={[s.td, { width: `${w[8]}%` }]}></Text><Text style={[s.td, { width: `${w[9]}%` }]}></Text>
              <Text style={[s.td, { width: `${w[10]}%`, borderRightWidth: 0 }]}>{line.sapPoNo} / {line.sapPoItem}</Text>
            </View>
          ))}
        </View>

        <View style={s.instructions}><Text style={[s.label, { fontFamily: 'Helvetica-Bold' }]}>SPECIAL INSTRUCTIONS</Text><Text>{data.note ?? ''}</Text></View>
        <Image src={barcode} style={s.barcode} /><Text style={[s.center, { fontFamily: 'Helvetica-Bold', fontSize: 9, marginTop: 2 }]}>{no}</Text>
        <Text style={s.footer} render={({ pageNumber, totalPages }) => `${no} · ARES · printed ${waktuCetak(dicetakPada)} · page ${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
