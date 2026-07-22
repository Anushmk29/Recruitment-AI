// Minimal in-process metrics registry in Prometheus exposition format — zero dependencies
// (Wave 6 / observability). Tracks HTTP throughput + latency by method/route/status plus a
// few process gauges, scraped at GET /metrics. Counters live in the process, so with
// multiple API instances Prometheus scrapes each replica separately and sums — which is the
// normal multi-target model. For nationwide scale, swap for prom-client + a real TSDB.

// Cumulative-count histogram buckets (milliseconds). Chosen around the API SLO (p95 < 500ms).
const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const counters = new Map(); // fullKey -> count
const histograms = new Map(); // fullKey -> { labels, buckets:{le:count}, sum, count }

function labelKey(labels) {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/["\\\n]/g, "'")}"`)
    .join(",");
}

function incCounter(name, labels = {}, by = 1) {
  const key = `${name}{${labelKey(labels)}}`;
  counters.set(key, (counters.get(key) || 0) + by);
}

function observeHistogram(name, labels, value) {
  const key = `${name}{${labelKey(labels)}}`;
  let h = histograms.get(key);
  if (!h) {
    h = { labels, buckets: Object.fromEntries(BUCKETS_MS.map((b) => [b, 0])), sum: 0, count: 0 };
    histograms.set(key, h);
  }
  h.sum += value;
  h.count += 1;
  // A value <= b also satisfies every larger bucket, so increment all buckets >= value:
  // h.buckets[b] is then already the cumulative count Prometheus expects.
  for (const b of BUCKETS_MS) if (value <= b) h.buckets[b] += 1;
}

// The one hook the request middleware calls per finished request.
function recordHttp({ method, route, status, durationMs }) {
  const labels = { method, route, status: String(status) };
  incCounter("http_requests_total", labels);
  observeHistogram("http_request_duration_ms", labels, durationMs);
}

function render() {
  const lines = [];

  lines.push("# HELP http_requests_total Total HTTP requests handled.");
  lines.push("# TYPE http_requests_total counter");
  for (const [key, val] of counters) lines.push(`${key} ${val}`);

  lines.push("# HELP http_request_duration_ms HTTP request latency in milliseconds.");
  lines.push("# TYPE http_request_duration_ms histogram");
  for (const h of histograms.values()) {
    const base = labelKey(h.labels);
    for (const b of BUCKETS_MS) {
      lines.push(`http_request_duration_ms_bucket{${base},le="${b}"} ${h.buckets[b]}`);
    }
    lines.push(`http_request_duration_ms_bucket{${base},le="+Inf"} ${h.count}`);
    lines.push(`http_request_duration_ms_sum{${base}} ${h.sum.toFixed(2)}`);
    lines.push(`http_request_duration_ms_count{${base}} ${h.count}`);
  }

  const mem = process.memoryUsage();
  lines.push("# HELP process_resident_memory_bytes Resident memory size in bytes.");
  lines.push("# TYPE process_resident_memory_bytes gauge");
  lines.push(`process_resident_memory_bytes ${mem.rss}`);
  lines.push("# HELP nodejs_heap_used_bytes V8 heap used in bytes.");
  lines.push("# TYPE nodejs_heap_used_bytes gauge");
  lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);
  lines.push("# HELP process_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${Math.round(process.uptime())}`);

  return lines.join("\n") + "\n";
}

module.exports = { incCounter, observeHistogram, recordHttp, render };
