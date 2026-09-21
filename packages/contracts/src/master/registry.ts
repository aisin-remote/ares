import { z } from 'zod';
import { HOLIDAY_SHIFTS, ROUNDINGS, SHORT_SHIP_POLICIES } from '../status';

/** Satu definisi untuk validasi API dan formulir master (F-01–F-09). */
export const MASTER_ENTITIES = ['vendors', 'parts', 'vendorParts', 'bom', 'vendorCutoffs', 'holidays', 'users'] as const;
export type MasterEntity = (typeof MASTER_ENTITIES)[number];
export type RefEntity = MasterEntity | 'roles' | 'plants' | 'poLines';
export type FieldKind = 'text' | 'number' | 'decimal' | 'date' | 'time' | 'boolean' | 'select' | 'reference' | 'password';

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: readonly string[];
  refEntity?: RefEntity;
  inList?: boolean;
  numeric?: boolean;
  max?: number;
  min?: number;
  hint?: string;
  defaultValue?: string | number | boolean;
  /** Kolom database nullable dapat dikosongkan lagi lewat formulir. */
  nullable?: boolean;
}

export interface EntityDef {
  key: MasterEntity;
  label: string;
  singular: string;
  icon: string;
  description: string;
  searchFields: string[];
  defaultSort: string;
  fields: FieldDef[];
}

const activeField: FieldDef = {
  name: 'isActive', label: 'Aktif', kind: 'boolean', inList: true, defaultValue: true,
  hint: 'Data nonaktif tetap tersimpan untuk menjaga riwayat.',
};

