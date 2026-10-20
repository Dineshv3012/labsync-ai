import fs from 'fs';
import path from 'path';
import type { Ctx } from './types';
import { raiseAlert, audit } from './services';
import { nowIso } from './db';

/** Deletes data older than the configured retention windows. Audit logs are never purged (append-only). */
export function runRetention(ctx: Ctx) {
  const msgCutoff = new Date(Date.now() - ctx.settings.get('retention.messagesDays') * 86400000).toISOString();
  const notifCutoff = new Date(Date.now() - ctx.settings.get('retention.notificationsDays') * 86400000).toISOString();
  const messages = ctx.db.prepare('DELETE FROM messages WHERE created_at < ?').run(msgCutoff).changes;
  const notifications = ctx.db.prepare('DELETE FROM notifications WHERE created_at < ?').run(notifCutoff).changes;
  const stale = ctx.db.prepare('DELETE FROM join_attempts WHERE created_at < ?').run(new Date(Date.now() - 30 * 86400000).toISOString()).changes;
  // Remove files soft-deleted more than a day ago (physical files are already unlinked at delete time).
  const orphan = ctx.db.prepare("SELECT storage_name FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?").all(new Date(Date.now() - 86400000).toISOString()) as { storage_name: string }[];
  for (const o of orphan) fs.promises.unlink(path.join(ctx.config.uploadDir, o.storage_name)).catch(() => {});
  return { messagesDeleted: messages, notificationsDeleted: notifications, staleAttemptsDeleted: stale };
}

/** Flags check-ins that have exceeded the maximum session length. Never auto-marks anyone absent. */
export function detectMissingCheckouts(ctx: Ctx) {
  const limit = ctx.settings.get('attendance.maxSessionMinutes');
  const cutoff = new Date(Date.now() - limit * 60_000).toISOString();
  const rows = ctx.db.prepare("SELECT a.id, a.lab_id, u.display_name AS name FROM attendance_records a JOIN users u ON u.id=a.student_id WHERE a.status='checked_in' AND a.check_in_at < ?").all(cutoff) as { id: string; lab_id: string; name: string }[];
  for (const r of rows) {
    ctx.db.prepare("UPDATE attendance_records SET status='missing_checkout', verification_status='pending' WHERE id=?").run(r.id);
    raiseAlert(ctx, { labId: r.lab_id, type: 'missing_checkout', severity: 'low', title: `${r.name} has not checked out after ${limit} minutes`, evidence: { attendanceId: r.id, limitMinutes: limit }, dedupeKey: `missing-rec:${r.id}` });
  }
  return rows.length;
}

export function startJobs(ctx: Ctx): () => void {
  const timers = [
    setInterval(() => { try { detectMissingCheckouts(ctx); } catch (e) { console.error('[job] missing checkouts', e); } }, 5 * 60_000),
    setInterval(() => {
      try { const out = runRetention(ctx); audit(ctx, null, 'RETENTION_RUN', 'system', 'retention', { ...out, trigger: 'scheduled' }); } catch (e) { console.error('[job] retention', e); }
    }, 24 * 3600_000),
  ];
  timers.forEach((t) => t.unref());
  return () => timers.forEach(clearInterval);
}
void nowIso;
