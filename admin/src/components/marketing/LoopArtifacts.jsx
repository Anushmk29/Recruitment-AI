/* Hallmark · component: marketing artifact panels · genre: modern-minimal
 * theme: HireFlow AI (DESIGN.md, locked)
 *
 * The four visuals for the Claim → Probe → Verdict section. Each one shows the
 * *shape* of a real artifact the platform produces — a frozen rubric, a cited
 * span, a summing ledger, a probe verdict list.
 *
 * Two rules govern everything in this file:
 *
 * 1. No candidate. There is no name, no photograph, no person here. The panels
 *    depict the format of a record, not a record of a human being. A landing
 *    page for a product whose claim is "no number is ever invented" cannot open
 *    with an invented person carrying an invented score.
 * 2. Every panel is labelled `Illustration`. DESIGN.md's Honest Reading Rule
 *    says a non-measurement must never be styled as a measurement, and that
 *    binds marketing surfaces exactly as hard as it binds the report screen.
 *
 * Built from hairline-bordered <figure> elements — no re-drawn browser chrome,
 * no fake window bars (gate 47). A figure is allowed to look like a figure.
 */

const PANEL = "rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6";
const ROW = "grid items-baseline gap-x-4 border-b border-slate-100 py-2.5 last:border-b-0";

function Panel({ title, meta, children }) {
  return (
    <figure className={PANEL}>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 pb-3">
        <span className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{title}</span>
        {/* Slate, never a verdict tone: this pill labels the figure's honesty,
            not an outcome. */}
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-slate-600">
          Illustration
        </span>
      </figcaption>
      {meta && <p className="pt-3 text-xs text-slate-500 [overflow-wrap:anywhere]">{meta}</p>}
      <div className="pt-3">{children}</div>
    </figure>
  );
}

/* 1.0 — the rubric is frozen before anyone is scored.
   The weights are shown summing to 100 because that is the point: the ceiling
   is fixed and visible before a single application arrives. */
const RUBRIC = [
  ["Distributed systems in production", 30],
  ["Go or Rust, 3+ years", 25],
  ["On-call ownership", 20],
  ["Postgres at scale", 15],
  ["Mentoring", 10],
];

