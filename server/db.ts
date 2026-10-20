import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','staff','admin')),
  requested_role TEXT,
  department TEXT NOT NULL DEFAULT '',
  student_or_staff_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  prefs_json TEXT NOT NULL DEFAULT '{}',
  token_version INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  course TEXT NOT NULL DEFAULT '',
  building TEXT NOT NULL DEFAULT '',
  room_number TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 30,
  schedule TEXT NOT NULL DEFAULT '',
  starts_on TEXT,
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_staff (
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (lab_id, user_id)
);

CREATE TABLE IF NOT EXISTS lab_members (
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_role TEXT NOT NULL DEFAULT 'student',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (lab_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_lab_members_user ON lab_members(user_id, status);

CREATE TABLE IF NOT EXISTS room_access_codes (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_codes_lab ON room_access_codes(lab_id);

CREATE TABLE IF NOT EXISTS join_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  lab_id TEXT,
  success INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_join_attempts_user ON join_attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_join_attempts_ip ON join_attempts(ip, created_at);

CREATE TABLE IF NOT EXISTS lab_sessions (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  scheduled_start TEXT,
  scheduled_end TEXT,
  start_at TEXT,
  end_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('scheduled','active','ended')),
  checkin_token_hash TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_lab ON lab_sessions(lab_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_session ON lab_sessions(lab_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES lab_sessions(id) ON DELETE CASCADE,
  check_in_at TEXT NOT NULL,
  check_out_at TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('checked_in','checked_out','missing_checkout')),
  method TEXT NOT NULL DEFAULT 'self' CHECK (method IN ('self','staff','qr')),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','corrected')),
  created_at TEXT NOT NULL,
  UNIQUE (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_att_student ON attendance_records(student_id, check_in_at);
CREATE INDEX IF NOT EXISTS idx_att_lab ON attendance_records(lab_id, check_in_at);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id TEXT PRIMARY KEY,
  attendance_id TEXT NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  editor_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  previous_json TEXT NOT NULL,
  new_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','announcement','file')),
  reply_to TEXT,
  attachment_file_id TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_lab ON messages(lab_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_message_client ON messages(sender_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_reports (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (message_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS lab_reads (
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (lab_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  session_id TEXT,
  uploader_id TEXT NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  storage_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'type_verified',
  indexed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_lab ON files(lab_id, created_at);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(lab_id, sha256);

CREATE TABLE IF NOT EXISTS file_reports (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (file_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS doc_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  lab_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON doc_chunks(file_id);
CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(text, content='doc_chunks', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_lab ON announcements(lab_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  dedupe_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notif_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  lab_id TEXT REFERENCES labs(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  detection_method TEXT NOT NULL CHECK (detection_method IN ('rule','ai')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_lab ON alerts(lab_id, status, created_at);

CREATE TABLE IF NOT EXISTS incident_reviews (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TABLE IF NOT EXISTS ai_summaries (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_ids TEXT NOT NULL DEFAULT '[]',
  content_json TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_chat (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lab_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_user ON ai_chat(user_id, created_at);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
`;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

export const nowIso = () => new Date().toISOString();
