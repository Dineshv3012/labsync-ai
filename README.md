# LabSync AI

Smart computer-laboratory management and collaboration platform: secure room access, trustworthy attendance, real-time lab chat, protected file sharing, an optional Gemini-powered study assistant, reports and an audit trail.

**Stack:** React 19 + Vite + Tailwind 4 (frontend) · Express + Socket.IO (API/real-time) · SQLite (`better-sqlite3`, FTS5) · JWT in HttpOnly cookies + bcrypt · Multer · Gemini (`@google/genai`, server-side only).

## Quick start

```bash
npm install
cp .env.example .env        # already provided as .env with a generated JWT_SECRET for local use
# edit .env: ADMIN_EMAIL / ADMIN_PASSWORD (first admin), GEMINI_API_KEY (optional)
npm run dev                 # http://localhost:3000
npm run seed                # optional: demo staff/students/lab (development only)
```

Production: `npm run build && npm start` (needs a real `JWT_SECRET` ≥ 32 chars and a changed `ADMIN_PASSWORD`, otherwise the server refuses to start). Put it behind HTTPS and set `APP_BASE_URL`, `TRUST_PROXY=true`.

Tests: `npm test` (API, permissions, real-time sockets and UI smoke tests) · `npm run lint` (strict TypeScript) · `npm run test:e2e` (Playwright, needs `npx playwright install chromium`).

## Environment (.env)

See `.env.example` - every variable is documented. Key points:
- `JWT_SECRET` signs sessions **and** keys the room-code hashes.
- The first administrator is created from `ADMIN_EMAIL`/`ADMIN_PASSWORD` on first start. Public registration can never create staff/admin.
- `GEMINI_API_KEY` is optional. Without it AI endpoints answer `503 AI_NOT_CONFIGURED` (the UI says so); chat summaries fall back to a clearly labelled rule-based digest and session reports to a data-filled template.
- `SMTP_*` is optional. Without it, verification/reset links are printed to the server log and (outside production) shown in the UI.

## Roles
| | Student | Staff | Admin |
|---|---|---|---|
| Join labs with code, chat, upload, check in/out | ✔ | members of labs they staff | all |
| Create/edit/archive labs, codes, sessions | | own labs | all labs, assign staff |
| Verify/correct attendance, review alerts, reports | own history | own labs | all |
| Approve accounts, change roles, settings, audit logs, health | | | ✔ |

Every API route enforces role and lab membership on the server; the UI only hides what you cannot use.

## Security notes
- Passwords: bcrypt (cost 12), strength policy, account lockout, generic login errors, password reset invalidates all sessions.
- Room codes: 8 chars from `crypto.randomInt`, stored only as HMAC hashes, expiring, revocable, usage- and capacity-limited, failed attempts rate-limited and raised as alerts. A code is shown once at creation.
- Attendance times come from the server clock only (clients cannot send timestamps); duplicates and overlapping labs are blocked; missing check-outs are flagged, never invented; corrections need a reason and keep history.
- Files: extension allow-list, size/quota limits, content sniffing (`file-type`), executables rejected, random storage names outside the web root, every download authorised, `nosniff` + sandbox CSP, inline preview only for safe types.
- AI: key server-side, per-user opt-out, admin kill-switch, daily quota, retrieval only over files the caller may read, user content wrapped as untrusted data, answers cite sources, "not enough information" returned without calling the model when nothing relevant exists.
- Audit log is append-only (SQLite triggers reject UPDATE/DELETE); clients cannot write to it.
- Helmet CSP, same-origin + custom-header CSRF guard, SameSite=Lax cookies, request size limits, rate limits, CSV formula neutralisation.

## Known limitations (honest list)
- No real push notifications (FCM/web-push): notifications are in-app and real-time over Socket.IO.
- Uploaded files are type-verified, **not** virus-scanned. Add ClamAV or a cloud scanner before exposing to untrusted users.
- Document Q&A uses SQLite FTS5 (keyword/BM25) retrieval, not embeddings. Supported: txt, md, csv, json, code, PDF (text layer), DOCX.
- The session check-in QR is displayed once when a session starts.
- Terms/Privacy pages are templates for your institution to replace.
- Playwright specs in `e2e/` were written but not executed in the build environment (no browser download access).
"# labsync-ai" 
