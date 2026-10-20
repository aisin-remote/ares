import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  and,
  asc,
  auditLogs,
  count,
  desc,
  eq,
  getMasterTable,
  inArray,
  like,
  or,
  orderStandards,
  parts,
  permissions,
  plants,
  poHeaders,
  poLines,
  roles,
  users,
  vendorParts,
  vendors,
  type Database,
} from '@ares/db';
import {
  buildCreateSchema,
  buildUpdateSchema,
  buildVendorPartSelfSchema,
  orderStandardsBulkSchema,
  VENDOR_PART_SELF_FIELDS,
  getEntityDef,
  isMasterEntity,
  type MasterEntity,
} from '@ares/contracts';
import { InjectDb } from '../db/db.module';

export interface MasterActor {
  userId: number;
  role: string;
}

export interface ListParams {
  page: number;
  perPage: number;
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
}

type Row = Record<string, unknown> & { id: number };

/** Data autentikasi akun tidak pernah dikirim ke browser atau disimpan di audit. */
function publicRow(entity: MasterEntity, row: Row): Row {
  if (entity !== 'users') return row;
  const {
    passwordHash: _passwordHash,
    totpSecretEncrypted: _legacyAuthenticatorSecret,
    ...safe
  } = row;
  return safe as Row;
}

function dbError(err: unknown): Error {
  const error = err as { errno?: number; cause?: { errno?: number } };
  const errno = error?.errno ?? error?.cause?.errno;
  if (errno === 1062) return new ConflictException('Data dengan kunci yang sama sudah ada');
  if (errno === 1452)
    return new BadRequestException('Referensi tidak ditemukan atau tidak lagi berlaku');
  return err as Error;
}

function validationError(error: { issues: { path: (string | number)[]; message: string }[] }) {
  return new BadRequestException({
    message: 'Data yang dikirim tidak valid',
    details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
  });
}

function labelOf(row: Row): { label: string; short: string } {
  const code = row.sapVendorNo ?? row.partNo ?? row.npk ?? row.code ?? row.date;
  const name = row.name;
  const short = String(code ?? name ?? row.id);
  return { label: code && name ? `${String(code)} — ${String(name)}` : short, short };
}

/** F-01–F-09: CRUD registry dengan audit dalam transaksi yang sama. */
@Injectable()
export class MasterService {
  constructor(@InjectDb() private readonly db: Database) {}

