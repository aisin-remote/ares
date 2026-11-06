import React from 'react';
import type * as ReactPdf from '@react-pdf/renderer';
import type { DeliverySheetData } from './document.types';
import { orderSheetStyles } from './picklist-doc';
import { jamCetak, nomorRevisi, tanggalCetak, tanggalJamPabrik, waktuCetak } from './format';

/**
 * Delivery Sheet (F-30): terbit setelah supplier mengonfirmasi kirim, dibawa
 * bersama barang, dan barcode-nya membuka sesi scan kedatangan (F-34).
 * Susunannya sama dengan Order Sheet; bedanya DO# (= nomor Order Sheet dengan
 * dua digit recovery), PO# dari SAP, dan qty yang benar-benar dikirim.
 */
export function deliverySheetDocument(
  pdf: typeof ReactPdf,
  data: DeliverySheetData,
  barcode: Buffer,
  qr: Buffer,
  dicetakPada: Date,
): React.ReactElement<ReactPdf.DocumentProps> {
  const { Document, Page, View, Text, Image } = pdf;
  const doNo = nomorRevisi(data.picklistNo, data.revision);
  const poNo = data.poNumbers.join(', ') || '-';
  const s = orderSheetStyles(pdf);
  const w = [4, 7, 20, 8, 6, 6, 8, 9, 8, 7, 17] as const;
  const heads = ['No', 'Dock Code', 'AISIN Part # / Supplier Part #', 'Back number', 'Box qty',
    'Order unit', 'Order qty', 'Undelivered qty', 'Shipping qty', '# of Box', 'PO / item'];

  return (
    <Document title={`Delivery Sheet ${doNo}`} author="ARES" subject={`Kiriman ${data.vendorName}`}>
      <Page size="A4" style={s.page}>
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <View style={{ width: 90 }}><Text style={s.badge}>Additional</Text></View>
          <View style={{ flex: 1 }}><Text style={s.title}>Delivery Sheet (PURCHASE)</Text><Text style={s.subtitle}>DO No. {doNo}</Text></View>
          <View style={{ width: 90, alignItems: 'flex-end' }}><Image src={qr} style={s.qr} /></View>
        </View>

        <View style={s.meta}>
          <View style={s.row}>
            <View style={[s.cell, { width: '25%' }]}><Text style={s.label}>Customer / Plant</Text><Text style={s.value}>{data.plantName}</Text><Text>{data.plantCode}</Text></View>
            <View style={[s.cell, { width: '30%' }]}><Text style={s.label}>Supplier</Text><Text style={s.value}>{data.vendorName}</Text><Text>{data.sapVendorNo}{data.vendorAddress ? ` · ${data.vendorAddress}` : ''}</Text></View>
            <View style={[s.cell, { width: '15%' }]}><Text style={s.label}>DO#</Text><Text style={s.value}>{doNo}</Text></View>
            <View style={[s.cell, { width: '17%' }]}><Text style={s.label}>PO#</Text><Text style={s.value}>{poNo}</Text></View>
            <View style={[s.cell, { width: '13%', borderRightWidth: 0 }]}><Text style={s.label}>Total boxes</Text><Text style={[s.value, { fontSize: 12 }]}>{data.totalBoxShipped}</Text></View>
          </View>
          <View style={s.row}>
            <View style={[s.cell, { width: '25%', borderBottomWidth: 0 }]}><Text style={s.label}>Shipping date / time</Text><Text style={s.value}>{tanggalJamPabrik(data.shippedAt)}</Text></View>
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
              <Text style={[s.td, s.right, { width: `${w[7]}%` }]}>{line.undeliveredPcs}</Text>
              <Text style={[s.td, s.right, { width: `${w[8]}%` }]}>{line.shippedPcs}</Text>
              <Text style={[s.td, s.right, { width: `${w[9]}%`, fontFamily: 'Helvetica-Bold' }]}>{line.boxShipped}</Text>
              <Text style={[s.td, { width: `${w[10]}%`, borderRightWidth: 0 }]}>{line.sapPoNo} / {line.sapPoItem}</Text>
            </View>
          ))}
        </View>

        <View style={s.instructions}><Text style={[s.label, { fontFamily: 'Helvetica-Bold' }]}>SPECIAL INSTRUCTIONS</Text><Text>{data.note ?? ''}</Text></View>
        <Image src={barcode} style={s.barcode} /><Text style={[s.center, { fontFamily: 'Helvetica-Bold', fontSize: 9, marginTop: 2 }]}>{doNo}</Text>
        <Text style={s.footer} render={({ pageNumber, totalPages }) => `DO ${doNo} · ARES · printed ${waktuCetak(dicetakPada)} · page ${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
