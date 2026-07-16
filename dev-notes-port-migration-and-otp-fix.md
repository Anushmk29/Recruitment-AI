# Dev Notes: Backend Port Migration (5000 → 9000) & OTP Email Verification Issue

**Date:** 2026-07-15
**Project:** recruitment (backend + admin + user)
**Prepared for:** Developer handoff

---

## 1. Summary

Two changes were investigated/made in this session:

1. **Completed** — Migrated the backend's default port from `5000` to `9000` across backend config and both frontend apps (admin, user).
2. **Open / unresolved** — Identified stale processes blocking Vite's default dev-server ports (5173/5174), pending developer decision on whether to kill them.
3. **Diagnosed, not yet applied** — Root-caused why OTP email verification appears "stuck": no SMTP provider is configured, so verification emails are never actually sent (a dev-mode fallback silently logs them to the console instead).

---

## 2. Port Migration: 5000 → 9000

### Files changed

| File | Change |
|---|---|
| [`backend/server.js`](backend/server.js#L76) | `const PORT = process.env.PORT \|\| 9000;` (was `5000`) |
| [`backend/.env.example`](backend/.env.example#L1) | `PORT=9000` (was `PORT=5000`) |
| [`user/src/lib/socket.js`](user/src/lib/socket.js#L3) | Default `SOCKET_URL` fallback → `http://localhost:9000/api` |
| [`admin/src/lib/socket.js`](admin/src/lib/socket.js#L3) | Default `SOCKET_URL` fallback → `http://localhost:9000/api` |
| [`user/src/api/client.js`](user/src/api/client.js#L4) | Default axios `baseURL` fallback → `http://localhost:9000/api` |
| [`admin/src/api/client.js`](admin/src/api/client.js#L5) | Default axios `baseURL` fallback → `http://localhost:9000/api` |

### Not changed (already correct or unrelated)

- **`backend/.env`** — was already set to `PORT=9000` before this session started; left as-is.
- **`backend/services/emailDispatchService.js`** — contains `delay: 5000` (a BullMQ retry backoff of 5000 **milliseconds**), unrelated to the HTTP port. Left untouched.
- **`backend/scripts/seedSubscriptionPlans.js`** — contains `storageLimitMb: 5000` / `25000` / `250000` (subscription plan storage quotas), unrelated to the HTTP port. Left untouched.
- **`node_modules/**`** and **`admin/dist/**` / `user/dist/**`** (build artifacts) — third-party/generated files, intentionally not touched.

### Why this matters — every caller of the API needs to agree on 9000

- The `SOCKET_URL` / `baseURL` values above are only **fallback defaults** used when `VITE_API_URL` is not set in the frontend's own `.env`. **Check `admin/.env` and `user/.env` (if they exist) for a `VITE_API_URL` override** — if one is present and still points at port `5000`, it will silently take precedence over the code defaults changed above and the frontend will fail to reach the backend.
- Any external tooling (Postman collections, CORS allow-lists, reverse proxy configs, README instructions, deployment scripts/Docker Compose files) that hardcode `localhost:5000` should also be updated to `9000`.

### Action items

- [ ] Grep `admin/.env` and `user/.env` for `VITE_API_URL` and confirm they either point to `9000` or are unset.
- [ ] Update any deployment/infra config (Docker Compose, nginx, CI env vars) that references port `5000`.
- [ ] Restart the backend and both frontends after pulling this change, and do a smoke test (login + one API call + a socket-dependent feature, e.g. live notifications).

---

## 3. Dev Server Port Conflict on 5173/5174 (Unresolved — needs developer action)

While starting `admin` (`npm run dev`, expected on port `5173`), Vite reported both `5173` and `5174` already in use and fell back to `5175`:

```
Port 5173 is in use, trying another one...
Port 5174 is in use, trying another one...
VITE v5.4.21  ready in 1567 ms
➜  Local:   http://localhost:5175/
```

### Root cause found

Two **stale `node.exe` processes** were already bound to those ports (likely leftover dev-server instances from a previous session that weren't shut down cleanly):

| Port | PID | Process |
|---|---|---|
| 5173 | 22460 | node.exe |
| 5174 | 11772 | node.exe |

This matters because `backend/.env` (see above) whitelists CORS origins explicitly:
```
CLIENT_ORIGIN_ADMIN=http://localhost:5173
CLIENT_ORIGIN_USER=http://localhost:5174
```
If `admin` ends up running on `5175` instead of `5173` (or `user` on some other fallback port), **requests from the frontend to the backend will be rejected by CORS**, since the origin won't match what the backend allows.

### Recommended fix (not yet applied — needs your go-ahead)

Kill the stale processes so Vite can bind to its intended ports:

```powershell
taskkill /PID 22460 /F
taskkill /PID 11772 /F
```

Then re-check what's listening before restarting the dev servers:

```powershell
netstat -ano | findstr ":5173 :5174"
```

If nothing is listening, restart `admin` and `user` dev servers — they should now come up on `5173` and `5174` respectively, matching the CORS allow-list in `backend/.env`.

> Note: PIDs 22460/11772 were correct at the time of investigation but **may have changed** by the time this is read — re-run `netstat -ano | findstr ":5173 :5174"` to get current PIDs before killing anything.

---

## 4. OTP Email Verification Not Working — Root Cause & Fix

### Symptom
User completes company registration, gets prompted for a 6-digit email OTP, but never receives the email and cannot verify.

### Root cause

`backend/.env` has **no `SMTP_HOST` configured**. [`backend/utils/mailer.js`](backend/utils/mailer.js#L13-L34) intentionally falls back to nodemailer's `jsonTransport` whenever `SMTP_HOST` is unset:

```js
if (process.env.SMTP_HOST) {
  // real SMTP transport
} else {
  // No SMTP configured (dev/local): use a JSON transport so mail composition
  // is exercised end-to-end without needing real credentials or sending anything.
  transporterPromise = Promise.resolve(nodemailer.createTransport({ jsonTransport: true }));
}
```

`jsonTransport` **composes the email but never actually delivers it anywhere.** Instead, the full email body (including the OTP) is only written to the **backend server's console/terminal log**:

```
[mailer] (no SMTP configured, not actually sent) to=user@example.com subject="Your verification code"
Hi,

Your verification code for <Company Name> is: 123456

This code expires in 10 minutes. If you didn't request this, you can ignore this email.
...
```

This is a deliberate dev-mode convenience (similar to Laravel's "log" mail driver / Rails' `letter_opener`), **not a bug** — but it means no real inbox ever receives anything until SMTP credentials are supplied.

### OTP business rules (for context, from [`backend/utils/otp.js`](backend/utils/otp.js))

| Rule | Value |
|---|---|
| Code length | 6 digits |
| Expiry | 10 minutes |
| Max verify attempts before lockout | 5 |
| Resend cooldown | 45 seconds |
| Max sends per rolling window | 5 per 60 minutes |

If a tester burns through 5 wrong attempts or lets the code sit for >10 minutes, they must request a fresh code (subject to the 45s cooldown / 5-per-hour cap above) — `verifyCompanyOtp` in [`companyRegistrationService.js`](backend/services/companyRegistrationService.js#L116-L157) will otherwise reject with "Too many incorrect attempts" or "This code has expired."

### Two ways to fix

**A. Immediate dev workaround (no config change)**
Read the OTP straight from the backend process's console output (see log format above) and type it into the verification screen. Works for local testing only.

**B. Proper fix — configure a real SMTP provider**
Add the following to `backend/.env`:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
MAIL_FROM=no-reply@yourdomain.com
```

Suggested providers for quick setup:
- **Gmail SMTP** (good for personal/dev testing, requires an App Password)
- **Mailtrap** (sandbox inbox, ideal for staging/dev — nothing reaches real users)
- **Resend / Brevo / SendGrid** (production-grade transactional email)

After adding these vars, **restart the backend process** (env vars are only read at startup) and request a new OTP — it should now be delivered to the real inbox instead of just the console.

### Action items

- [ ] Decide on an SMTP provider for local/dev (recommend Mailtrap to avoid spamming real inboxes during testing).
- [ ] Decide on an SMTP provider for production (e.g. SendGrid/Resend/Brevo/SES).
- [ ] Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` to the appropriate `.env` file(s) per environment.
- [ ] Confirm `backend/.env.example` documents these SMTP vars (currently it does not list them) so future setup doesn't hit the same confusion.
- [ ] Restart backend and re-test the full registration → OTP → verify flow end-to-end.

---

## 5. Quick Reference — All Files Touched This Session

```
backend/server.js                  (port 5000 -> 9000)
backend/.env.example               (port 5000 -> 9000)
user/src/lib/socket.js             (port 5000 -> 9000)
admin/src/lib/socket.js            (port 5000 -> 9000)
user/src/api/client.js             (port 5000 -> 9000)
admin/src/api/client.js            (port 5000 -> 9000)
```

No files were changed for the Vite port conflict or the OTP/SMTP issue — those sections above are diagnosis + recommended next steps only.
