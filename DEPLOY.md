# Deploying — Vercel (frontends) + Render (API, Redis, storage)

Goal: permanent HTTPS hostnames so an emailed interview link still works four days
later, on a phone, with your laptop shut. **No custom domain required** — Vercel issues
`*.vercel.app` and Render issues `*.onrender.com`, both with TLS, both free. Custom
domains can be attached later without changing anything below.

| Where | Service | What | Cost |
|---|---|---|---|
| **Vercel** | `recruitment-user` | candidate SPA — **this is the interview-link host** | free |
| **Vercel** | `recruitment-admin` | recruiter SPA | free |
| **Render** | `recruitment-api` | Express + Socket.io | free → **$7/mo, see [spin-down](#the-15-minute-spin-down-and-what-it-actually-breaks)** |
| **Render** | `recruitment-kv` | Redis: socket adapter, BullMQ, cron locks, rate limits | free |
| **Cloudflare / Render** | object storage | résumés, identity photos, evidence clips | free (R2) or ~$7+/mo (MinIO) |
| **Atlas** | MongoDB | the database | free (M0) |

The frontends are static bundles, so Vercel serves them from its CDN and they never
sleep. Only the API sleeps — which matters, and is dealt with at the bottom.

---

## Before you start: two external services

### 1. MongoDB — Atlas M0 (free)

Create a free M0 cluster, then a database user. Under **Network Access** add `0.0.0.0/0`
— Render's free tier has no static outbound IP, so an IP allowlist cannot work.

Your URI **must include the database name in the path**, which Atlas' copy-paste string omits:

```
mongodb+srv://USER:PASS@cluster.mongodb.net/recruitment?retryWrites=true&w=majority
                                             ^^^^^^^^^^^ this part
```

Without it you silently get a database called `test`.

### 2. Object storage — required, not optional

Render's filesystem is **ephemeral**: wiped on every deploy and on every restart (and free
services restart often). `storageService` falls back to `backend/uploads` when S3 is
unconfigured, so without object storage every uploaded résumé is destroyed — and then
screening extracts empty text and scores the candidate on nothing, without an error.

**The API refuses to boot in production without all three of `S3_BUCKET`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`** — a partial config falls back to local
disk exactly as an empty one does, so it is rejected the same way.

Pick **one** of the two options below.

#### Option A — Cloudflare R2 (recommended: free, zero moving parts)

10 GB free, no egress fees, S3-compatible. Create a bucket and an API token, then:

```
S3_BUCKET=recruitment-uploads
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<R2 API token key id>
S3_SECRET_ACCESS_KEY=<R2 API token secret>
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
```

Backblaze B2 or plain AWS S3 work identically — only `S3_ENDPOINT` / `S3_REGION` change.

#### Option B — MinIO on Render (what `docker-compose.yml` runs locally)

MinIO is the right choice locally and a costly one in production. Read the trade-off
before committing to it:

- **MinIO needs a persistent disk, and Render disks require a paid instance.** A free
  Render service cannot mount one. MinIO on an ephemeral filesystem is *worse than no
  storage at all*: it accepts writes, reports success, and loses every object on the next
  deploy — the exact failure the `S3_*` boot check exists to prevent.
- Realistic cost: **Starter ($7/mo) for the MinIO service + ~$0.25/GB/mo for the disk**,
  on top of whatever the API costs. R2 does the same job for $0.
- You must create the bucket yourself. MinIO does not auto-create one, and the official
  image has no `MINIO_DEFAULT_BUCKETS` equivalent — that is a Bitnami-image feature.

If you still want it — for data-residency reasons, or because you are moving to a VPS
later — here is the part that makes it workable:

**Run it as a private service, not a web service.** `storageService.sendDownload()`
([backend/services/storageService.js](backend/services/storageService.js)) reads the object
into the API process and streams it through Express. There are **no presigned URLs
anywhere in this codebase**, so a candidate's browser never talks to the bucket directly.
MinIO therefore never needs a public hostname, and should not have one.

In [render.yaml](render.yaml) there is a commented `recruitment-minio` block. Uncomment it,
set a real disk size, then point the API at it over Render's private network:

```
S3_BUCKET=recruitment-uploads
S3_ENDPOINT=http://recruitment-minio:9000
S3_ACCESS_KEY_ID=<MINIO_ROOT_USER you set>
S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD you set>
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

