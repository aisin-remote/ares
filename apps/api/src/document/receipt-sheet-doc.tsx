import React from 'react';
import type * as ReactPdf from '@react-pdf/renderer';
import type { ReceiptSheetData } from './document.types';
import { orderSheetStyles } from './picklist-doc';
import { jamCetak, nomorRevisi, tanggalCetak, tanggalJamPabrik, waktuCetak } from './format';

/**
 * Receipt Sheet: dicetak PPIC setelah sesi scan ditutup (6.5) sebagai bukti
 * terima. Susunannya sama dengan Order Sheet dan Delivery Sheet; angkanya
 * dari TT_RECEIPT_L sesi ini, bukan dari konfirmasi kirim supplier.
 */
export function receiptSheetDocument(
  pdf: typeof ReactPdf,
  data: ReceiptSheetData,
  qr: Buffer,
  dicetakPada: Date,
): React.ReactElement<ReactPdf.DocumentProps> {
  const { Document, Page, View, Text, Image } = pdf;
  const doNo = nomorRevisi(data.picklistNo, data.revision);
  const poNo = data.poNumbers.join(', ') || '-';
  const ulang = String(data.repeatNo).padStart(2, '0');
  const s = orderSheetStyles(pdf);
  const w = [4, 7, 20, 8, 6, 6, 8, 9, 8, 7, 17] as const;
  const heads = ['No', 'Dock Code', 'AISIN Part # / Supplier Part #', 'Back number', 'Box qty',
    'Unit of measure', 'Order qty', 'Undelivered qty', 'Received qty', '# of Box', 'PO / item'];

  return (
    <Document title={`Receipt Sheet ${data.receiptNo}`} author="ARES" subject={`Penerimaan DO ${doNo}`}>
      <Page size="A4" style={s.page}>
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <View style={{ width: 90 }}><Text style={s.badge}>Additional</Text></View>
          <View style={{ flex: 1 }}><Text style={s.title}>AISIN Receipt Sheet (PURCHASE)</Text><Text style={s.subtitle}>Receipt No. {data.receiptNo}</Text></View>
          <View style={{ width: 90, alignItems: 'flex-end' }}><Image src={qr} style={s.qr} /></View>
        </View>

        <View style={s.meta}>
          <View style={s.row}>
            <View style={[s.cell, { width: '25%' }]}><Text style={s.label}>Customer / Plant</Text><Text style={s.value}>{data.plantName}</Text><Text>{data.plantCode}</Text></View>
            <View style={[s.cell, { width: '30%' }]}><Text style={s.label}>Supplier</Text><Text style={s.value}>{data.vendorName}</Text><Text>{data.sapVendorNo}{data.vendorAddress ? ` · ${data.vendorAddress}` : ''}</Text></View>
            <View style={[s.cell, { width: '15%' }]}><Text style={s.label}>Delivery order #</Text><Text style={s.value}>{doNo}</Text></View>
            <View style={[s.cell, { width: '17%' }]}><Text style={s.label}>PO#</Text><Text style={s.value}>{poNo}</Text></View>
            <View style={[s.cell, { width: '13%', borderRightWidth: 0 }]}><Text style={s.label}>Total boxes</Text><Text style={[s.value, { fontSize: 12 }]}>{data.totalBoxReceived}</Text></View>
          </View>
          <View style={s.row}>
            <View style={[s.cell, { width: '25%', borderBottomWidth: 0 }]}><Text style={s.label}>Delivery date / time</Text><Text style={s.value}>{tanggalCetak(data.deliveryDate)} · {jamCetak(data.arrivalTime)}</Text></View>
            <View style={[s.cell, { width: '30%', borderBottomWidth: 0 }]}><Text style={s.label}>Ship date / time</Text><Text style={s.value}>{data.shippedAt ? tanggalJamPabrik(data.shippedAt) : '-'}</Text></View>
            <View style={[s.cell, { width: '15%', borderBottomWidth: 0 }]}><Text style={s.label}>Receiving date / time</Text><Text style={s.value}>{tanggalJamPabrik(data.receivedAt)}</Text></View>
            <View style={[s.cell, { width: '17%', borderBottomWidth: 0 }]}><Text style={s.label}>DO receiving repeated no.</Text><Text style={s.value}>{ulang}</Text></View>
            <View style={[s.cell, { width: '13%', borderRightWidth: 0, borderBottomWidth: 0 }]}><Text style={s.label}>Truck no.</Text><Text style={s.value}>{data.vehicleNo ?? '-'}</Text></View>
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
              <Text style={[s.td, s.right, { width: `${w[6]}%` }]}>{line.orderPcs}</Text>
              <Text style={[s.td, s.right, { width: `${w[7]}%` }]}>{line.undeliveredPcs}</Text>
              <Text style={[s.td, s.right, { width: `${w[8]}%` }]}>{line.receivedPcs}</Text>
              <Text style={[s.td, s.right, { width: `${w[9]}%`, fontFamily: 'Helvetica-Bold' }]}>{line.boxReceived}</Text>
              <Text style={[s.td, { width: `${w[10]}%`, borderRightWidth: 0 }]}>{line.sapPoNo} / {line.sapPoItem}</Text>
            </View>
          ))}
        </View>

        <View style={s.instructions}><Text style={[s.label, { fontFamily: 'Helvetica-Bold' }]}>REMARK</Text><Text>{data.note ?? ''}</Text></View>
        {/* Kolom tanda tangan/stempel, seperti form operasional AIIA. */}
        <View style={[s.row, { position: 'absolute', right: 22, bottom: 30, borderWidth: 0.7, borderColor: '#222' }]} fixed>
          {[0, 1, 2, 3].map((i) => <View key={i} style={{ width: 62, height: 22, borderRightWidth: i === 3 ? 0 : 0.7, borderColor: '#222' }} />)}
        </View>
        <Text style={s.footer} render={({ pageNumber, totalPages }) => `${data.receiptNo} · DO ${doNo} · ARES · printed ${waktuCetak(dicetakPada)} · page ${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
