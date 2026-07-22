# Observability & Performance (Wave 6)

How the platform is measured, logged, and load-tested, plus the SLO it's held to. Companion
to [STATUS.md](STATUS.md) · [MULTI-TENANT-PLAN.md](MULTI-TENANT-PLAN.md) (§0 SLO, F11 indexes).

---

## SLO (pilot target)

The service level the pilot is held to. The load-test gate and alert rules below enforce it.

| Objective | Target |
|---|---|
| Availability (API) | ≥ 99.5% monthly |
| Latency p95 (read endpoints) | < 500 ms |
| Latency p99 | < 1000 ms |
| Error rate (5xx / total) | < 1% |
| RPO (data loss on disaster) | ≤ 1h |
| RTO (time to restore) | ≤ 4h |

Error budget: 0.5%/month ≈ **3h39m** of downtime. RPO/RTO are met by the backup + restore
drill in [STATUS.md](STATUS.md) §D, not by app code.

---

## Structured logs

Every process emits one JSON object per line to stdout/stderr (`utils/logger.js`). Ship these
to Loki/CloudWatch/ELK; do not parse a custom format.

- **Level** via `LOG_LEVEL` (`debug|info|warn|error`, default `info`). `LOG_PRETTY=true` gives
  human-readable dev output.
- **Correlation**: `middleware/observability.js` assigns each request an `x-request-id`
  (honoring an inbound one from the proxy) and exposes a request-scoped logger as `req.log`.
  The response carries the same `x-request-id` header, so a user-reported error id ties
  straight to its log lines.
- **Access log**: one `msg:"request"` line per finished request with `method`, `path`, matched
  `route`, `status`, `durationMs`, and (when authenticated) `company` + `role`.
- **Redaction**: password/token/secret/OTP-style fields are replaced with `[redacted]` at any
  nesting depth before a line is written.

Example:
```json
{"level":"info","time":"2026-07-20T19:18:10.554Z","reqId":"6b1…","msg":"request","method":"GET","path":"/api/candidates/64f…","route":"/api/candidates/:id","status":200,"durationMs":12,"company":"64a…","role":"admin"}
```

## Metrics

`GET /metrics` exposes Prometheus text format (`utils/metrics.js`). It's **open when
`METRICS_TOKEN` is unset**, and requires `Authorization: Bearer <token>` when set — set it on
any internet-reachable VPS.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `http_requests_total` | counter | method, route, status | Requests handled |
| `http_request_duration_ms` | histogram | method, route, status | Request latency (buckets 5ms…10s) |
| `process_resident_memory_bytes` | gauge | — | RSS |
| `nodejs_heap_used_bytes` | gauge | — | V8 heap used |
| `process_uptime_seconds` | gauge | — | Process uptime |

`route` is the **matched Express pattern** (`/api/candidates/:id`), never the raw URL, so ids
don't explode metric cardinality. Health/readiness/metrics paths are excluded.

Counters live in-process. With N API instances, Prometheus scrapes each replica as its own
target and sums — the standard model. (For nationwide scale, swap this for `prom-client` + a
real TSDB; the endpoint contract stays the same.)

### Scrape config
```yaml
scrape_configs:
  - job_name: hiring-api
    metrics_path: /metrics
    authorization: { credentials: "<METRICS_TOKEN>" }   # omit if unset
    static_configs:
      - targets: ["api-1:9000", "api-2:9000"]
```

### Alert rules (starting set)
```yaml
groups:
  - name: hiring-api
    rules:
      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.01
        for: 5m
        labels: { severity: page }
        annotations: { summary: "5xx error rate > 1% for 5m" }

      - alert: HighLatencyP95
        expr: histogram_quantile(0.95, sum(rate(http_request_duration_ms_bucket[5m])) by (le)) > 500
        for: 10m
        labels: { severity: warn }
        annotations: { summary: "API p95 latency > 500ms for 10m" }

      - alert: InstanceDown
        expr: up{job="hiring-api"} == 0
        for: 2m
        labels: { severity: page }
        annotations: { summary: "An API instance is not being scraped" }
```
Wire these to Alertmanager → email/Slack/PagerDuty. A blackbox probe on `GET /api/ready` (which
checks Mongo + Redis) is the recommended external uptime signal.

---

## Database performance (F11)

Compound indexes matching the hot read paths were added and the redundant single-field
`{company}` indexes dropped (a compound with `company` as its prefix already serves them):

| Model | Index | Serves |
|---|---|---|
| Candidate | `{company, job, createdAt:-1}` | recruiter board: a job's applicants newest-first |
| Candidate | `{company, updatedAt}` | retention purge scan |
| Candidate | `{basicDetails.email}` | candidate dashboard / notification ownership (cross-tenant) |
| Job | `{company, createdAt:-1}` · `{status, createdAt:-1}` | recruiter list · public job board |
| InterviewQueue | `{company, status, atsScore:-1, createdAt}` | queue view: top ATS first |
| AdminNotification | `{company, createdAt:-1}` · `{company, read}` | list · unread count |
| Notification | `{user, createdAt:-1}` · `{candidate, createdAt:-1}` | candidate notifications |
| Payment | `{company, createdAt:-1}` | billing history |
| Subscription | `{status, currentPeriodEnd}` | expiry-reminder cron |
| InterviewSession | `{status, interviewAt}` | reminder cron scan |
| OTPVerification | `{email, purpose, createdAt:-1}` | latest OTP per email+purpose |

**Connection pool** (`config/db.js`): `maxPoolSize` 50 / `minPoolSize` 5 by default, fail-fast
`serverSelectionTimeoutMS` 8s — all env-tunable. Keep `N_instances × maxPoolSize` under mongod's
connection cap.

**Index builds on deploy**: `autoIndex` is **on in dev, off in production**. In production the
app does not build indexes at boot (which can block a large collection); run the reconcile
script instead — it creates missing indexes and drops removed ones:
```bash
npm run sync:indexes
```

---

## Load test (SLO gate)

`scripts/loadTest.js` — a zero-dependency generator that reports throughput + latency
percentiles and **exits non-zero if the SLO is exceeded** (so CI can gate a release).

```bash
# public read path
npm run loadtest -- --url http://localhost:9000/api/jobs/public --concurrency 100 --duration 30

# authed endpoint
node scripts/loadTest.js --url http://localhost:9000/api/jobs --header "Authorization: Bearer <token>"
```
SLO budgets come from `SLO_P95_MS` / `SLO_P99_MS` / `SLO_ERROR_RATE_PCT` (see `.env.example`).

> This is a smoke-scale generator for a pilot. For the real pre-launch 100-concurrent SLO test
> (STATUS.md §D), drive it with **k6 or vegeta from a separate host** so the load client isn't
> the bottleneck, and scrape `/metrics` during the run.