`http://`, not `https://` — private-network traffic between Render services is not TLS
terminated. `S3_FORCE_PATH_STYLE=true` is mandatory for MinIO; without it the SDK builds
virtual-host-style URLs (`bucket.recruitment-minio:9000`) that do not resolve.

To create the bucket once, run `mc` from your machine against a temporarily-public MinIO,
then set it back to private:

```bash
mc alias set prod https://<temporary-minio-url> <root-user> <root-password>
mc mb prod/recruitment-uploads
```

**Do not set `ALLOW_LOCAL_STORAGE=true` on Render under any circumstances.** That flag
exists for a VPS with a genuinely mounted volume. On Render it converts a fatal
misconfiguration into a warning and then quietly destroys résumés.

---

## Part 1 — the API on Render

### Step 1 — push the repo to GitHub

Render deploys from a Git remote. `backend/.env` is git-ignored and must stay that way;
all secrets are set in the Render dashboard.

### Step 2 — create the Blueprint

Render Dashboard → **New → Blueprint** → pick this repo. It reads [render.yaml](render.yaml)
and creates `recruitment-api` plus `recruitment-kv`. The first API deploy **will fail** —
that is expected, the pass-2 env vars are still blank.

The Blueprint no longer creates static sites; Vercel owns the frontends now.

### Step 3 — Redis is already wired

`recruitment-kv` is a Render **Key Value** instance (Redis-compatible, free tier). The
Blueprint injects its connection string into the API as `REDIS_URL` via `fromService`, so
there is nothing to copy by hand. It is created with `ipAllowList: []` — private network
only, no public exposure.

The API **refuses to boot in production without `REDIS_URL`**. It backs four things: the
Socket.io adapter, the BullMQ email queue, distributed cron locks, and shared rate
limiting.

### Step 4 — note your API URL

```
https://recruitment-api.onrender.com
```

If Render appended a suffix to make the name unique, use the URL it actually shows.

### Step 5 — set the API env vars

On **recruitment-api** → Environment. Leave the origin vars until Part 3 — you do not have
the Vercel URLs yet.

```
MONGODB_URI=mongodb+srv://.../recruitment?retryWrites=true&w=majority
PUBLIC_BASE_URL=https://recruitment-api.onrender.com

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<brevo login>
SMTP_PASS=<brevo smtp key>
MAIL_FROM="Recruitment Team <no-reply@yourdomain.com>"

OPENROUTER_API_KEY=<key>
```

Plus the `S3_*` block you chose above, and the `RAZORPAY_*` keys if you want checkout live.

`AUTH_JWT_SECRET`, `JWT_SECRET`, `ADMIN_SIGNUP_KEY` and `METRICS_TOKEN` are generated by
the Blueprint — don't set them by hand. The two JWT secrets are **not** interchangeable:
`AUTH_JWT_SECRET` signs User/socket tokens, `JWT_SECRET` signs interview-portal tokens.

---

## Part 2 — the SPAs on Vercel

Two Vercel projects, both from the same GitHub repo, differing only in **Root Directory**.

### Step 6 — create the candidate project

Vercel → **Add New → Project** → import the repo:

| Setting | Value |
|---|---|
| Project Name | `recruitment-user` |
| Root Directory | `user` |
| Framework Preset | Vite (auto-detected) |
| Build / Output | leave alone — [user/vercel.json](user/vercel.json) pins them |

[user/vercel.json](user/vercel.json) is committed and carries the piece that matters:

```json
"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
```

React Router owns `/interview/:token`, `/assessment/:token` and `/phone-cam/:token`.
Without that rewrite, a candidate opening a magic link gets a **404 from the CDN** and the
app never boots. Vercel matches real files first, so hashed bundles under `/assets/*` still
resolve normally.

### Step 7 — create the recruiter project

Same repo, same steps, Root Directory `admin`, name `recruitment-admin`. It uses
[admin/vercel.json](admin/vercel.json), which is identical.

