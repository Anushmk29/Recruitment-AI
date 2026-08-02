# Deploying to Render

Goal: permanent HTTPS hostnames so an emailed interview link still works four days
later, on a phone, with your laptop shut. **No custom domain required** — Render issues
`*.onrender.com` with TLS for free. A custom domain can be attached later without
changing anything below.

You end up with three services plus a key-value store:

| Service | What | Plan |
|---|---|---|
| `recruitment-api` | Express + Socket.io | free (see [spin-down](#the-free-tier-caveat-that-actually-matters)) |
| `recruitment-user` | candidate SPA — **this is the interview-link host** | free static, always on |
| `recruitment-admin` | recruiter SPA | free static, always on |
| `recruitment-kv` | Redis (socket adapter, BullMQ, cron locks, rate limits) | free |

---

## Before you start: two external services

Render provides neither of these, and the app will not work correctly without them.

### 1. MongoDB — Atlas M0 (free)

Create a free M0 cluster, then a database user. Under **Network Access** add `0.0.0.0/0`
— Render's free tier has no static outbound IP, so an IP allowlist cannot work.

Your URI **must include the database name in the path**, which Atlas' copy-paste string omits:

```
mongodb+srv://USER:PASS@cluster.mongodb.net/recruitment?retryWrites=true&w=majority
                                             ^^^^^^^^^^^ this part
```

### 2. Object storage — required, not optional

Render's filesystem is **ephemeral**: wiped on every deploy and on every restart (and free
services restart often, see below). `storageService` falls back to `backend/uploads` when
S3 is unconfigured, so without object storage every uploaded résumé is destroyed —
and then ATS extracts empty text and scores the candidate on nothing, without an error.

**The API refuses to boot in production without all three of `S3_BUCKET`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`** — a partial config falls back to local
disk exactly as an empty one does, so it is rejected the same way. If you are deploying
somewhere with genuinely persistent disk (a VPS with a mounted volume), set
`ALLOW_LOCAL_STORAGE=true` to downgrade it to a warning. Never set that on Render.

Any S3-compatible store works, since the code already supports `S3_ENDPOINT` +
`S3_FORCE_PATH_STYLE`. **Cloudflare R2** is the cheapest fit (10 GB free, no egress fees):

```
S3_BUCKET=recruitment-uploads
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<R2 API token key id>
S3_SECRET_ACCESS_KEY=<R2 API token secret>
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
```

Backblaze B2 or plain AWS S3 work identically — only `S3_ENDPOINT`/`S3_REGION` change.

---

## Deploy

### Step 1 — push the repo to GitHub

Render deploys from a Git remote. `backend/.env` is git-ignored and must stay that way;
all secrets are set in the Render dashboard.

### Step 2 — create the Blueprint

Render Dashboard → **New → Blueprint** → pick this repo. It reads [render.yaml](render.yaml)
and creates all four services. The first API deploy **will fail** — that is expected, the
pass-2 env vars are still blank.

### Step 3 — note your three URLs

```
https://recruitment-api.onrender.com
https://recruitment-user.onrender.com     <- candidate app
https://recruitment-admin.onrender.com    <- recruiter app
```

If Render appended a suffix to make a name unique, use the actual URLs it shows.

### Step 4 — set the SPA build vars, then redeploy both static sites

On **recruitment-user** and **recruitment-admin** → Environment:

```
VITE_API_URL=https://recruitment-api.onrender.com/api
```

Absolute, and ending in `/api`. The `/api` value in `user/.env` works only in dev,
where the Vite dev server proxies to `localhost:9000`; a static production build has
no proxy. This is a **build-time** variable — you must redeploy after setting it.

### Step 5 — set the API env vars

On **recruitment-api** → Environment:

```
MONGODB_URI=mongodb+srv://.../recruitment?retryWrites=true&w=majority

CLIENT_ORIGIN_ADMIN=https://recruitment-admin.onrender.com
CLIENT_ORIGIN_USER=https://recruitment-user.onrender.com
PUBLIC_CANDIDATE_URL=https://recruitment-user.onrender.com
PUBLIC_BASE_URL=https://recruitment-api.onrender.com

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<brevo login>
SMTP_PASS=<brevo smtp key>
MAIL_FROM="Recruitment Team <no-reply@yourdomain.com>"

OPENROUTER_API_KEY=<key>
```

Plus the `S3_*` block from above, and the `RAZORPAY_*` keys if you want checkout live.

`CLIENT_ORIGIN_*` drives CORS **and** the Socket.io handshake — if either origin is
missing or misspelled, the SPA loads but every API call and the live notification socket
are rejected by the browser. Scheme included, no path. A trailing slash is now stripped
for you, but the scheme is not optional: `recruitment-admin.onrender.com` will not match
the `https://recruitment-admin.onrender.com` a browser actually sends.

`PUBLIC_CANDIDATE_URL` is the one that fixes the dead-link problem: it overrides
`CLIENT_ORIGIN_USER` when building emailed links, so link generation can never again
depend on which origin happens to be listed first. **The API now refuses to boot** if it
resolves to a dev tunnel or localhost — that guard is deliberate, don't work around it.

### Step 6 — seed the subscription plans

Render's free tier has no shell, so run the seed from your machine against Atlas:

```bash
cd backend
MONGODB_URI="mongodb+srv://.../recruitment" npm run seed:plans
```

### Step 7 — verify

```bash
curl https://recruitment-api.onrender.com/api/health     # {"ok":true}
```

Then, in order: open the admin SPA and log in → post a job → apply through the candidate
SPA with a real PDF → confirm the invitation email arrives and **the link points at
`recruitment-user.onrender.com`** → open it on your phone with your laptop closed.

That last check is the whole point of this exercise.

### Step 8 — repoint the Razorpay webhook

Razorpay dashboard → Webhooks → `https://recruitment-api.onrender.com/api/payments/webhook`.
The route is mounted before `express.json()` with a raw-body parser for signature
verification — don't change that ordering.

---

## The free-tier caveat that actually matters

A free Render web service **spins down after ~15 minutes of inactivity**. The static
sites are unaffected (CDN, always on) — but the API sleeping has three consequences:

1. **Interview reminders silently stop.** `startInterviewReminderJob` is node-cron every
   15 min. A sleeping process runs no cron, so the 24h and 1h reminder emails just never
   go out — no error, no log, nothing to notice.
2. **Cold start ~50 s.** A candidate opening a magic link stares at a blank page for
   nearly a minute before the interview loads.
3. **Sockets drop** on sleep, so live notifications stop until the next request.

Free is fine for testing the deploy. Before you invite real candidates, set
`recruitment-api` to **Starter ($7/mo)** for always-on. Everything else stays free.

Also note the free key-value store has no persistence — a restart drops anything queued
in BullMQ at that moment. Check Render's current free-tier limits, as they change.

### The key-value eviction policy is not a tuning knob

[render.yaml](render.yaml) pins `maxmemoryPolicy: noeviction` on `recruitment-kv`. Render
defaults new instances to `allkeys-lru`, under which Redis evicts BullMQ's own bookkeeping
keys as memory tightens. Jobs then disappear **without** emitting a `failed` event, so the
worker's final-attempt alert never fires and the `EmailLog` row sits at `queued` forever
while the UI reports success — registration OTPs, verification links and interview
invitations silently not sent. If you create the store by hand instead of from the
Blueprint, set this yourself.

### Deploys interrupt work that has already been acknowledged

Apply returns `201` and screens afterwards; rescore returns `202`; an interview finalises
after the candidate's last answer. On SIGTERM those detached tasks get `SHUTDOWN_DRAIN_MS`
(15 s) to finish before Mongo is disconnected. A live-mode screen is several LLM calls and
can outlast that, in which case the shutdown log carries the line:

```
background tasks abandoned at shutdown — re-run these   {"abandoned":["screen candidate 65f…"]}
```

Those candidates have no score and no outcome email. The recovery is **Rescore** on each
one. Grep for `abandoned at shutdown` after any deploy that lands during working hours —
free-tier spin-downs produce the same line.

---

## Why this ends the broken-link problem

Only the **hash** of an interview token is persisted, never the token itself. A link built
on a hostname that later disappears therefore cannot be regenerated — the recruiter's only
recovery is to rotate the token and re-email every affected candidate.

The invitation email promises *"take it whenever suits you"* across a 48-hour window
(`INTERVIEW_LINK_VALIDITY_HOURS`). Meeting that promise requires a host that outlives the
window. A `*.onrender.com` static site does. A `trycloudflare.com` quick tunnel — which
mints a fresh random hostname on every run — never could.

Recovering links already sent from a tunnel: the token in the old email is still valid, and
it isn't bound to any host. Replace just the hostname:

```
https://recruitment-user.onrender.com/interview/<the 64-char token from the old email>
```
