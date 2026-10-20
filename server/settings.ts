import type { DB } from './db';
import { nowIso } from './db';

export const DEFAULT_SETTINGS = {
  'files.maxSizeMB': 25,
  'files.labQuotaMB': 500,
  'files.allowedExtensions': [
    'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'csv', 'json',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'wav', 'mp4', 'webm', 'zip',
    'c', 'h', 'cpp', 'java', 'py', 'js', 'ts', 'html', 'css', 'sql', 'sh', 'ipynb',
  ] as string[],
  'ai.enabled': true,
  'ai.model': '',
  'ai.maxRequestsPerUserPerDay': 50,
  'ai.maxInputChars': 12000,
  'ai.maxOutputTokens': 1024,
  'attendance.requireQrCheckin': false,
  'attendance.allowConcurrentLabs': false,
  'attendance.maxSessionMinutes': 480,
  'retention.messagesDays': 365,
  'retention.notificationsDays': 90,
  'chat.editWindowMinutes': 15,
  'chat.maxMessageChars': 4000,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export interface Settings {
  get<K extends SettingKey>(key: K): (typeof DEFAULT_SETTINGS)[K];
  all(): Record<string, unknown>;
  set(key: string, value: unknown, userId: string | null): void;
}

export function createSettings(db: DB): Settings {
  const read = db.prepare('SELECT value_json FROM system_settings WHERE key = ?');
  return {
    get(key) {
      const row = read.get(key) as { value_json: string } | undefined;
      if (!row) return DEFAULT_SETTINGS[key];
      try {
        return JSON.parse(row.value_json);
      } catch {
        return DEFAULT_SETTINGS[key];
      }
    },
    all() {
      const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const r of db.prepare('SELECT key, value_json FROM system_settings').all() as { key: string; value_json: string }[]) {
        try { out[r.key] = JSON.parse(r.value_json); } catch { /* ignore corrupt row */ }
      }
      return out;
    },
    set(key, value, userId) {
      db.prepare(
        `INSERT INTO system_settings(key, value_json, updated_by, updated_at) VALUES(?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      ).run(key, JSON.stringify(value), userId, nowIso());
    },
  };
}