### Step 8 — set `VITE_API_URL` on both projects

Vercel → project → **Settings → Environment Variables**:

```
VITE_API_URL=https://recruitment-api.onrender.com/api
```

Absolute, and ending in `/api`. The bare `/api` value in `user/.env` works only in dev,
where the Vite dev server proxies to `localhost:9000`; a static production build has no
proxy.

This is a **build-time** variable — Vite inlines it into the bundle. Setting it does
nothing until you **redeploy**. Vercel will not do that for you on an env-var change:
Deployments → ⋯ → Redeploy, and untick "use existing build cache".

Apply it to Production, Preview and Development so preview builds aren't pointed at
nothing.

### Step 9 — note your two Vercel URLs

```
https://recruitment-user.vercel.app     <- candidate app
https://recruitment-admin.vercel.app    <- recruiter app
```

---

## Part 3 — wire the origins together

This is the step that breaks deployments. Back on **recruitment-api** → Environment:

```
CLIENT_ORIGIN_ADMIN=https://recruitment-admin.vercel.app
CLIENT_ORIGIN_USER=https://recruitment-user.vercel.app
PUBLIC_CANDIDATE_URL=https://recruitment-user.vercel.app
```

`CLIENT_ORIGIN_*` drives CORS **and** the Socket.io handshake. If either origin is missing
or misspelled, the SPA loads fine and then every API call and the live-notification socket
is rejected by the browser — which looks like "the app is broken" rather than "CORS".
Scheme included, no path. A trailing slash is stripped for you; the scheme is not optional
(`recruitment-admin.vercel.app` will not match the `https://recruitment-admin.vercel.app`
a browser actually sends).

Both vars accept a **comma-separated list**
([backend/utils/corsOrigins.js](backend/utils/corsOrigins.js)), which is how you add a
custom domain later:

```
CLIENT_ORIGIN_USER=https://careers.yourdomain.com,https://recruitment-user.vercel.app
```

Order matters — link-builders take the **first** origin. Put the canonical one first.

`PUBLIC_CANDIDATE_URL` is the one that fixes the dead-link problem: it overrides
`CLIENT_ORIGIN_USER` when building emailed links, so link generation can never depend on
which origin happens to be listed first. **The API refuses to boot** if it resolves to a
dev tunnel or localhost — that guard is deliberate, don't work around it.

---

## Part 4 — seed and verify

### Step 10 — seed the subscription plans

Render's free tier has no shell, so run the seed from your machine against Atlas:

```bash
cd backend
MONGODB_URI="mongodb+srv://.../recruitment" npm run seed:plans
```

### Step 11 — verify, in this order

```bash
curl https://recruitment-api.onrender.com/api/health     # {"ok":true}
curl https://recruitment-api.onrender.com/api/ready      # checks Mongo + Redis
```

Then: open the admin SPA and log in → post a job → apply through the candidate SPA with a
real PDF → confirm the invitation email arrives and **the link points at
`recruitment-user.vercel.app`** → open it on your phone with your laptop closed.

That last check is the whole point of this exercise.

### Step 12 — repoint the Razorpay webhook

Razorpay dashboard → Webhooks → `https://recruitment-api.onrender.com/api/payments/webhook`.
The route is mounted before `express.json()` with a raw-body parser for signature
verification — don't change that ordering.

---

## Operating notes

### The 15-minute spin-down, and what it actually breaks

A free Render web service **spins down after ~15 minutes of inactivity**. There is no
setting to disable it. The Vercel frontends are unaffected — they are CDN static — but the
API sleeping has four consequences, and the fourth is the serious one:

1. **Interview reminders silently stop.** `startInterviewReminderJob` is node-cron every
   15 min. A sleeping process runs no cron, so the 24h and 1h reminder emails never go
   out — no error, no log, nothing to notice.
2. **Cold start ~50 s.** A candidate opening a magic link stares at a blank page for
   nearly a minute.
