import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { fileTypeFromFile } from 'file-type';
import type { Ctx } from '../types';
import { reqUser } from '../types';
import { HttpError, badRequest, forbidden, notFound, parse, wrap } from '../errors';
import { accessibleLabIds, assertLabActive, inClause, isLabMember, isLabStaff, requireLabMember } from '../permissions';
import { newId, safeFileName, sha256 } from '../security';
import { audit, notifyLabMembers, raiseAlert } from '../services';
import { indexFile } from '../ai/rag';
import { extOf } from '../ai/extract';
import { nowIso } from '../db';

// Extensions that are plain text: magic-byte sniffing cannot identify them, so they are validated as text instead.
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'c', 'h', 'cpp', 'java', 'py', 'js', 'ts', 'html', 'css', 'sql', 'sh', 'ipynb']);
const EXPECTED: Record<string, string[]> = {
  pdf: ['pdf'], png: ['png'], jpg: ['jpg'], jpeg: ['jpg'], gif: ['gif'], webp: ['webp'], zip: ['zip'],
  docx: ['docx', 'zip'], pptx: ['pptx', 'zip'], xlsx: ['xlsx', 'zip'], doc: ['cfb'], ppt: ['cfb'], xls: ['cfb'],
  mp3: ['mp3'], wav: ['wav'], mp4: ['mp4', 'mov'], webm: ['webm', 'mkv'],
};
const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']);
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', zip: 'application/zip', csv: 'text/csv', json: 'application/json',
};

export const fileDto = (f: any) => ({
  id: f.id, labId: f.lab_id, labName: f.lab_name, name: f.original_name, size: f.size, contentType: f.content_type, uploaderId: f.uploader_id,
  uploaderName: f.uploader_name, createdAt: f.created_at, scanStatus: f.scan_status, indexed: !!f.indexed, previewable: INLINE_SAFE.has(f.content_type),
});
const SELECT = `SELECT f.*, u.display_name AS uploader_name, l.name AS lab_name FROM files f JOIN users u ON u.id=f.uploader_id JOIN labs l ON l.id=f.lab_id`;

function looksLikeText(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
    return true;
  } finally { fs.closeSync(fd); }
}

