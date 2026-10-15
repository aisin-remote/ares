export interface GrSapItemValidation {
  poNo: string | null;
  poItem: string | null;
  material: string | null;
  qty: number;
  uom: string | null;
  poMatchesVendor: boolean;
  poMatchesPart: boolean;
  poOpenQty: number | null;
}

export interface GrSapValidation {
  plant: string | null;
  vendorNo: string | null;
  items: GrSapItemValidation[];
}

/** Menahan GR yang belum cukup aman untuk diposting ke PO SAP. */
export function validateGrForSap(input: GrSapValidation): string[] {
  const errors: string[] = [];
  if (!input.plant?.trim()) errors.push('Kode plant belum tersedia');
  if (!input.vendorNo?.trim()) errors.push('Nomor SAP supplier belum tersedia');
  if (input.items.length === 0) return [...errors, 'Receipt tidak memiliki barang yang diterima'];

  input.items.forEach((item, index) => {
    const prefix = `Baris ${index + 1}:`;
    if (!item.poNo?.trim()) errors.push(`${prefix} nomor PO belum tersedia`);
    if (!item.poItem?.trim()) errors.push(`${prefix} item PO belum tersedia`);
    if (!item.material?.trim()) errors.push(`${prefix} material SAP belum tersedia`);
    if (!Number.isInteger(item.qty) || item.qty <= 0)
      errors.push(`${prefix} quantity harus lebih dari 0`);
    if (!item.uom?.trim()) errors.push(`${prefix} UOM belum tersedia`);
    if (!item.poMatchesVendor) errors.push(`${prefix} PO tidak aktif untuk supplier ini`);
    if (!item.poMatchesPart) errors.push(`${prefix} item PO tidak sesuai dengan part`);
    if (item.poOpenQty != null && item.qty > item.poOpenQty)
      errors.push(`${prefix} quantity ${item.qty} melebihi sisa PO ${item.poOpenQty}`);
  });
  return errors;
}