3. **Sockets drop** on sleep, so live notifications stop until the next request.
4. **In-flight screening is destroyed.** Every spin-down is a SIGTERM, and detached work
   gets `SHUTDOWN_DRAIN_MS` (15 s) to finish. A live-mode screen is several LLM calls and
   routinely outlasts that. Those candidates end up with **no score and no outcome email**,
   and the only trace is a log line (see below).

**The only complete fix is a paid instance.** Change `plan: free` → `plan: starter` on
`recruitment-api` in [render.yaml](render.yaml) — $7/mo, always on. Everything else stays
free. Do this before you invite a single real candidate.

**Stop-gap while testing:** an external pinger — [cron-job.org](https://cron-job.org) or
UptimeRobot — hitting `/api/health` every **14 minutes** (the window is ~15; 14 keeps it
awake at a quarter of the traffic of a 5-minute ping). Hit `/api/health`, never
`/api/ready`: health is a bare `res.json({ok:true})`, whereas ready probes Mongo and Redis
on every call.

Two things to know about that stop-gap. Free web services draw on a monthly instance-hour
budget (750 h/month account-wide, last confirmed — **verify, Render changes this**), and
24/7 wakefulness burns ~730 of them, leaving essentially no headroom. And it works around
Render's intent rather than with it. It is fine for a week of testing and wrong as a
permanent posture.

**What does not work:** a `setInterval` inside the app pinging its own URL. When the
process is asleep the timer is asleep too. Splitting cron into a Render Background Worker
(`RUN_WORKERS_IN_API=false` + `npm run worker`, both already supported by this codebase)
is architecturally correct but Background Workers have no free tier.

### Vercel preview deployments will be CORS-blocked

Every Vercel preview gets a unique hostname
(`recruitment-user-git-mybranch-yourteam.vercel.app`). `CLIENT_ORIGIN_*` is an exact-match
allow-list, so previews are rejected by CORS and the socket handshake even though the page
loads.

Test against the production URL, or temporarily append the preview origin to the
comma-separated list. Do **not** solve this by allowing `*` — these origins gate an
authenticated recruiter session and a candidate interview token.

### The key-value eviction policy is not a tuning knob

[render.yaml](render.yaml) pins `maxmemoryPolicy: noeviction` on `recruitment-kv`. Render
defaults new instances to `allkeys-lru`, under which Redis evicts BullMQ's own bookkeeping
keys as memory tightens. Jobs then disappear **without** emitting a `failed` event, so the
worker's final-attempt alert never fires and the `EmailLog` row sits at `queued` forever
while the UI reports success — registration OTPs, verification links and interview
invitations silently not sent. If you create the store by hand instead of from the
Blueprint, set this yourself.

The free key-value tier also has no persistence: a restart drops anything queued at that
moment.

### Deploys interrupt work that has already been acknowledged

Apply returns `201` and screens afterwards; rescore returns `202`; an interview finalises
after the candidate's last answer. On SIGTERM those detached tasks get `SHUTDOWN_DRAIN_MS`
(15 s) before Mongo is disconnected. When a task outlasts it, the shutdown log carries:

```
background tasks abandoned at shutdown — re-run these   {"abandoned":["screen candidate 65f…"]}
```

Those candidates have no score and no outcome email. The recovery is **Rescore** on each
one. Grep for `abandoned at shutdown` after any deploy that lands during working hours —
free-tier spin-downs produce the identical line, which is why free tier is not a place to
run real hiring.

### Why permanent hostnames matter

Only the **hash** of an interview token is persisted, never the token itself. A link built
on a hostname that later disappears therefore cannot be regenerated — the recruiter's only
recovery is to rotate the token and re-email every affected candidate.

The invitation email promises *"take it whenever suits you"* across a 48-hour window
(`INTERVIEW_LINK_VALIDITY_HOURS`). Meeting that promise requires a host that outlives the
window. A `*.vercel.app` deployment does. A `trycloudflare.com` quick tunnel — which mints
a fresh random hostname on every run — never could, which is why `config/env.js` refuses
to boot against one.

Recovering links already sent from a tunnel: the token in the old email is still valid and
is not bound to any host. Replace just the hostname:

```
https://recruitment-user.vercel.app/interview/<the 64-char token from the old email>
```