export function fileRoutes(ctx: Ctx) {
  const r = Router();
  fs.mkdirSync(ctx.config.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({ destination: ctx.config.uploadDir, filename: (_q, _f, cb) => cb(null, `${newId()}.upload`) }),
    limits: { fileSize: 200 * 1024 * 1024, files: 1 },
  });

  const labUsage = (labId: string) => (ctx.db.prepare('SELECT COALESCE(SUM(size),0) s FROM files WHERE lab_id=? AND deleted_at IS NULL').get(labId) as any).s as number;

  r.post('/labs/:id/files', upload.single('file'), wrap(async (req, res) => {
    const u = reqUser(req);
    const tmp = req.file?.path;
    const cleanup = () => { if (tmp) fs.promises.unlink(tmp).catch(() => {}); };
    try {
      const lab = requireLabMember(ctx, u, String(req.params.id));
      assertLabActive(lab);
      if (!req.file) throw badRequest('Choose a file to upload.');
      const name = safeFileName(req.file.originalname ? Buffer.from(req.file.originalname, 'latin1').toString('utf8') : 'file');
      const ext = extOf(name);
      const maxMb = ctx.settings.get('files.maxSizeMB');
      const reject = (code: string, msg: string, status = 400) => {
        audit(ctx, u, 'FILE_REJECTED', 'file', lab.id, { name, reason: code }, req);
        if (code === 'FILE_TYPE_NOT_ALLOWED' || code === 'FILE_CONTENT_MISMATCH') {
          raiseAlert(ctx, { labId: lab.id, type: 'unexpected_file_type', severity: code === 'FILE_CONTENT_MISMATCH' ? 'high' : 'low', title: `Rejected upload "${name}" by ${u.name}`, evidence: { userId: u.id, name, extension: ext, reason: code }, dedupeKey: `badfile:${u.id}:${sha256(name + Date.now().toString().slice(0, -4))}` });
        }
        throw new HttpError(status, code, msg);
      };
      if (req.file.size > maxMb * 1024 * 1024) reject('FILE_TOO_LARGE', `Files can be at most ${maxMb} MB.`, 413);
      if (!ext || !ctx.settings.get('files.allowedExtensions').includes(ext)) reject('FILE_TYPE_NOT_ALLOWED', `.${ext || 'unknown'} files are not allowed. Ask an administrator if you need this type.`);
      if (labUsage(lab.id) + req.file.size > ctx.settings.get('files.labQuotaMB') * 1024 * 1024) reject('QUOTA_EXCEEDED', 'This laboratory has reached its storage quota.', 413);

      // Validate real content, not just the extension.
      const detected = await fileTypeFromFile(req.file.path);
      let contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
      if (TEXT_EXT.has(ext)) {
        if (!looksLikeText(req.file.path) || detected) reject('FILE_CONTENT_MISMATCH', 'This file claims to be text but its content is binary.');
        if (!MIME_BY_EXT[ext]) contentType = 'text/plain';
      } else {
        if (!detected || !(EXPECTED[ext] ?? []).includes(detected.ext)) reject('FILE_CONTENT_MISMATCH', `The content of this file does not match its .${ext} extension.`);
        contentType = MIME_BY_EXT[ext] ?? detected!.mime;
      }
      if (detected && ['exe', 'elf', 'macho', 'msi', 'dmg', 'class'].includes(detected.ext)) reject('FILE_CONTENT_MISMATCH', 'Executable files are not allowed.');

      const hash = sha256(fs.readFileSync(req.file.path));
      const dupe = ctx.db.prepare('SELECT f.id, f.original_name, f.uploader_id FROM files f WHERE f.lab_id=? AND f.sha256=? AND f.deleted_at IS NULL').get(lab.id, hash) as any;
      const id = newId();
      const storage = `${id}.bin`;
      fs.renameSync(req.file.path, path.join(ctx.config.uploadDir, storage));
      ctx.db.prepare('INSERT INTO files(id,lab_id,session_id,uploader_id,original_name,storage_name,content_type,size,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, lab.id, (ctx.db.prepare("SELECT id FROM lab_sessions WHERE lab_id=? AND status='active'").get(lab.id) as any)?.id ?? null, u.id, name, storage, contentType, req.file.size, hash, nowIso());
      if (dupe) raiseAlert(ctx, { labId: lab.id, type: 'duplicate_upload', severity: 'low', title: `Possible duplicate upload "${name}"`, evidence: { newFileId: id, existingFileId: dupe.id, existingName: dupe.original_name, sameUploader: dupe.uploader_id === u.id }, dedupeKey: `dup:${id}` });
      audit(ctx, u, 'FILE_UPLOAD', 'file', id, { labId: lab.id, name, size: req.file.size }, req);
      indexFile(ctx, { id, lab_id: lab.id, original_name: name, storage_name: storage }).catch(() => {});
      const dto = fileDto(ctx.db.prepare(`${SELECT} WHERE f.id=?`).get(id));
      ctx.rt.emitToLab(lab.id, 'file:new', dto);
      notifyLabMembers(ctx, lab.id, u.id, 'file', `New file in ${lab.name}`, `${u.name} shared ${name}`, `/lab_room?lab=${lab.id}`);
      res.status(201).json({ file: dto, duplicateOf: dupe ? { id: dupe.id, name: dupe.original_name } : null });
    } catch (e) { cleanup(); throw e; }
  }));

  r.get('/files', wrap((req, res) => {
    const u = reqUser(req);
    const q = parse(z.object({
      labId: z.string().optional(), q: z.string().trim().max(100).optional(), type: z.enum(['image', 'document', 'code', 'media', 'archive']).optional(),
      sort: z.enum(['date', 'name', 'size', 'uploader']).default('date'), order: z.enum(['asc', 'desc']).default('desc'),
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }), req.query);
    const ids = accessibleLabIds(ctx, u);
    if (q.labId && !ids.includes(q.labId)) throw forbidden('You do not have access to this laboratory.');
    const scope = q.labId ? [q.labId] : ids;
    if (!scope.length) return res.json({ files: [], total: 0, page: q.page, pageSize: q.pageSize });
    const where = [`f.lab_id IN (${inClause(scope)})`, 'f.deleted_at IS NULL'];
    const params: unknown[] = [...scope];
    if (q.q) { where.push("f.original_name LIKE ? ESCAPE '\\'"); params.push(`%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`); }
    const groups: Record<string, string[]> = {
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp'], document: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'csv'],
      code: ['c', 'h', 'cpp', 'java', 'py', 'js', 'ts', 'html', 'css', 'sql', 'sh', 'ipynb', 'json'], media: ['mp3', 'wav', 'mp4', 'webm'], archive: ['zip'],
    };
    if (q.type) { where.push(`(${groups[q.type].map(() => "LOWER(f.original_name) LIKE ?").join(' OR ')})`); params.push(...groups[q.type].map((e) => `%.${e}`)); }
    const col = { date: 'f.created_at', name: 'f.original_name COLLATE NOCASE', size: 'f.size', uploader: 'u.display_name COLLATE NOCASE' }[q.sort];
    const total = (ctx.db.prepare(`SELECT COUNT(*) c FROM files f JOIN users u ON u.id=f.uploader_id WHERE ${where.join(' AND ')}`).get(...params) as any).c;
    const rows = ctx.db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${col} ${q.order === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`).all(...params, q.pageSize, (q.page - 1) * q.pageSize);
    res.json({ files: rows.map(fileDto), total, page: q.page, pageSize: q.pageSize });
  }));

  r.get('/labs/:id/storage', wrap((req, res) => {
    const lab = requireLabMember(ctx, reqUser(req), String(req.params.id));
    res.json({ usedBytes: labUsage(lab.id), quotaBytes: ctx.settings.get('files.labQuotaMB') * 1024 * 1024, maxFileMB: ctx.settings.get('files.maxSizeMB'), allowedExtensions: ctx.settings.get('files.allowedExtensions') });
  }));

  const loadFile = (req: any) => {
    const u = reqUser(req);
    const f = ctx.db.prepare(`${SELECT} WHERE f.id=? AND f.deleted_at IS NULL`).get(String(req.params.id)) as any;
    if (!f) throw notFound('File not found.');
    if (!isLabMember(ctx, u, f.lab_id)) throw forbidden('You do not have access to this file.');
    return { u, f };
  };

  r.get('/files/:id/download', wrap((req, res) => {
    const { u, f } = loadFile(req);
    const file = path.join(ctx.config.uploadDir, f.storage_name);
    if (!fs.existsSync(file)) throw notFound('The stored file is missing.');
    const inline = req.query.inline === '1' && INLINE_SAFE.has(f.content_type);
    res.setHeader('Content-Type', inline ? f.content_type : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    if (!inline) audit(ctx, u, 'FILE_DOWNLOAD', 'file', f.id, { labId: f.lab_id }, req);
    fs.createReadStream(file).pipe(res);
  }));

  r.get('/files/:id/text', wrap((req, res) => {
    const { f } = loadFile(req);
    if (!['txt', 'md', 'csv', 'json', 'c', 'h', 'cpp', 'java', 'py', 'js', 'ts', 'html', 'css', 'sql', 'sh'].includes(extOf(f.original_name))) throw badRequest('No text preview for this file type.');
    const buf = fs.readFileSync(path.join(ctx.config.uploadDir, f.storage_name)).subarray(0, 100_000);
    res.json({ text: buf.toString('utf8'), truncated: f.size > 100_000 });
  }));

  r.delete('/files/:id', wrap((req, res) => {
    const { u, f } = loadFile(req);
    if (f.uploader_id !== u.id && !isLabStaff(ctx, u, f.lab_id)) throw forbidden('Only the uploader or lab staff can delete this file.');
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE files SET deleted_at=? WHERE id=?').run(nowIso(), f.id);
      ctx.db.prepare('DELETE FROM doc_chunks WHERE file_id=?').run(f.id);
    })();
    fs.promises.unlink(path.join(ctx.config.uploadDir, f.storage_name)).catch(() => {});
    audit(ctx, u, 'FILE_DELETE', 'file', f.id, { labId: f.lab_id, name: f.original_name }, req);
    ctx.rt.emitToLab(f.lab_id, 'file:deleted', { id: f.id, labId: f.lab_id });
    res.json({ ok: true });
  }));

  r.post('/files/:id/report', wrap((req, res) => {
    const { u, f } = loadFile(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }).strict(), req.body);
    ctx.db.prepare('INSERT OR IGNORE INTO file_reports(id,file_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)').run(newId(), f.id, u.id, reason, nowIso());
    audit(ctx, u, 'FILE_REPORT', 'file', f.id, { labId: f.lab_id }, req);
    raiseAlert(ctx, { labId: f.lab_id, type: 'file_reported', severity: 'medium', title: `File "${f.original_name}" was reported`, evidence: { fileId: f.id, reporterId: u.id, reason }, dedupeKey: `filerep:${f.id}:${u.id}` });
    res.json({ ok: true });
  }));

  return r;
}
