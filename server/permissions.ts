import type { Ctx, AuthUser } from './types';
import { forbidden, notFound, HttpError } from './errors';

export interface LabRow {
  id: string; name: string; code: string; description: string; course: string; building: string;
  room_number: string; capacity: number; schedule: string; starts_on: string | null; ends_on: string | null;
  status: 'active' | 'archived'; created_by: string; created_at: string; updated_at: string;
}

export function getLab(ctx: Ctx, labId: string): LabRow {
  const lab = ctx.db.prepare('SELECT * FROM labs WHERE id = ?').get(labId) as LabRow | undefined;
  if (!lab) throw notFound('Laboratory not found.');
  return lab;
}

export function isLabStaff(ctx: Ctx, user: AuthUser, labId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'staff') return false;
  return !!ctx.db.prepare('SELECT 1 FROM lab_staff WHERE lab_id = ? AND user_id = ?').get(labId, user.id);
}

export function isLabMember(ctx: Ctx, user: AuthUser, labId: string): boolean {
  if (isLabStaff(ctx, user, labId)) return true;
  return !!ctx.db.prepare("SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'").get(labId, user.id);
}

export function requireLabMember(ctx: Ctx, user: AuthUser, labId: string): LabRow {
  const lab = getLab(ctx, labId);
  if (!isLabMember(ctx, user, labId)) throw forbidden('You do not have access to this laboratory.');
  return lab;
}

export function requireLabStaff(ctx: Ctx, user: AuthUser, labId: string): LabRow {
  const lab = getLab(ctx, labId);
  if (!isLabStaff(ctx, user, labId)) throw forbidden('Only staff assigned to this laboratory can do that.');
  return lab;
}

/** Lab ids the user may manage (staff: assigned, admin: all). */
export function managedLabIds(ctx: Ctx, user: AuthUser): string[] {
  if (user.role === 'admin') return (ctx.db.prepare('SELECT id FROM labs').all() as { id: string }[]).map((r) => r.id);
  if (user.role === 'staff') return (ctx.db.prepare('SELECT lab_id AS id FROM lab_staff WHERE user_id = ?').all(user.id) as { id: string }[]).map((r) => r.id);
  return [];
}

/** Lab ids the user can read (member or staff). */
export function accessibleLabIds(ctx: Ctx, user: AuthUser): string[] {
  if (user.role === 'admin') return managedLabIds(ctx, user);
  const rows = ctx.db
    .prepare(`SELECT lab_id AS id FROM lab_members WHERE user_id = ? AND status='active' UNION SELECT lab_id FROM lab_staff WHERE user_id = ?`)
    .all(user.id, user.id) as { id: string }[];
  return rows.map((r) => r.id);
}

export const inClause = (ids: string[]) => (ids.length ? ids.map(() => '?').join(',') : "''");

export function assertLabActive(lab: LabRow) {
  if (lab.status !== 'active') throw new HttpError(409, 'LAB_ARCHIVED', 'This laboratory is archived. Reactivate it to continue.');
}