export function RubricPanel() {
  return (
    <Panel title="Senior Backend Engineer" meta="Rubric v3 · approved by a recruiter · frozen for every candidate on this role">
      <dl className="text-sm">
        {RUBRIC.map(([criterion, weight]) => (
          <div key={criterion} className={`${ROW} grid-cols-[minmax(0,1fr)_auto]`}>
            <dt className="text-slate-700 [overflow-wrap:anywhere]">{criterion}</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{weight}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-t-2 border-slate-900 pt-2.5 text-sm">
        <span className="font-semibold text-slate-900">Total weight</span>
        <span className="font-semibold tabular-nums text-slate-900">100</span>
      </div>
    </Panel>
  );
}

/* 2.0 — the résumé becomes cited claims, not keywords.
   The dropped row is the most important row on this page: it shows the product
   discarding something rather than guessing at it. */
export function ClaimsPanel() {
  return (
    <Panel title="Extracted claims" meta="Each claim carries the verbatim span it came from. Code checks the span is a literal substring of the source.">
      <p className="rounded-xl bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere]">
        …owned the platform team’s migration and{" "}
        <mark className="rounded bg-brand-100 px-1 font-medium text-brand-900">
          ran Kubernetes in production for four years
        </mark>
        , including the cutover of forty services…
      </p>

      <ul className="mt-4 text-sm">
        <li className={`${ROW} grid-cols-[minmax(0,1fr)_auto]`}>
          <span className="text-slate-700 [overflow-wrap:anywhere]">Operated Kubernetes in production</span>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-emerald-800">
            Cited
          </span>
        </li>
        <li className={`${ROW} grid-cols-[minmax(0,1fr)_auto]`}>
          <span className="text-slate-500 [overflow-wrap:anywhere]">“Expert in distributed systems”</span>
          {/* Slate, not red. A dropped claim is not an adverse finding about a
              person — it is the engine declining to count something. */}
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-slate-600">
            No span · dropped
          </span>
        </li>
      </ul>
    </Panel>
  );
}

/* 3.0 — code computes the score.
   The line items are shown summing on the page for the same reason they sum in
   the product: a total you can add up yourself is a total you can argue with. */
const LEDGER = [
  ["Distributed systems in production", 30, 18],
  ["Go or Rust, 3+ years", 25, 25],
  ["On-call ownership", 20, 9],
  ["Postgres at scale", 15, 0],
];

export function LedgerPanel() {
  const weight = LEDGER.reduce((sum, [, w]) => sum + w, 0);
  const points = LEDGER.reduce((sum, [, , p]) => sum + p, 0);

  return (
    <Panel title="Score ledger" meta="No model is asked to produce a number. Each line item is computed from cited evidence, and the items sum to the total by construction.">
      <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem] gap-x-3 border-b border-slate-200 pb-2 text-xs font-semibold text-slate-600 sm:gap-x-4">
        <span>Criterion</span>
        <span className="text-right">Weight</span>
        <span className="text-right">Points</span>
      </div>

      <dl className="text-sm">
        {LEDGER.map(([criterion, w, p]) => (
          <div key={criterion} className={`${ROW} grid-cols-[minmax(0,1fr)_3rem_3rem] gap-x-3 sm:gap-x-4`}>
            <dt className="text-slate-700 [overflow-wrap:anywhere]">
              {criterion}
              {p === 0 && <span className="block text-xs text-slate-500">No evidence cited — scores zero, never estimated</span>}
            </dt>
            <dd className="text-right tabular-nums text-slate-500">{w}</dd>
            <dd className="text-right font-semibold tabular-nums text-slate-900">{p}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_3rem_3rem] gap-x-3 border-t-2 border-slate-900 pt-2.5 text-sm sm:gap-x-4">
        <span className="font-semibold text-slate-900">Recorded score</span>
        <span className="text-right font-semibold tabular-nums text-slate-500">{weight}</span>
        <span className="text-right font-semibold tabular-nums text-slate-900">{points}</span>
      </div>
    </Panel>
  );
}

/* 4.0 — screening ends in a test plan, and the interview closes it.
   Verdict tones are used here deliberately and correctly: verified /
   contradicted / unverified is exactly the semantic channel DESIGN.md reserves
   emerald, red, and amber for. */
const PROBES = [
  ["Kubernetes migration — scope, rollback plan, who was on call", "Verified", "emerald"],
  ["Partitioning strategy for Postgres at scale", "Unverified", "slate"],
  ["Team size behind “owned the platform team”", "Contradicted", "red"],
];

const VERDICT_TONE = {
  emerald: "bg-emerald-100 text-emerald-800",
  slate: "bg-slate-100 text-slate-600",
  red: "bg-red-100 text-red-700",
};

export function ProbePanel() {
  return (
    <Panel title="Probes and verdicts" meta="High-weight claims the résumé asserts but cannot prove become the interview’s questions. Each comes back marked.">
      <ul className="text-sm">
        {PROBES.map(([probe, verdict, tone]) => (
          <li key={probe} className={`${ROW} grid-cols-[minmax(0,1fr)_auto]`}>
            <span className="text-slate-700 [overflow-wrap:anywhere]">{probe}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${VERDICT_TONE[tone]}`}>
              {verdict}
            </span>
          </li>
        ))}
      </ul>

      {/* Amber is the awaiting-a-human tone, and this row is the only place on
          the page where the product admits it does not know. */}
      <p className="mt-4 rounded-xl bg-amber-50 p-3.5 text-sm text-amber-900 [overflow-wrap:anywhere]">
        Repeated readings disagreed on one claim. It is routed to a person, carrying the reason and the evidence — never
        averaged into a confident number.
      </p>
    </Panel>
  );
}
