/**
 * Demo data for LOCAL DEVELOPMENT ONLY. Refuses to run in production.
 * Creates demo accounts that all share one documented password so you can click around quickly.
 *   npm run seed
 */
import 'dotenv/config';
import { loadConfig } from '../server/config';
import { openDatabase, nowIso } from '../server/db';
import { hashPassword, newId, hashRoomCode, generateRoomCode } from '../server/security';
import { DEFAULT_PREFS } from '../server/services';

const DEMO_PASSWORD = 'Demo-Pass-2026';

async function main() {
  const config = loadConfig();
  if (config.isProduction) throw new Error('Refusing to seed demo data in production.');
  const db = openDatabase(config.databasePath);
  const t = nowIso();
  const hash = await hashPassword(DEMO_PASSWORD, config.bcryptRounds);
  const mk = (email: string, name: string, role: string, dept: string, sid: string) => {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = newId();
    db.prepare(`INSERT INTO users(id,email,password_hash,display_name,role,department,student_or_staff_id,status,email_verified,prefs_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)`)
      .run(id, email, hash, name, role, dept, sid, 'active', JSON.stringify(DEFAULT_PREFS), t, t);
    return id;
  };
  const staff = mk('demo.staff@example.edu', 'Dr. Meera Iyer', 'staff', 'Computer Science', 'STF-001');
  const students = [['asha', 'Asha Raman'], ['kabir', 'Kabir Shah'], ['lena', 'Lena Thomas'], ['omar', 'Omar Haddad']].map(([k, n], i) => mk(`demo.${k}@example.edu`, n, 'student', 'Computer Science', `CS26${100 + i}`));

  if (!db.prepare("SELECT 1 FROM labs WHERE code = 'DEMO-DS'").get()) {
    const lab = newId();
    db.prepare(`INSERT INTO labs(id,name,code,description,course,building,room_number,capacity,schedule,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(lab, 'Data Structures Lab', 'DEMO-DS', 'Hands-on practice with lists, trees and graphs.', 'CS204', 'Main Block', '302', 30, 'Mon & Wed 10:00-12:00', staff, t, t);
    db.prepare('INSERT INTO lab_staff(lab_id,user_id) VALUES(?,?)').run(lab, staff);
    for (const s of students) db.prepare("INSERT INTO lab_members(lab_id,user_id,membership_role,status,joined_at) VALUES(?,?,'student','active',?)").run(lab, s, t);
    const code = generateRoomCode();
    db.prepare('INSERT INTO room_access_codes(id,lab_id,code_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)')
      .run(newId(), lab, hashRoomCode(config.jwtSecret, code), staff, t, new Date(Date.now() + 7 * 864e5).toISOString());
    const start = new Date(Date.now() - 26 * 3600e3);
    const session = newId();
    db.prepare("INSERT INTO lab_sessions(id,lab_id,title,start_at,end_at,status,created_by,created_at) VALUES(?,?,?,?,?,'ended',?,?)").run(session, lab, 'Week 3 - Linked lists', start.toISOString(), new Date(start.getTime() + 2 * 3600e3).toISOString(), staff, t);
    students.slice(0, 3).forEach((s, i) => {
      const inAt = new Date(start.getTime() + (5 + i * 3) * 60e3);
      const outAt = i === 2 ? null : new Date(start.getTime() + 115 * 60e3);
      db.prepare(`INSERT INTO attendance_records(id,student_id,lab_id,session_id,check_in_at,check_out_at,duration_minutes,status,method,verification_status,created_at) VALUES(?,?,?,?,?,?,?,?, 'self','pending',?)`)
        .run(newId(), s, lab, session, inAt.toISOString(), outAt?.toISOString() ?? null, outAt ? Math.round((outAt.getTime() - inAt.getTime()) / 60e3) : 0, outAt ? 'checked_out' : 'missing_checkout', t);
    });
    db.prepare('INSERT INTO messages(id,lab_id,sender_id,content,created_at) VALUES(?,?,?,?,?)').run(newId(), lab, staff, 'Welcome! Upload your linked-list exercises here before Friday.', t);
    db.prepare('INSERT INTO messages(id,lab_id,sender_id,content,created_at) VALUES(?,?,?,?,?)').run(newId(), lab, students[0], 'Is a doubly linked list allowed for exercise 2?', t);
    console.log(`Created demo lab "Data Structures Lab". A fresh access code (for the join dialog) is: ${code}`);
  }
  console.log(`Demo accounts (password: ${DEMO_PASSWORD}):\n  staff   demo.staff@example.edu\n  student demo.asha@example.edu, demo.kabir@example.edu, demo.lena@example.edu, demo.omar@example.edu`);
  db.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