  // Tabel dipilih dari whitelist tetap. Union tipe tabel Drizzle tidak bisa
  // diteruskan ke query builder generik tanpa cast di satu batas ini.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private table(entity: MasterEntity): any {
    return getMasterTable(entity);
  }

  private async assertExtraPermission(entity: MasterEntity, actor: MasterActor) {
    const action =
      entity === 'users'
        ? 'user.write'
        : entity === 'vendorCutoffs' || entity === 'holidays'
          ? 'setting.write'
          : null;
    if (!action) return;
    const [row] = await this.db
      .select({ id: permissions.id })
      .from(permissions)
      .innerJoin(roles, eq(permissions.roleId, roles.id))
      .where(and(eq(roles.name, actor.role), eq(permissions.action, action)))
      .limit(1);
    if (!row) throw new ForbiddenException(`Peran ${actor.role} tidak punya hak ${action}`);
  }

  private async assertReadPermission(entity: MasterEntity, actor: MasterActor) {
    if (entity !== 'users') return;
    const [row] = await this.db
      .select({ id: permissions.id })
      .from(permissions)
      .innerJoin(roles, eq(permissions.roleId, roles.id))
      .where(and(eq(roles.name, actor.role), eq(permissions.action, 'user.write')))
      .limit(1);
    if (!row) throw new ForbiddenException(`Peran ${actor.role} tidak punya hak user.write`);
  }

  private sortColumn(entity: MasterEntity, sort?: string) {
    const def = getEntityDef(entity);
    const table = this.table(entity);
    const allowed = new Set([...def.fields.map((field) => field.name), 'id']);
    const name = sort && allowed.has(sort) ? sort : def.defaultSort;
    return table[name] ?? table.id;
  }

  private searchCondition(entity: MasterEntity, q?: string) {
    if (!q) return undefined;
    const table = this.table(entity);
    const columns = getEntityDef(entity)
      .searchFields.map((field) => table[field])
      .filter(Boolean);
    return columns.length ? or(...columns.map((column) => like(column, `%${q}%`))) : undefined;
  }

  async list(entity: MasterEntity, params: ListParams, actor: MasterActor) {
    await this.assertReadPermission(entity, actor);
    const table = this.table(entity);
    const where = this.searchCondition(entity, params.q);
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(table)
        .where(where)
        .orderBy((params.dir === 'desc' ? desc : asc)(this.sortColumn(entity, params.sort)))
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
      this.db.select({ value: count() }).from(table).where(where),
    ]);
    const total = Number(totals[0]?.value ?? 0);
    return {
      data: (rows as Row[]).map((row) => publicRow(entity, row)),
      meta: {
        page: params.page,
        perPage: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  async get(entity: MasterEntity, id: number, actor?: MasterActor) {
    if (actor) await this.assertReadPermission(entity, actor);
    const table = this.table(entity);
    const [row] = await this.db.select().from(table).where(eq(table.id, id)).limit(1);
    if (!row)
      throw new NotFoundException(`${getEntityDef(entity).singular} #${id} tidak ditemukan`);
    return publicRow(entity, row as Row);
  }

  /** Pilihan relasi read-only juga mencakup peran, pabrik, dan item PO. */
  async options(entity: string, actor: MasterActor) {
    if (entity === 'roles') {
      const rows = await this.db.select().from(roles).orderBy(asc(roles.id));
      return rows
        .filter((row) => actor.role !== 'ppic' || row.name === 'supplier')
        .map((row) => ({ value: row.id, ...labelOf(row as Row) }));
    }
    if (entity === 'plants') {
      const table = plants;
      const rows = await this.db.select().from(table).orderBy(asc(table.id));
      return rows.map((row) => ({ value: row.id, ...labelOf(row as Row) }));
    }
    if (entity === 'poLines') {
      const rows = await this.db
        .select({
          id: poLines.id,
          poNo: poHeaders.sapPoNo,
          item: poLines.item,
          partNo: parts.partNo,
        })
        .from(poLines)
        .innerJoin(poHeaders, eq(poLines.poId, poHeaders.id))
        .innerJoin(parts, eq(poLines.partId, parts.id))
        .orderBy(asc(poHeaders.sapPoNo), asc(poLines.item));
      return rows.map((row) => ({
        value: row.id,
        label: `${row.poNo} / ${row.item} — ${row.partNo}`,
        short: `${row.poNo}/${row.item}`,
      }));
    }
    if (entity === 'vendorParts') {
      const rows = await this.db
        .select({
          id: vendorParts.id,
          vendorName: vendors.name,
          partNo: parts.partNo,
          backNo: vendorParts.backNo,
        })
        .from(vendorParts)
        .innerJoin(vendors, eq(vendorParts.vendorId, vendors.id))
        .innerJoin(parts, eq(vendorParts.partId, parts.id))
        .where(eq(vendorParts.isActive, true))
        .orderBy(asc(vendors.name), asc(parts.partNo));
      return rows.map((row) => ({
        value: row.id,
        label: `${row.vendorName} — ${row.partNo} (${row.backNo})`,
        short: `${row.partNo} · ${row.vendorName}`,
      }));
    }
    if (!isMasterEntity(entity))
      throw new BadRequestException(`Entitas master "${entity}" tidak dikenal`);
    await this.assertReadPermission(entity, actor);
    const table = this.table(entity);
    const rows = await this.db
      .select()
      .from(table)
      .where(
        getEntityDef(entity).fields.some((field) => field.name === 'isActive')
          ? eq(table.isActive, true)
          : undefined,
      )
      .orderBy(asc(this.sortColumn(entity)));
    return (rows as Row[]).map((row) => ({ value: row.id, ...labelOf(row) }));
  }

  private async userValues(
    values: Record<string, unknown>,
    current?: Row,
    actor?: MasterActor,
  ): Promise<Record<string, unknown>> {
    const { password, ...rest } = values;
    const output = { ...rest };
    if (password !== undefined)
      output.passwordHash = await bcrypt.hash(
        String(password),
        Number(process.env.BCRYPT_ROUNDS ?? 12),
      );
    const roleId = Number(output.roleId ?? current?.roleId);
    const [role] = await this.db
      .select({ name: roles.name })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);
    if (!role) throw new BadRequestException('Peran yang dipilih tidak ditemukan');
    if (actor?.role === 'ppic') {
      const [currentRole] = current
        ? await this.db
            .select({ name: roles.name })
            .from(roles)
            .where(eq(roles.id, Number(current.roleId)))
            .limit(1)
        : [];
      if ((current && currentRole?.name !== 'supplier') || role.name !== 'supplier') {
        throw new ForbiddenException('PPIC hanya dapat membuat dan mengubah akun supplier');
      }
    }
    const vendorId = output.vendorId === undefined ? current?.vendorId : output.vendorId;
    const rawEmail = output.email === undefined ? current?.email : output.email;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : rawEmail;
    if (output.email !== undefined) output.email = email;
    if (role.name === 'supplier' && !vendorId)
      throw new BadRequestException('Akun supplier harus memilih perusahaan supplier');
    if (role.name === 'supplier' && !email)
      throw new BadRequestException('Akun supplier harus memiliki email untuk menerima OTP');
    if (role.name === 'supplier') {
      const [vendor] = await this.db
        .select({ id: vendors.id, plantId: vendors.plantId, isActive: vendors.isActive })
        .from(vendors)
        .where(eq(vendors.id, Number(vendorId)))
        .limit(1);
      if (!vendor?.isActive)
        throw new BadRequestException('Perusahaan supplier tidak ditemukan atau sudah nonaktif');
      output.vendorId = vendor.id;
      output.plantId = vendor.plantId;
    } else {
      output.vendorId = null;
    }
    return output;
  }

  async create(entity: MasterEntity, body: unknown, actor: MasterActor) {
    await this.assertExtraPermission(entity, actor);
    const parsed = buildCreateSchema(entity).safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);
    const table = this.table(entity);
    const values = entity === 'users' ? await this.userValues(parsed.data, undefined, actor) : parsed.data;
    try {
      return await this.db.transaction(async (tx) => {
        const result = await tx.insert(table).values(values);
        const id = Number(result[0].insertId);
        const [after] = await tx.select().from(table).where(eq(table.id, id)).limit(1);
        if (!after) throw new Error('Baris master baru tidak ditemukan setelah INSERT');
        await tx.insert(auditLogs).values({
          entity,
          entityId: String(id),
          action: 'CREATE',
          userId: actor.userId,
          before: null,
          after: publicRow(entity, after as Row),
        });
        return publicRow(entity, after as Row);
      });
    } catch (error) {
      throw dbError(error);
    }
  }

  /**
   * Simpan seluruh standar order satu supplier dalam satu transaksi.
   * Nilai null menonaktifkan standar lama; barisnya tidak dihapus agar audit
   * dan riwayat referensinya tetap utuh.
   */
  async saveOrderStandards(body: unknown, actor: MasterActor) {
    const parsed = orderStandardsBulkSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);
    const { vendorId, lines } = parsed.data;
    const vendorPartIds = lines.map((line) => line.vendorPartId);

    return this.db.transaction(async (tx) => {
      const ownedParts = await tx
        .select({ id: vendorParts.id })
        .from(vendorParts)
        .where(
          and(
            eq(vendorParts.vendorId, vendorId),
            eq(vendorParts.isActive, true),
            inArray(vendorParts.id, vendorPartIds),
          ),
        );
      if (ownedParts.length !== vendorPartIds.length) {
        throw new BadRequestException(
          'Ada part yang tidak aktif atau bukan milik supplier yang dipilih',
        );
      }

      const existingRows = await tx
        .select()
        .from(orderStandards)
        .where(inArray(orderStandards.vendorPartId, vendorPartIds))
        .for('update');
      const existingByPart = new Map(existingRows.map((row) => [row.vendorPartId, row]));
      let saved = 0;
      let inactive = 0;
      let unchanged = 0;

      for (const line of lines) {
        const before = existingByPart.get(line.vendorPartId);
        if (line.standardKanban === null) {
          if (!before?.isActive) {
            unchanged += 1;
            continue;
          }
          await tx
            .update(orderStandards)
            .set({ isActive: false })
            .where(eq(orderStandards.id, before.id));
          const after = { ...before, isActive: false };
          await tx.insert(auditLogs).values({
            entity: 'orderStandards',
            entityId: String(before.id),
            action: 'DEACTIVATE',
            userId: actor.userId,
            before,
            after,
          });
          inactive += 1;
          continue;
        }

        if (before) {
          if (before.isActive && before.standardKanban === line.standardKanban) {
            unchanged += 1;
            continue;
          }
          await tx
            .update(orderStandards)
            .set({ standardKanban: line.standardKanban, isActive: true })
            .where(eq(orderStandards.id, before.id));
          const [after] = await tx
            .select()
            .from(orderStandards)
            .where(eq(orderStandards.id, before.id))
            .limit(1);
          await tx.insert(auditLogs).values({
            entity: 'orderStandards',
            entityId: String(before.id),
            action: before.isActive ? 'UPDATE' : 'ACTIVATE',
            userId: actor.userId,
            before,
            after,
          });
          saved += 1;
          continue;
        }

        const result = await tx.insert(orderStandards).values({
          vendorPartId: line.vendorPartId,
          standardKanban: line.standardKanban,
          isActive: true,
        });
        const id = Number(result[0].insertId);
        const [after] = await tx
          .select()
          .from(orderStandards)
          .where(eq(orderStandards.id, id))
          .limit(1);
        await tx.insert(auditLogs).values({
          entity: 'orderStandards',
          entityId: String(id),
          action: 'CREATE',
          userId: actor.userId,
          before: null,
          after,
        });
        saved += 1;
      }

      return { saved, inactive, unchanged };
    });
  }

  async update(entity: MasterEntity, id: number, body: unknown, actor: MasterActor) {
    await this.assertExtraPermission(entity, actor);
    const parsed = buildUpdateSchema(entity).safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);
    const provided = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );
    if (!Object.keys(provided).length) return this.get(entity, id, actor);
    const table = this.table(entity);
    try {
      return await this.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(table)
          .where(eq(table.id, id))
          .limit(1)
          .for('update');
        if (!before)
          throw new NotFoundException(`${getEntityDef(entity).singular} #${id} tidak ditemukan`);
        const values =
          entity === 'users' ? await this.userValues(provided, before as Row, actor) : provided;
        const candidate = { ...(before as Row), ...values };
        if (
          candidate.isActive === true &&
          entity === 'vendors' &&
          !String(candidate.sapVendorNo ?? '').trim()
        ) {
          throw new BadRequestException('Isi nomor vendor SAP sebelum supplier diaktifkan');
        }
        if (candidate.isActive === true && entity === 'vendorCutoffs') {
          if (
            candidate.sourceKey &&
            candidate.cutoffTime === '00:00:00' &&
            candidate.arrivalTime === '00:00:00'
          ) {
            throw new BadRequestException(
              'Isi jam cutoff dan jam datang sebelum jadwal diaktifkan',
            );
          }
          const [vendor] = await tx
            .select({ active: vendors.isActive, sapNo: vendors.sapVendorNo })
            .from(vendors)
            .where(eq(vendors.id, Number(candidate.vendorId)))
            .limit(1);
          if (!vendor?.active || !vendor.sapNo) {
            throw new BadRequestException(
              'Aktifkan supplier dan isi nomor vendor SAP terlebih dahulu',
            );
          }
        }
        await tx.update(table).set(values).where(eq(table.id, id));
        const [after] = await tx.select().from(table).where(eq(table.id, id)).limit(1);
        if (!after) throw new Error('Baris master hilang setelah UPDATE');
        const oldActive = (before as Row).isActive;
        const newActive = (after as Row).isActive;
        const action =
          oldActive !== newActive
            ? newActive
              ? 'ACTIVATE'
              : 'DEACTIVATE'
            : 'password' in provided && Object.keys(provided).length === 1
              ? 'RESET_PASSWORD'
              : 'UPDATE';
        await tx.insert(auditLogs).values({
          entity,
          entityId: String(id),
          action,
          userId: actor.userId,
          before: publicRow(entity, before as Row),
          after: publicRow(entity, after as Row),
        });
        return publicRow(entity, after as Row);
      });
    } catch (error) {
      throw dbError(error);
    }
  }

  /**
   * Supplier mengubah atribut kemasan vendor part MILIKNYA sendiri.
   *
   * Terpisah dari `update()` biasa dan tidak memakai `master.write`: yang
   * boleh berubah hanya kolom `vendorEditable` (back number, rak, tipe box —
   * yang tercetak di kanban). Qty per box, part, supplier, PO item, dan status
   * aktif tetap milik PPIC karena menentukan konversi pcs→box dan penerbitan
   * order (6.1, 6.6).
   *
   * Barisnya disaring dengan vendorId dari sesi di WHERE yang sama dengan id
   * (aturan repo 9), jadi vendor part supplier lain menjawab 404 — bukan 403
   * yang justru mengonfirmasi nomornya ada.
   */
  async updateVendorPartSelf(id: number, body: unknown, actor: MasterActor & { vendorId: number }) {
    const parsed = buildVendorPartSelfSchema().safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);
    const provided = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );
    if (!Object.keys(provided).length) {
      throw new BadRequestException('Tidak ada perubahan yang dikirim');
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(vendorParts)
          .where(and(eq(vendorParts.id, id), eq(vendorParts.vendorId, actor.vendorId)))
          .limit(1)
          .for('update');
        if (!before) throw new NotFoundException(`Vendor Part #${id} tidak ditemukan`);

        await tx.update(vendorParts).set(provided).where(eq(vendorParts.id, id));
        const [after] = await tx.select().from(vendorParts).where(eq(vendorParts.id, id)).limit(1);
        if (!after) throw new Error('Baris vendor part hilang setelah UPDATE');

        // F-54: jejaknya dibedakan dari UPDATE PPIC supaya terlihat siapa yang
        // mengubah kemasan — PPIC memeriksanya lewat entity yang sama.
        await tx.insert(auditLogs).values({
          entity: 'vendorParts',
          entityId: String(id),
          action: 'UPDATE_BY_VENDOR',
          userId: actor.userId,
          before: before as Row,
          after: after as Row,
        });
        return { row: after as Row, before: before as Row };
      });
    } catch (error) {
      throw dbError(error);
    }
  }

  /** Kolom yang boleh diubah supplier; dipakai controller untuk ringkasan perubahan. */
  static vendorEditableFields(): string[] {
    return VENDOR_PART_SELF_FIELDS.map((field) => field.name);
  }

  async setActive(entity: MasterEntity, id: number, isActive: boolean, actor: MasterActor) {
    if (!getEntityDef(entity).fields.some((field) => field.name === 'isActive'))
      throw new BadRequestException(`${getEntityDef(entity).label} tidak punya status aktif`);
    return this.update(entity, id, { isActive }, actor);
  }
}
