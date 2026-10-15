import { redirect } from 'next/navigation';
import { PackageSearch } from 'lucide-react';
import { listVendorPartsForVendor } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { VendorPartRow } from '@/components/portal/vendor-part-row';

export const dynamic = 'force-dynamic';

/**
 * Vendor part milik supplier sendiri (F-02).
 *
 * Supplier memelihara atribut kemasan yang tercetak di kanban — back number,
 * rak, tipe box — karena merekalah yang tahu isinya. Qty per box, part, dan
 * status aktif tetap milik PPIC: angka itu menentukan konversi pcs→box dan
 * jumlah order (6.1). Setiap perubahan tercatat di audit dan dikabarkan ke
 * PPIC lewat email.
 */
export default async function PortalVendorPartPage() {
  const user = await getSessionUser();
  if (user?.vendorId == null) redirect('/login');
  if (!user.permissions.includes('vendorPart.self')) redirect('/portal');

  const rows = await listVendorPartsForVendor(user.vendorId);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Vendor part' }]}
        title="Vendor part"
        description={`${rows.length} part yang Anda pasok — perbarui back number, rak, dan tipe box`}
      />

      <Reveal>
        <Card>
          <CardHeader
            icon={PackageSearch}
            title="Kemasan & lokasi"
            subtitle="Perubahan langsung berlaku untuk kanban yang dicetak berikutnya, dan PPIC diberi tahu"
          />
          <Table>
            <thead>
              <tr>
                <Th>Part</Th>
                <Th align="right">Qty/box</Th>
                <Th>Back number</Th>
                <Th>Rak</Th>
                <Th>Tipe box</Th>
                <Th align="right">Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyState colSpan={6}>
                  Belum ada vendor part aktif untuk akun Anda. Hubungi PPIC bila ada part yang
                  seharusnya Anda pasok tetapi belum terdaftar.
                </EmptyState>
              ) : (
                rows.map((row) => <VendorPartRow key={row.id} row={row} />)
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      <p className="mt-5 text-[14px] text-ink-muted">
        Qty per box, daftar part, dan status aktif diatur PPIC — hubungi PPIC bila kemasan Anda
        berubah isinya, bukan hanya penandaannya.
      </p>
    </>
  );
}