export const ENTITY_DEFS: Record<MasterEntity, EntityDef> = {
  vendors: {
    key: 'vendors', label: 'Supplier', singular: 'Supplier', icon: 'Building2',
    description: 'Pemasok beserta nomor vendor SAP', searchFields: ['sapVendorNo', 'name', 'email'],
    defaultSort: 'sapVendorNo', fields: [
      { name: 'sapVendorNo', label: 'Nomor vendor SAP', kind: 'text', required: true, max: 16, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      { name: 'address', label: 'Alamat', kind: 'text', max: 255, nullable: true },
      { name: 'email', label: 'Email kontak', kind: 'text', max: 191, nullable: true, inList: true },
      activeField,
    ],
  },
  parts: {
    key: 'parts', label: 'Part', singular: 'Part', icon: 'Package',
    description: 'Material beserta nomor material SAP', searchFields: ['sapMaterialNo', 'partNo', 'name'],
    defaultSort: 'partNo', fields: [
      { name: 'sapMaterialNo', label: 'Nomor material SAP', kind: 'text', required: true, max: 40, inList: true },
      { name: 'partNo', label: 'Nomor part', kind: 'text', required: true, max: 64, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      { name: 'uom', label: 'Satuan', kind: 'text', max: 16, defaultValue: 'PC', inList: true },
      activeField,
    ],
  },
  vendorParts: {
    key: 'vendorParts', label: 'Vendor Part', singular: 'Vendor Part', icon: 'PackageSearch',
    description: 'Kemasan dan lokasi part untuk setiap supplier', searchFields: ['backNo', 'rack', 'boxType'],
    defaultSort: 'id', fields: [
      { name: 'partId', label: 'Part', kind: 'reference', refEntity: 'parts', required: true, inList: true },
      { name: 'vendorId', label: 'Supplier', kind: 'reference', refEntity: 'vendors', required: true, inList: true },
      { name: 'qtyPerBox', label: 'Jumlah per box', kind: 'number', required: true, min: 1, numeric: true, inList: true },
      { name: 'backNo', label: 'Back number', kind: 'text', required: true, max: 32, inList: true },
      { name: 'rack', label: 'Rak', kind: 'text', max: 32, nullable: true, inList: true },
      { name: 'boxType', label: 'Tipe box', kind: 'text', max: 32, nullable: true, inList: true },
      { name: 'poItemDefaultId', label: 'PO item bawaan', kind: 'reference', refEntity: 'poLines', nullable: true,
        hint: 'Opsional. Pilih item PO yang sesuai dengan part dan supplier.' },
      activeField,
    ],
  },
  bom: {
    key: 'bom', label: 'BOM', singular: 'Baris BOM', icon: 'GitBranch',
    description: 'Komposisi part jadi — komponen dan qty per induk, berversi tanggal (F-03)',
    searchFields: [], defaultSort: 'parentPartId', fields: [
      { name: 'parentPartId', label: 'Part jadi', kind: 'reference', refEntity: 'parts', required: true, inList: true,
        hint: 'Part yang dibuat.' },
      { name: 'componentPartId', label: 'Komponen', kind: 'reference', refEntity: 'parts', required: true, inList: true,
        hint: 'Part yang dibutuhkan untuk membuat induk.' },
      { name: 'qtyPer', label: 'Qty per induk', kind: 'decimal', required: true, min: 0, numeric: true, inList: true,
        hint: 'Boleh desimal — raw material dalam kg.' },
      { name: 'effectiveFrom', label: 'Berlaku dari', kind: 'date', required: true, inList: true },
      { name: 'effectiveTo', label: 'Berlaku sampai', kind: 'date', nullable: true, inList: true,
        hint: 'Kosong = masih berlaku.' },
    ],
  },
  vendorCutoffs: {
    key: 'vendorCutoffs', label: 'Cutoff Supplier', singular: 'Jadwal Cutoff', icon: 'Clock',
    description: 'Jam cutoff, hari kerja, kedatangan, dan kebijakan supplier', searchFields: ['cutoffTime', 'workdays'],
    defaultSort: 'cutoffTime', fields: [
      { name: 'vendorId', label: 'Supplier', kind: 'reference', refEntity: 'vendors', required: true, inList: true },
      { name: 'cutoffTime', label: 'Jam cutoff', kind: 'time', required: true, inList: true },
      { name: 'workdays', label: 'Hari kerja ISO', kind: 'text', required: true, max: 16, defaultValue: '1,2,3,4,5',
        hint: '1=Senin sampai 7=Minggu, pisahkan dengan koma.' },
      { name: 'leadDays', label: 'Lead time (hari kerja)', kind: 'number', required: true, min: 0, numeric: true, defaultValue: 1, inList: true },
      { name: 'arrivalTime', label: 'Jam datang', kind: 'time', required: true, inList: true },
      { name: 'holidayShift', label: 'Geser saat libur', kind: 'select', options: HOLIDAY_SHIFTS, defaultValue: 'BEFORE', inList: true },
      { name: 'shortShipPolicy', label: 'Kebijakan kurang kirim', kind: 'select', options: SHORT_SHIP_POLICIES, defaultValue: 'CARRY_OVER', inList: true },
      { name: 'rounding', label: 'Pembulatan box', kind: 'select', options: ROUNDINGS, defaultValue: 'FLOOR', inList: true },
      activeField,
    ],
  },
  holidays: {
    key: 'holidays', label: 'Kalender Libur', singular: 'Hari Libur', icon: 'CalendarDays',
    description: 'Hari libur pabrik yang memengaruhi jadwal cutoff', searchFields: ['date', 'name'],
    defaultSort: 'date', fields: [
      { name: 'date', label: 'Tanggal', kind: 'date', required: true, inList: true },
      { name: 'name', label: 'Keterangan', kind: 'text', required: true, max: 128, inList: true },
      activeField,
    ],
  },
  users: {
    key: 'users', label: 'User & Peran', singular: 'User', icon: 'Users',
    description: 'Akun internal dan supplier', searchFields: ['npk', 'name', 'email'],
    defaultSort: 'npk', fields: [
      { name: 'npk', label: 'NPK / kode akun', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      { name: 'email', label: 'Email', kind: 'text', max: 191, nullable: true, inList: true },
      { name: 'roleId', label: 'Peran', kind: 'reference', refEntity: 'roles', required: true, inList: true },
      { name: 'plantId', label: 'Pabrik', kind: 'reference', refEntity: 'plants', nullable: true },
      { name: 'vendorId', label: 'Supplier untuk akun supplier', kind: 'reference', refEntity: 'vendors', nullable: true, inList: true },
      { name: 'password', label: 'Password / reset password', kind: 'password', required: true, max: 128,
        hint: 'Saat mengubah akun, kosongkan jika password tidak diganti.' },
      activeField,
    ],
  },
};

export function isMasterEntity(value: string): value is MasterEntity {
  return (MASTER_ENTITIES as readonly string[]).includes(value);
}

export function getEntityDef(key: MasterEntity): EntityDef {
  return ENTITY_DEFS[key];
}

function blankToUndefined(value: unknown) {
  return value === '' || value === null ? undefined : value;
}

function fieldSchema(field: FieldDef, mode: 'create' | 'update'): z.ZodTypeAny {
  const required = mode === 'create' && field.required;
  const empty = (value: unknown) => value === '' && field.nullable ? null : blankToUndefined(value);
  if (field.kind === 'boolean') {
    return z.preprocess((value) => value === undefined
      ? (mode === 'create' ? field.defaultValue ?? true : undefined)
      : value === true || value === 'true' || value === 'on' ? true
        : value === false || value === 'false' ? false : value,
    mode === 'update' ? z.boolean().optional() : z.boolean());
  }
  if (field.kind === 'number' || field.kind === 'decimal' || field.kind === 'reference') {
    let schema = z.number({ required_error: `${field.label} wajib diisi`, invalid_type_error: `${field.label} harus berupa angka` });
    if (field.kind !== 'decimal') schema = schema.int(`${field.label} harus bilangan bulat`);
    schema = field.kind === 'reference' ? schema.positive(`${field.label} wajib dipilih`)
      : field.kind === 'decimal' ? schema.gt(field.min ?? 0, `${field.label} harus lebih dari ${field.min ?? 0}`)
        : schema.min(field.min ?? 0, `${field.label} minimal ${field.min ?? 0}`);
    const target = required ? schema : field.nullable ? schema.nullable().optional() : schema.optional();
    return z.preprocess((value) => {
      if (value === '' && field.nullable) return null;
      if (value === '' || value === null || value === undefined) return required ? undefined : value === null ? null : undefined;
      if (typeof value === 'string') return Number(value);
      return value;
    }, target);
  }
  if (field.kind === 'select') {
    const schema = z.enum((field.options ?? ['']) as [string, ...string[]], { errorMap: () => ({ message: `${field.label} tidak valid` }) });
    return z.preprocess((value) => value === undefined && mode === 'create' ? field.defaultValue : blankToUndefined(value),
      required ? schema : schema.optional());
  }
  const base = z.string({ required_error: `${field.label} wajib diisi` }).trim()
    .max(field.max ?? 255, `${field.label} maksimal ${field.max ?? 255} karakter`);
  const schema = field.kind === 'date' ? base.regex(/^\d{4}-\d{2}-\d{2}$/, `${field.label} harus YYYY-MM-DD`)
    : field.kind === 'time' ? base.regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, `${field.label} harus HH:MM`)
      : field.kind === 'password' ? base.min(8, 'Password minimal 8 karakter') : base;
  const withRequired = required ? schema.min(1, `${field.label} wajib diisi`) : schema;
  const validated = field.name === 'workdays'
    ? withRequired.refine((value) => /^(?:[1-7])(?:,[1-7])*$/.test(value), 'Hari kerja harus angka 1–7 dipisahkan koma')
    : field.kind === 'date'
      ? withRequired.refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, `${field.label} tidak valid`)
      : field.name === 'email' ? withRequired.email('Format email tidak valid') : withRequired;
  return z.preprocess((value) => value === undefined && mode === 'create' && field.defaultValue !== undefined
    ? field.defaultValue : empty(value), required ? validated : field.nullable ? validated.nullable().optional() : validated.optional());
}

export function buildCreateSchema(key: MasterEntity) {
  return z.object(Object.fromEntries(getEntityDef(key).fields.map((field) => [field.name, fieldSchema(field, 'create')])));
}

export function buildUpdateSchema(key: MasterEntity) {
  return z.object(Object.fromEntries(getEntityDef(key).fields.map((field) => [field.name, fieldSchema(field, 'update')])));
}

export type MasterRow = Record<string, unknown> & { id: number };
