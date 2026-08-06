import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, BarChart3, Bot, User, Cpu, ChevronDown, Clock, CheckCircle2, AlertTriangle, Download, Mic, ShieldCheck, ShieldAlert, ScanFace, Eye } from "lucide-react";
import api from "../api/client.js";
import { getSocket } from "../lib/socket.js";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../components/ui/Field.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "../components/ui/DataTable.jsx";
import Button from "../components/ui/Button.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { stageLabel, stageTone } from "../lib/pipeline.js";

const RECOMMENDATION = {
  strong_hire: { label: "Strong Hire", tone: "green" },
  hire: { label: "Hire", tone: "green" },
  maybe: { label: "Maybe", tone: "amber" },
  no_hire: { label: "No Hire", tone: "red" },
};

function formatWhen(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * A competency bar is a single-series MAGNITUDE mark, so it takes one ink hue —
 * not a green/amber/red band by threshold, which is what it used to do.
 *
 * That change is a product rule, not a palette preference. Colouring a 74 amber
 * and a 76 green asserts a global cutoff for "good", which is exactly the
 * generic prior CLAUDE.md forbids: nothing is scored against an abstract
 * standard, only against this role's approved rubric. The threshold was also
 * spending the reserved verdict channel on a raw sub-score, so a competency bar
 * out-shouted the actual hire/no-hire call three cards above it. The number is
 * printed beside the bar and says everything the colour was pretending to.
 */
function ScoreBar({ label, value }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="font-semibold tabular-nums text-slate-800">{value != null ? `${value}/100` : "—"}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${value == null ? "bg-slate-200" : BRAND_MARK}`}
          style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance summary — the report's opening section
// ---------------------------------------------------------------------------
//
// The report used to open with eleven stacked cards of prose and land the
// recruiter in "What we actually know" before they had a single number. This
// section answers "how did this go" in one screen — figures, then charts — and
// everything that was here before is intact behind the disclosure below it.
//
// Chart palette, run through the dataviz validator (light, surface #ffffff):
//   proven #047857 · untested #9c9384 · failed #b91c1c
// This is a DIVERGING scale, so the grey midpoint is correct rather than a
// chroma failure: "too little evidence" is genuinely the middle — the absence of
// a finding, not a middling one. The green↔red pair separates at ΔE 8.4 under
// deuteranopia, which clears the floor of 8 but only on the condition that
// colour is never the sole encoding. So every segment and every legend row
// carries a glyph AND a word AND its number. Do not "simplify" those away.

const pctOf = (w) => Math.round((w || 0) * 100);

// Ordered positive → neutral → negative, which is both the diverging convention
// and the order a recruiter reads the bar in.
const EVIDENCE_SEGMENTS = [
  // `fill` is the pastel segment + verdict-hue ring; `swatch` is the saturated
  // legend key that has to hold a white glyph at 9px. Same split as BUCKET_MARK.
  {
    key: "proven",
    label: "Proven",
    glyph: "✓",
    fill: "bg-chart-positive ring-1 ring-inset ring-verdict-positive/70",
    swatch: "bg-verdict-positive",
  },
  {
    key: "insufficient",
    label: "Untested",
    glyph: "?",
    fill: "bg-chart-neutral ring-1 ring-inset ring-slate-400/70",
    swatch: "bg-slate-400",
  },
  {
    key: "failed",
    label: "Failed",
    glyph: "✗",
    fill: "bg-chart-negative ring-1 ring-inset ring-verdict-negative/70",
    swatch: "bg-verdict-negative",
  },
];

/**
 * One headline figure. `basis` is required in spirit for the same reason it is
 * required on <HeroStat>: a number this size is the most persuasive thing on the
 * page and does not get to be the least accountable. `flag` is where a degraded
 * or placeholder reading says so, in the tile, rather than in a footnote.
 *
 * These are borderless cells in a ruled strip, not bordered tiles. A bordered
 * tile inside <Card> is a nested card, and four of them across the top is the
 * hero-metric template — big number, small label, supporting stats — which is
 * the shape every dashboard reaches for and the reason this page read as generic
 * before the role map took the lead. The figures annotate the chart now; they do
 * not compete with it.
 */
function Figure({ label, value, basis, flag }) {
  return (
    // Gutters only at `lg`, where the cells actually sit side by side as a ruled
    // strip. Carrying `px-4 first:pl-0` down to the stacked layout indented every
    // cell except the first against the card's own left edge.
    <div className="min-w-0 lg:px-5 lg:first:pl-0">
      <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1">
        <span className="font-display block text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</span>
        {basis && <span className="mt-1 block text-[11px] leading-snug text-slate-500">{basis}</span>}
        {flag && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-verdict-pending-tint px-1.5 py-0.5 text-[10px] font-bold text-verdict-pending">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {flag}
          </span>
        )}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The role map — the report's hero chart
// ---------------------------------------------------------------------------
//
// One bar per rubric criterion, width = that criterion's WEIGHT IN THE ROLE,
// sorted heaviest first, coloured by what the evidence supports. `coverage.rows`
// arrives from the backend already sorted by weight, so the ordering is the
// rubric's own and not a display choice.
//
// This is the chart the product exists to draw. Every competitor can render "78%
// match"; none can render "40% of what this role actually requires is the one
// thing we could not prove". The aggregate stack above it answers *how much* we
// know; this answers *what* we know, and about which requirement — which is the
// question a recruiter has to answer to a hiring manager, and the one an
// employer has to answer to a tribunal.
//
// The bars deliberately do NOT normalise to the widest criterion. Width is share
// of the rubric, so a 40% requirement fills 40% of the track and the empty
// remainder is the rest of the role. Normalising would make every role look
// equally concentrated and destroy the only comparison that matters.

// `mark` is the pastel chart fill plus its 1px verdict-hue ring — see the
// --color-chart-* note in index.css for why both halves are required. `chip` is
// the saturated key: small, carries a glyph, and must hold white at 9px, which a
// pastel cannot. Same hue, three weights — chip, ring, fill.
const BUCKET_MARK = {
  proven: {
    label: "Proven",
    glyph: "✓",
    mark: "bg-chart-positive ring-1 ring-inset ring-verdict-positive/70",
    chip: "bg-verdict-positive",
    text: "text-verdict-positive",
  },
  failed: {
    label: "Failed",
    glyph: "✗",
    mark: "bg-chart-negative ring-1 ring-inset ring-verdict-negative/70",
    chip: "bg-verdict-negative",
    text: "text-verdict-negative",
  },
  insufficient: {
    label: "Untested",
    glyph: "?",
    mark: "bg-chart-neutral ring-1 ring-inset ring-slate-400/70",
    chip: "bg-slate-400",
    text: "text-slate-500",
  },
};

// The single-series magnitude mark: competency bars, the answer run, the score
// movement. Pastel sky over a petrol ring, so it reads as the same brand family
// as the buttons without being their weight.
const BRAND_MARK = "bg-chart-brand ring-1 ring-inset ring-brand-600/60";

// The three evidence legs, in the order the loop runs them. `absent` and
// `untested` render as an empty outline rather than a filled neutral: an unfilled
// cell reads as "we have no reading here", which is exactly what it means, and it
// keeps the row's ink proportional to the evidence actually on record.
const LEG_MARK = {
  verified: { glyph: "✓", cls: "bg-verdict-positive text-white", says: "supports" },
  contradicted: { glyph: "✗", cls: "bg-verdict-negative text-white", says: "contradicts" },
  partial: { glyph: "~", cls: "bg-slate-400 text-white", says: "partial" },
  absent: { glyph: "", cls: "border border-slate-300", says: "nothing on record" },
  untested: { glyph: "", cls: "border border-slate-300", says: "not tested" },
};
const LEG_ORDER = [
  ["resume", "Résumé"],
  ["assessment", "Assessment"],
  ["interview", "Interview"],
];

/**
 * One evidence-leg cell.
 *
 * These were three unlabelled squares trailing each row, which needed a
 * sentence underneath the chart explaining what the positions meant. As table
 * columns they carry their own `<th>`, so the legend sentence is gone and the
 * meaning is where a reader looks for it.
 */
function LegCell({ state, leg }) {
  const m = LEG_MARK[state] || LEG_MARK.untested;
  return (
    <span
      title={`${leg}: ${m.says}`}
      className={`inline-flex h-4.5 w-4.5 items-center justify-center rounded-[4px] text-[9px] font-bold ${m.cls}`}
    >
      <span aria-hidden="true">{m.glyph}</span>
      <span className="sr-only">{m.says}</span>
    </span>
  );
}

/**
 * The one authored motion moment on this page: the map draws itself.
 *
 * Bars grow from zero on mount, staggered down the list, on the system's own
 * exponential `--ease-out`. It is a single moment rather than an effect
 * scattered over every section, and it earns its place by doing something the
 * static chart cannot: it walks the eye down the requirements in weight order,
 * heaviest first, which is exactly the order they should be read in.
 *
 * Under `prefers-reduced-motion` the initial state IS the final width, so there
 * is no frame at zero to flash — the preference is honoured by never starting,
 * not by cutting the transition and animating anyway.
 */
function useGrowOnMount() {
  const [grown, setGrown] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return grown;
}

function RoleMap({ coverage }) {
  const grown = useGrowOnMount();
  const rows = coverage?.rows || [];
  if (rows.length === 0) return null;
  const totals = coverage.totals || {};

  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-base font-bold tracking-tight text-slate-900">
          The role, by what we can prove
        </h3>
        <p className="text-xs text-slate-500">
          {rows.length} requirement{rows.length === 1 ? "" : "s"}
          {coverage.rubricVersion != null ? ` · rubric v${coverage.rubricVersion}` : ""} · bar width is the rubric&apos;s own
          weight
        </p>
      </figcaption>

      {/* A real table, because this is a genuine 2-D matrix: criterion ×
          evidence source. DESIGN.md § The Record-Card Rule names exactly this
          shape as its exception, and DataTable.jsx was kept for exactly this
          surface. Two things fall out of using columns rather than a styled
          list: the three evidence legs finally carry their own <th>, so the
          "trail, in order: …" sentence that explained three unlabelled squares
          is gone; and every field lands under a heading a reader can scan. */}
      <TableWrap>
        <Table className="mt-4 min-w-[52rem]">
          <THead>
            <tr>
              <TH padding="none" className="sticky left-0 z-10 w-[30%] min-w-[13rem] border-r border-slate-200 bg-white">
                <span className="block pr-4">Requirement</span>
              </TH>
              <TH padding="compact" className="w-[26%] min-w-[9rem]">Share of role</TH>
              <TH padding="compact" align="right">Weight</TH>
              <TH padding="compact" className="w-[12%]">Verdict</TH>
              {LEG_ORDER.map(([key, name]) => (
                <TH key={key} padding="tight" align="center">
                  {name}
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {rows.map((r, i) => {
              const m = BUCKET_MARK[r.bucket] || BUCKET_MARK.insufficient;
              const w = pctOf(r.weight);
              return (
                <TR key={r.criterionId}>
                  {/* Sticky, so the requirement stays on screen while the
                      matrix scrolls under it on a narrow viewport — without it a
                      390px screen showed this column and nothing else. `bg-inherit`
                      carries the row hover into the frozen column. */}
                  <TD padding="none" className="sticky left-0 z-10 border-r border-slate-200 bg-inherit align-top">
                    <span className="block pr-4">
                      <span className="block text-sm leading-snug font-semibold text-slate-900 [overflow-wrap:anywhere]">
                        {r.label}
                      </span>
                      {/* The citation travels in the same cell as the thing it
                          cites. A separate column would have been the widest on
                          the table and would have pushed the matrix off-screen. */}
                      <span className="mt-1 block text-[11px] leading-snug text-slate-500">{r.evidence}</span>
                    </span>
                  </TD>

                  <TD padding="compact" className="align-top">
                    <span
                      className="mt-1.5 block h-2.5 w-full rounded-full bg-slate-100"
                      role="img"
                      aria-label={`${w}% of the role, ${m.label}`}
                      title={`${w}% of the role · ${m.label} · ${r.evidence}`}
                    >
                      <span
                        className={`block h-full rounded-full transition-[width] duration-700 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none ${m.mark}`}
                        style={{ width: grown ? `${w}%` : "0%", transitionDelay: `${i * 70}ms` }}
                      />
                    </span>
                  </TD>

                  <TD padding="compact" align="right" className="align-top">
                    <span className="text-sm font-bold tabular-nums text-slate-900">{w}%</span>
                  </TD>

                  <TD padding="compact" className="align-top">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${m.text}`}>
                      <span
                        aria-hidden="true"
                        className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white ${m.chip}`}
                      >
                        {m.glyph}
                      </span>
                      {m.label}
                    </span>
                  </TD>

                  {LEG_ORDER.map(([key, name]) => (
                    <TD key={key} padding="tight" className="align-top">
                      <span className="flex justify-center">
                        <LegCell state={r[key]} leg={name} />
                      </span>
                    </TD>
                  ))}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableWrap>

      {/* The trail needs naming once. Three unlabelled cells are a cipher; three
          cells with the loop's own three words are the product's mechanism. */}
      {/* Only the cell glyphs need a key now. The three column headers say what
          the positions are, which is the sentence that used to open this row. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
        {[["verified", "supports"], ["contradicted", "contradicts"], ["partial", "partial"], ["untested", "not tested"]].map(
          ([k, word]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] text-[8px] font-bold ${LEG_MARK[k].cls}`}
              >
                {LEG_MARK[k].glyph}
              </span>
              {word}
            </span>
          )
        )}
      </div>

      {totals.underpoweredCriteria > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {totals.underpoweredCriteria} of {totals.criteria} requirements were tested with fewer than {totals.minItemsForCall}{" "}
          items and never probed live. That is too little to call either way — a statement about our test, not about the
          candidate.
        </p>
      )}
    </figure>
  );
}

/**
 * What verification did to the screening score.
 *
 * The delta was a sentence before, and a sentence is the wrong shape for it: the
 * whole pitch of the Claim → Probe → Verdict loop is that probing MOVES the
 * number, and movement is what a chart shows and prose does not. Two bars on one
 * shared 0–100 scale — never two scales, never an indexed pair.
 *
 * Both bars are brand ink. A drop is not an adverse finding, it is a correction,
 * and colouring it red would state a verdict the loop deliberately withholds.
 */
function ScoreMovement({ delta }) {
  if (!delta?.pre || !delta?.post) return null;
  const rows = [
    { label: "Screening", value: delta.pre.overallScore },
    { label: "After probes", value: delta.post.overallScore },
  ];
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="text-[11px] font-semibold text-slate-700">
        Verification moved the score
        <span className="ml-1.5 font-bold tabular-nums text-slate-900">
          {delta.delta > 0 ? "+" : ""}
          {delta.delta}
        </span>
      </p>
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[11px] text-slate-500">{r.label}</span>
            <span className="h-1.5 min-w-0 flex-1 rounded-full bg-slate-100">
              <span
                className={`block h-full rounded-full ${BRAND_MARK}`}
                style={{ width: `${Math.max(0, Math.min(100, r.value || 0))}%` }}
                title={`${r.label}: ${r.value}/100`}
              />
            </span>
            <span className="w-7 shrink-0 text-right text-[11px] font-bold tabular-nums text-slate-900">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The signature chart: the whole role as one bar, split by what the evidence
 * actually supports and weighted by the rubric — not by how many questions
 * happened to be asked. This is the Claim → Probe → Verdict loop rendered in a
 * single mark, and it is the one picture no keyword ATS can draw.
 */
function EvidenceStack({ coverage }) {
  if (!coverage?.buckets) return null;
  const segs = EVIDENCE_SEGMENTS.map((s) => ({
    ...s,
    weight: coverage.buckets[s.key]?.weight || 0,
    count: coverage.buckets[s.key]?.rows?.length || 0,
  })).filter((s) => s.weight > 0);
  if (!segs.length) return null;
  const total = segs.reduce((a, s) => a + s.weight, 0) || 1;
  const sentence = segs.map((s) => `${s.label} ${pctOf(s.weight / total)}%`).join(", ");

  return (
    <figure className="min-w-0">
      {/* Named as the TOTAL of the bars above rather than as a second chart of
          the same data. Two altitudes of one artefact: the map says which
          requirement, this says how much of the role that adds up to. */}
      <figcaption className="text-xs font-semibold text-slate-700">
        Summed by verdict
        <span className="ml-1.5 font-normal text-slate-500">— the bars above, as a share of the whole role</span>
      </figcaption>
      {/* `gap` between segments is the 2px surface spacer; each segment keeps its
          own rounded ends rather than the track clipping them. */}
      <div className="mt-2.5 flex h-3.5 w-full gap-0.5" role="img" aria-label={`Role coverage by evidence: ${sentence}.`}>
        {segs.map((s) => (
          <div
            key={s.key}
            title={`${s.label}: ${pctOf(s.weight / total)}% of the role · ${s.count} requirement${s.count === 1 ? "" : "s"}`}
            style={{ width: `${(s.weight / total) * 100}%` }}
            className={`h-full rounded-full ${s.fill}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white ${s.swatch}`}
            >
              {s.glyph}
            </span>
            <span className="font-medium text-slate-700">{s.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{pctOf(s.weight / total)}%</span>
            <span className="text-slate-500">
              ({s.count} req{s.count === 1 ? "" : "s"})
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * One cell per answer, in order. Height = answer score; a marked cell is a turn
 * whose audio signature was degraded. This is the view that makes "eight
 * near-silent answers in a row" visible at a glance instead of averaged away.
 *
 * Ink for a scored answer, verdict-negative for a degraded one — a pair that
 * separates at only ΔE 5.3 under protanopia, which is why the "!" beneath a
 * degraded bar and the reason in its tooltip are load-bearing rather than
 * decorative.
 */
function AnswerRun({ quality }) {
  if (!quality?.perTurn?.length) return null;
  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-semibold text-slate-700">
        Answer-by-answer score
        <span className="font-normal text-slate-500">
          {quality.degradedCount} of {quality.total} flagged
        </span>
      </figcaption>
      <div className="mt-2.5 flex items-end gap-1 overflow-x-auto pb-1">
        {quality.perTurn.map((t) => {
          const score = t.answerScore ?? 0;
          const tip = [
            `Answer ${t.index + 1}: ${t.answerScore != null ? `${t.answerScore}/100` : "unscored"}`,
            `${t.words} words`,
            t.audioMs ? `${Math.round(t.audioMs / 1000)}s audio` : null,
            ...t.flags.map((f) => TURN_FLAG_LABEL[f] || f),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div key={t.index} title={tip} className="flex w-4 shrink-0 flex-col items-center gap-1">
              <div className="flex h-14 w-full items-end rounded-sm bg-slate-100">
                <div
                  className={`w-full rounded-sm ${t.degraded ? "bg-chart-negative ring-1 ring-inset ring-verdict-negative/70" : BRAND_MARK}`}
                  style={{ height: `${Math.max(4, Math.min(100, score))}%` }}
                />
              </div>
              {/* Secondary encoding — the flag is never colour-alone. */}
              <span className={`text-[10px] leading-none ${t.degraded ? "text-verdict-negative" : "text-transparent"}`} aria-hidden="true">
                !
              </span>
            </div>
          );
        })}
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${BRAND_MARK}`} /> Answer score
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-negative ring-1 ring-inset ring-verdict-negative/70" /> ! Degraded audio
        </li>
        <li>Hover any bar for the reason.</li>
      </ul>
    </figure>
  );
}

/**
 * Résumé claims the screening could not verify, and what the interview did to
 * them. Reuses the evidence trio exactly — verified / inconclusive / contradicted
 * IS positive / neutral / negative, and "inconclusive" is a true midpoint.
 *
 * It deliberately does not reach for amber: verdict-pending against
 * verdict-negative measures ΔE 2.4 under protanopia and 8.9 even with full
 * colour vision, i.e. a pair most readers cannot separate. Same reason the counts
 * are printed rather than left to the bar.
 */
function ClaimTally({ cv }) {
  if (!cv?.probes?.length) return null;
  const counts = {
    verified: cv.probes.filter((p) => p.verdict === "verified").length,
    inconclusive: cv.probes.filter((p) => p.verdict !== "verified" && p.verdict !== "contradicted").length,
    contradicted: cv.probes.filter((p) => p.verdict === "contradicted").length,
  };
  const rows = [
    { key: "verified", label: "Verified", glyph: "✓", swatch: "bg-verdict-positive", n: counts.verified },
    { key: "inconclusive", label: "Not settled", glyph: "?", swatch: "bg-slate-400", n: counts.inconclusive },
    { key: "contradicted", label: "Contradicted", glyph: "✗", swatch: "bg-verdict-negative", n: counts.contradicted },
  ];
  const d = cv.scoreDelta;

  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-semibold text-slate-700">
        Résumé claims probed
        <span className="font-normal text-slate-500">{cv.probes.length} tested</span>
      </figcaption>
      <ul className="mt-2.5 space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white ${r.swatch}`}
            >
              {r.glyph}
            </span>
            <span className="flex-1 font-medium text-slate-700">{r.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{r.n}</span>
          </li>
        ))}
      </ul>
      <ScoreMovement delta={d} />
      <p className="mt-2.5 text-[11px] leading-snug text-slate-500">A contradicted claim never auto-rejects.</p>
    </figure>
  );
}

/**
 * Section 1. Figures first, then the charts, then a link to everything else.
 *
 * The degraded/placeholder strip sits at the TOP of this card rather than under
 * the numbers, because rule 5 is that uncertainty must be visible wherever a
 * measurement surfaces — and a summary is the surface most likely to be read
 * alone, screenshotted, or pasted into a hiring thread.
 */
function PerformanceSummary({ report, interview, ev, coverage, quality, onDownloadPdf, downloading }) {
  const placeholder = ev?.generatedBy === "fallback";
  const triplet = interview?.competencyTriplet;
  const asked = ev?.questionsAsked ?? interview?.questionCount;
  const answered = ev?.questionsAnswered;
  const declined = ev?.questionsDeclined;
  const proven = coverage?.buckets?.proven?.weight;
  const untested = coverage?.totals?.insufficientWeight;
  const band = report.proctoring ? RISK_BAND[report.proctoring.displayRiskBand] || RISK_BAND.low : null;
  const assessResult = report.assessment?.session?.result;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <BarChart3 className="h-4 w-4 text-brand-600" aria-hidden="true" /> Performance summary
          </h2>
          <p className="mt-1 max-w-prose text-xs text-slate-500">
            Every figure below is computed in code from the evidence on record — no model emits a number here.
          </p>
        </div>
        {report.hasInterview && (
          <Button variant="outline" size="sm" loading={downloading} onClick={onDownloadPdf}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download full PDF
          </Button>
        )}
      </div>

      {(placeholder || quality?.degraded) && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-verdict-pending/30 bg-verdict-pending-tint px-3 py-2 text-xs font-semibold text-verdict-pending">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {placeholder
            ? "Placeholder figures — the AI evaluation did not run, so these come from answer-completeness heuristics and are not a measurement of this candidate."
            : "Degraded session — these figures are shown for transparency and should not be read as a measure of this candidate."}
        </p>
      )}

      {/* A ruled strip, not four bordered tiles. See <Figure>: the figures
          annotate the role map below; they no longer lead. */}
      <dl className="mt-5 grid gap-x-6 gap-y-4 border-y border-slate-100 py-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-0 lg:divide-x lg:divide-slate-100">
        <Figure
          label="Interview score"
          value={ev?.overallScore ?? "—"}
          basis={answered != null && asked != null ? `over ${answered} answered of ${asked} asked` : "not scored yet"}
          flag={placeholder ? "Placeholder" : null}
        />
        <Figure
          label="Role proven"
          value={proven != null ? `${pctOf(proven)}%` : "—"}
          basis={untested != null ? `${pctOf(untested)}% of the role still untested` : "rubric-weighted"}
        />
        <Figure
          label="Questions answered"
          value={answered != null && asked != null ? `${answered}/${asked}` : "—"}
          basis={
            declined
              ? `${declined} declined — asked, could not answer`
              : interview?.substance
                ? `${interview.substance.responsiveCount} of ${interview.substance.totalAnswers} on-topic`
                : "as asked in the interview"
          }
        />
        {band ? (
          <Figure
            label="Integrity"
            value={band.label}
            basis={`${report.proctoring.totalEvents} flag${report.proctoring.totalEvents === 1 ? "" : "s"} — advisory, never a reason alone`}
          />
        ) : assessResult ? (
          <Figure
            label="Assessment"
            value={`${assessResult.totalCorrect}/${assessResult.totalItems}`}
            basis="items correct — scored deterministically by code"
          />
        ) : null}
      </dl>

      {/* The hero. The aggregate stack sits directly under it as the total the
          bars sum to, so the two read as one artefact at two altitudes rather
          than as two charts of the same thing. */}
      <div className="mt-7">
        <RoleMap coverage={coverage} />
        <div className="mt-6 border-t border-slate-100 pt-5">
          <EvidenceStack coverage={coverage} />
        </div>
      </div>

      {/* Everything below is deliberately quieter and smaller than the map: the
          three supporting reads, at one third the width each. */}
      <div className="mt-7 grid gap-x-8 gap-y-7 border-t border-slate-100 pt-6 md:grid-cols-2 xl:grid-cols-3">
        {triplet && (
          <figure className="min-w-0">
            <figcaption className="text-xs font-semibold text-slate-700">
              Competencies
              <span className="ml-1.5 font-normal text-slate-500">— from the transcript, not the score</span>
            </figcaption>
            <div className="mt-3 space-y-2.5">
              <ScoreBar label="Communication" value={triplet.communication} />
              <ScoreBar label="Technical" value={triplet.technicalKnowledge} />
              <ScoreBar label="Problem solving" value={triplet.problemSolving} />
            </div>
          </figure>
        )}
        <AnswerRun quality={quality} />
        <ClaimTally cv={report.claimVerification} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Evidence coverage
// ---------------------------------------------------------------------------
// proven ↔ failed is a POLARITY, so the two groups take opposed hues with a
// neutral gray for "too little evidence" — which is genuinely the middle: the
// absence of a finding, not a middling one.
//
// Palette validated with the dataviz validator (light, all checks pass).
// emerald↔red CVD separation is ΔE 8.6 — above the 8 floor but not generous — so
// each group's glyph and its written title are load-bearing, not decorative.
// Never reduce a group to colour alone.
//
// The headline artefact, grouped by what we can actually SAY rather than by which
// system produced the data. A recruiter's question is "what do I know and what do
// I still need to ask" — so the three groups answer exactly that, and the third
// one doubles as the next round's question list.
const BUCKET_META = {
  proven: {
    title: "Proven",
    blurb: "Demonstrated under test.",
    head: "border-emerald-200 bg-emerald-50/70",
    dot: "bg-emerald-600",
    glyph: "✓",
  },
  failed: {
    title: "Failed",
    blurb: "The candidate could not support this.",
    head: "border-red-200 bg-red-50/70",
    dot: "bg-red-600",
    glyph: "✗",
  },
  insufficient: {
    title: "Too little evidence",
    blurb: "Our test was too thin to call this either way — not a mark against the candidate.",
    head: "border-slate-200 bg-slate-50",
    dot: "bg-slate-400",
    glyph: "?",
  },
};

function BucketGroup({ bucket, group, showNextSteps }) {
  if (!group?.rows?.length) return null;
  const meta = BUCKET_META[bucket];
  const pct = (w) => `${Math.round(w * 100)}%`;
  return (
    <div className={`rounded-xl border ${meta.head} p-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-bold text-white ${meta.dot}`}>
            {meta.glyph}
          </span>
          {meta.title}
        </h4>
        <span className="text-xs font-semibold tabular-nums text-slate-500">{pct(group.weight)} of role</span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">{meta.blurb}</p>

      <div className="mt-2.5 space-y-2">
        {group.rows.map((r) => (
          <div key={r.criterionId} className="rounded-lg bg-white/80 p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-800">{r.label}</span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">{pct(r.weight)}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{r.evidence}</p>
            {/* A verdict the recruiter can't read for themselves isn't evidence. */}
            {r.decidingProbe?.answerQuote && (
              <p className="mt-1 text-xs italic text-slate-500">&ldquo;{r.decidingProbe.answerQuote}&rdquo;</p>
            )}
          </div>
        ))}
      </div>

      {showNextSteps && (
        <p className="mt-2.5 border-t border-slate-200 pt-2 text-[11px] font-medium text-slate-600">
          These are the questions for the next round.
        </p>
      )}
    </div>
  );
}

function CoverageMatrix({ coverage }) {
  if (!coverage?.buckets) return null;
  const { buckets, totals } = coverage;
  const pct = (w) => `${Math.round(w * 100)}%`;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-brand-600" /> What we actually know
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Every requirement for this role{coverage.rubricVersion != null ? ` (rubric v${coverage.rubricVersion})` : ""}, grouped by how
            strong the evidence is. Percentages are each requirement&apos;s weight in the rubric.
          </p>
        </div>
        {totals.insufficientWeight >= 0.3 && (
          <Badge tone="amber">{pct(totals.insufficientWeight)} of the role is untested</Badge>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <BucketGroup bucket="failed" group={buckets.failed} />
        <BucketGroup bucket="proven" group={buckets.proven} />
        <BucketGroup bucket="insufficient" group={buckets.insufficient} showNextSteps />
      </div>

      {/* The gap is a statement about OUR test, not about the candidate. */}
      {totals.underpoweredCriteria > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {totals.underpoweredCriteria} of {totals.criteria} requirements were tested with fewer than {totals.minItemsForCall} items and
          never probed in the interview. That is too little to score either way — on a handful of multiple-choice items a wrong answer
          is indistinguishable from a guess. Widen the paper or probe these live before treating them as weaknesses.
        </p>
      )}
    </Card>
  );
}

// §3 rule 5 — a degraded session is labelled wherever it surfaces, and the
// hire/no-hire call is withheld rather than printed over a broken signal.
function SessionQualityBanner({ quality }) {
  if (!quality?.degraded) return null;
  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <h2 className="text-base font-bold text-amber-900">Degraded session — recommendation withheld</h2>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-sm text-amber-800">
            {quality.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-medium text-amber-700">
            On a broken audio signal an unanswered question cannot be told apart from an unheard one. Scores below are shown for
            transparency and should not be read as a measure of this candidate.
          </p>
        </div>
      </div>
    </div>
  );
}

// One cell per answer, in order. Height = answer score; a marked cell is a turn
// whose audio signature was degraded. This is the view that makes "eight
// near-silent answers in a row" visible at a glance instead of averaged away.
// Every label here describes the RECORDING, not the candidate. "very low delivery" used to sit
// in this list and it read as a verdict on the person; what it actually meant was that almost no
// audio came through. `low_delivery` is kept as a key so sessions recorded before the rename
// still render a label instead of a raw flag name.
const TURN_FLAG_LABEL = {
  stalled: "long recording, almost no words",
  mostly_silence: "mostly silence",
  unusable_audio: "audio too poor to assess",
  low_delivery: "audio too poor to assess",
  asked_to_repeat: "asked for the question again",
  connection_dropped: "connection dropped — part of this answer was never recorded",
};

const RISK_BAND = {
  low: { label: "Low risk", tone: "green", ring: "text-emerald-600", bg: "bg-emerald-500" },
  medium: { label: "Medium risk", tone: "amber", ring: "text-amber-600", bg: "bg-amber-500" },
  high: { label: "High risk", tone: "red", ring: "text-red-600", bg: "bg-red-500" },
};
const SEVERITY_TONE = { low: "slate", medium: "amber", high: "red" };

const VERDICT_META = {
  CLEAR_REJECT: { label: "Clear reject", tone: "red", classes: "border-red-200 bg-red-50 text-red-800" },
  REVIEW: { label: "Review", tone: "amber", classes: "border-amber-200 bg-amber-50 text-amber-800" },
  ADVANCE: { label: "Advance", tone: "green", classes: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

// §1: the single headline call, above everything else. Color-coded so a recruiter
// reaches a hire/no-hire read in seconds without having to parse raw scores.
function VerdictBanner({ verdict }) {
  if (!verdict) return null;
  const meta = VERDICT_META[verdict.verdict] || VERDICT_META.REVIEW;
  return (
    <div className={`rounded-2xl border-2 p-5 ${meta.classes}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{meta.label}</h2>
        <Badge tone={meta.tone}>Confidence: {verdict.confidence}</Badge>
      </div>
      <p className="mt-1.5 text-sm font-medium">{verdict.reason}</p>
    </div>
  );
}

const COMPETENCY_LABELS = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  system_design: "System design",
  debugging: "Debugging",
  learning: "Learning",
  general: "General",
};

// §9: one row per question, tagged with the competency it probes plus a quoted
// evidence snippet — shows a recruiter where the candidate is strong/weak, not just
// one global number.
function CompetencyTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <Card>
      <h3 className="mb-3 text-base font-semibold text-slate-900">Competency breakdown</h3>
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="brand">{COMPETENCY_LABELS[r.competency] || r.competency}</Badge>
              <span className="text-sm font-semibold text-slate-800">{r.score != null ? `${r.score}/100` : "—"}</span>
            </div>
            {r.evidence && <p className="mt-2 text-xs italic text-slate-500">&ldquo;{r.evidence}&rdquo;</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

// Phase 8: the Claim → Probe → Verdict loop, closed. Each probed résumé claim
// with its verdict and BOTH quotes (résumé vs transcript) side by side, plus the
// pre→post score delta the verdicts produced. A contradicted claim is evidence
// for a human — never an automatic rejection.
const PROBE_VERDICT_META = {
  verified: { label: "Verified in interview", tone: "green", border: "border-emerald-200 bg-emerald-50/60" },
  contradicted: { label: "Contradicted in interview", tone: "red", border: "border-red-200 bg-red-50/60" },
  inconclusive: { label: "Inconclusive", tone: "amber", border: "border-amber-200 bg-amber-50/50" },
};

function ClaimVerificationCard({ cv }) {
  if (!cv || !cv.probes?.length) return null;
  const d = cv.scoreDelta;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-brand-600" /> Claim verification
        </h3>
        {d && (
          <Badge tone={d.delta > 0 ? "green" : d.delta < 0 ? "red" : "slate"}>
            Score {d.pre.overallScore} → {d.post.overallScore} ({d.delta > 0 ? "+" : ""}{d.delta})
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        These questions tested résumé claims the screening couldn&apos;t verify. Verdicts changed the evidence score through the
        verification multiplier{d ? "" : " (rescore pending)"}.
      </p>
      <div className="mt-4 space-y-3">
        {cv.probes.map((p) => {
          const meta = p.verdict ? PROBE_VERDICT_META[p.verdict] : null;
          return (
            <div key={p.claimId} className={`rounded-xl border p-3 ${meta ? meta.border : "border-slate-200 bg-slate-50/60"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={meta ? meta.tone : "slate"}>
                  {meta ? meta.label : p.status === "asked" ? "Asked — verdict pending" : "Not covered in this interview"}
                </Badge>
              </div>
              {p.resumeQuote && (
                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-600">Résumé:</span> &ldquo;{p.resumeQuote}&rdquo;
                </p>
              )}
              <p className="mt-1 text-sm text-slate-700">
                <span className="text-xs font-semibold text-slate-600">Asked:</span> {p.question}
              </p>
              {p.answerQuote && (
                <p className="mt-1 text-xs text-slate-600">
                  <span className="font-semibold text-slate-600">Answer:</span> &ldquo;{p.answerQuote}&rdquo;
                </p>
              )}
              {p.verdictReasoning && <p className="mt-1.5 text-xs italic text-slate-500">{p.verdictReasoning}</p>}
            </div>
          );
        })}
      </div>
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
        A contradicted claim is evidence for your judgement — both quotes are shown so you can read the exchange yourself. It never
        auto-rejects.
      </p>
    </Card>
  );
}

// A3.5 — the skills-assessment leg of the pipeline, in the same report as the
// interview it fed. Mirrors the PDF section: a skip renders as a recorded human
// decision, a live session as its status, and a result with full provenance.
const ASSESSMENT_VERDICT_META = {
  verified: { label: "Verified by assessment", tone: "green" },
  contradicted: { label: "Contradicted by assessment", tone: "red" },
  inconclusive: { label: "Inconclusive", tone: "amber" },
};
const ASSESSMENT_TIER_SOURCE = {
  claim_derived: "derived from résumé claims",
  recruiter_override: "set by the recruiter",
  paper_fixed: "fixed for this paper",
};

function AssessmentCard({ assessment, criterionLabels }) {
  if (!assessment) return null;
  const { decision, session } = assessment;
  const result = session?.result;
  // A recruiter must never be shown "c5: 1/3". The rubric has real labels; use them.
  const labelFor = (id) => criterionLabels?.[id] || id;
  return (
    <Card>
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <ShieldCheck className="h-4 w-4 text-brand-600" /> Skills assessment
      </h3>
      {decision?.action === "skipped" ? (
        <p className="mt-2 text-sm text-slate-600">
          Skipped by <strong>{decision.byName || "a recruiter"}</strong> on {formatWhen(decision.at)} — sent directly to the AI
          interview. A recorded human decision, not missing data.
        </p>
      ) : !session ? (
        <p className="mt-2 text-sm text-slate-500">An assessment decision was recorded but no session exists yet.</p>
      ) : (
        <>
          {session.difficultyTier && (
            <p className="mt-2 text-xs text-slate-500">
              Difficulty <strong className="uppercase">{session.difficultyTier.value}</strong> —{" "}
              {ASSESSMENT_TIER_SOURCE[session.difficultyTier.source] || session.difficultyTier.source}
              {session.difficultyTier.basis ? ` (${session.difficultyTier.basis})` : ""}
            </p>
          )}
          {!result ? (
            <p className="mt-2 text-sm text-slate-500">Status: {session.status}. No scored result yet.</p>
          ) : (
            <>
              <p className="mt-2 text-lg font-bold text-slate-900">
                {result.totalCorrect}/{result.totalItems} items correct{" "}
                {result.completedBy === "expiry" && <Badge tone="amber">partial — closed by expiry</Badge>}
              </p>
              <div className="mt-3 space-y-1.5">
                {(result.perCriterion || []).map((c) => (
                  <div key={c.criterionId} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-slate-600">{labelFor(c.criterionId)}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-800">
                      {c.correctCount}/{c.itemCount}
                    </span>
                  </div>
                ))}
              </div>
              {(result.claimVerdicts || []).length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  {result.claimVerdicts.map((v) => {
                    const meta = ASSESSMENT_VERDICT_META[v.verdict] || ASSESSMENT_VERDICT_META.inconclusive;
                    return (
                      <p key={v.claimId} className="text-xs text-slate-500">
                        <Badge tone={meta.tone}>{meta.label}</Badge>{" "}
                        <span className="text-slate-600">{labelFor(v.criterionId)}</span> — {v.correctCount}/{v.itemCount} targeted
                        items
                      </p>
                    );
                  })}
                </div>
              )}
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                Scored {formatWhen(result.scoredAt)} · scorer {result.scorerVersion || "—"} · reproducibility{" "}
                {(result.reproducibilityHash || "").slice(0, 16)}… — computed deterministically by code from the frozen key; no AI in
                the scoring path.
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}

// §5: explicit action verb + one-line justification — the report's final word.
function RecommendedActionCard({ action }) {
  if (!action) return null;
  // A withheld recommendation must not wear the same confident styling as a real
  // one — the point is that the signal was too poor to make the call.
  if (action.suppressed) {
    return (
      <Card className="border-2 border-dashed border-verdict-pending/50 bg-verdict-pending-tint">
        <p className="text-xs font-medium text-verdict-pending">Recommendation withheld</p>
        <p className="mt-1 text-lg font-bold text-verdict-pending">{action.action}</p>
        <p className="mt-1 text-sm text-verdict-pending">{action.justification}</p>
      </Card>
    );
  }
  // A ledger entry, not a slab.
  //
  // This was a full-bleed dark petrol gradient, and once the charts went pastel
  // it was the only heavy dark object left on a page of warm paper — it out-shouted
  // the verdict banner at the top, which is the actual headline call, and it read
  // as a component borrowed from a different product.
  //
  // Emphasis now comes from weight, size and space, which is what the craft floor
  // asks for and what the Evidence Ledger north star implies: the report's final
  // word should look STAMPED on the record rather than pasted over it. A greige
  // ground separates it from the white cards around it, a 3px petrol rule across
  // the top is the ledger mark, and the action itself carries display weight.
  //
  // The rule is on the TOP edge deliberately. A coloured left border above 1px is
  // the callout cliché the floor bans; a top rule is a different device and reads
  // as an underscore on a record.
  return (
    <Card className="relative overflow-hidden border-brand-200 bg-canvas-deep">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-brand-600" />
      <p className="text-[11px] font-semibold tracking-[0.08em] text-brand-700 uppercase">Recommended action</p>
      <p className="font-display mt-2 text-2xl font-extrabold tracking-[-0.02em] text-slate-900 text-balance sm:text-[1.75rem] sm:leading-[1.15]">
        {action.action}
      </p>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-slate-600">{action.justification}</p>
    </Card>
  );
}

function IdentityRow({ identityMatch }) {
  const s = identityMatch?.status || "unknown";
  const map = {
    match: { icon: ShieldCheck, cls: "text-emerald-600", text: "Face matched the identity photo" },
    mismatch: { icon: ShieldAlert, cls: "text-red-600", text: "Face did NOT match the identity photo" },
    unknown: { icon: ScanFace, cls: "text-slate-500", text: "Identity not checked during the interview" },
  };
  const { icon: Icon, cls, text } = map[s] || map.unknown;
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <Icon className={`h-4 w-4 shrink-0 ${cls}`} /> {text}
      {identityMatch?.distance != null && <span className="text-xs text-slate-500">(distance {identityMatch.distance})</span>}
    </div>
  );
}

// Phase 14.5 — inline player for an event-anchored evidence clip. The bytes
// stream through an authenticated endpoint (a bare <video src> can't send the
// bearer token), and every fetch is audit-logged server-side.
function EvidenceClip({ clip }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => src && URL.revokeObjectURL(src), [src]);

  async function loadClip() {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get(`/interview-sessions/evidence/${clip._id}`, { responseType: "blob" });
      setSrc(URL.createObjectURL(res.data));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const label = `${new Date(clip.capturedAt).toLocaleTimeString()} · ${clip.source === "phone" ? "phone cam" : "laptop cam"}`;
  const t = clip.trigger;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{clip.eventType.replace(/_/g, " ")}</span>
        <span>{label}</span>
      </div>

      {/* The measurement that caused this capture, shown ABOVE the footage on purpose. A clip is
          here to let you overturn the flag, not to prove it — so you should read what the machine
          claims and then watch whether the video actually shows it. A clip that contradicts its own
          label is the single most important thing this panel can surface. */}
      {t && (
        <div className="mb-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
          {t.rule && <p className="font-medium text-slate-600">Triggered by: {t.rule}</p>}
          <p className="mt-0.5 flex flex-wrap gap-x-3">
            {t.direction && <span>direction: looking {t.direction === "down" ? "down" : "to the side"}</span>}
            {t.faceCount != null && <span>faces detected: {t.faceCount}</span>}
            {t.distance != null && <span>face distance: {t.distance}{t.threshold != null && ` (match under ${t.threshold})`}</span>}
            {t.lastDetectorScore != null && <span>detector confidence beforehand: {t.lastDetectorScore}</span>}
            {t.lastFaceFrameRatio != null && <span>face filled {(t.lastFaceFrameRatio * 100).toFixed(1)}% of frame</span>}
            {t.lastFaceAtEdge === true && <span>face was cropped by the frame edge</span>}
          </p>
        </div>
      )}
      {clip.scored === false && (
        <p className="mb-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] text-slate-500">
          This clip records <span className="font-medium text-slate-600">our camera view quality</span>, not the
          candidate&apos;s conduct. It carries no risk score and is not a flag against them.
        </p>
      )}

      {src ? (
        <video src={src} controls className="w-full rounded-lg bg-black" />
      ) : (
        <button
          onClick={loadClip}
          disabled={loading}
          className="w-full rounded-lg border border-dashed border-slate-300 bg-white py-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
        >
          {loading ? "Loading clip…" : failed ? "Could not load — try again" : "▶ Load clip (view is audit-logged)"}
        </button>
      )}
    </div>
  );
}

function IntegrityCard({ proctoring, evidenceClips }) {
  const band = RISK_BAND[proctoring.displayRiskBand] || RISK_BAND.low;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Eye className="h-4 w-4 text-brand-600" /> Integrity & Proctoring
        </h3>
        <Badge tone={band.tone}>{band.label}</Badge>
      </div>

      {proctoring.identityGateNote && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">{proctoring.identityGateNote}</p>
      )}

      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-slate-900 text-white">
          <span className="text-2xl font-bold">{proctoring.displayRiskScore ?? 0}</span>
          <span className="text-[10px] text-slate-300">Risk</span>
        </div>
        <div className="flex-1 space-y-2">
          <IdentityRow identityMatch={proctoring.identityMatch} />
          <div className="flex items-center gap-2 text-sm text-slate-600">
            {proctoring.visionEnabled ? (
              <><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> Camera monitoring was active</>
            ) : (
              <><AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> Camera monitoring off — browser signals only</>
            )}
          </div>
          <div className="text-xs text-slate-500">
            {proctoring.totalEvents} flag{proctoring.totalEvents === 1 ? "" : "s"} recorded
            {proctoring.consent?.given ? " · candidate consented" : proctoring.consent?.declined ? " · candidate declined proctoring" : ""}
          </div>
        </div>
      </div>

      {proctoring.breakdown?.length > 0 && (
        <div className="mt-4 space-y-2">
          {proctoring.breakdown.map((row) => (
            <div key={row.type} className="flex flex-wrap items-baseline gap-2">
              {/* Recording-condition rows are shown but visually demoted and explicitly marked
                  unscored. They must appear — "we could not see" rendered as silence reads as
                  "nothing happened" — but they are not findings about the candidate. */}
              <Badge tone={row.scored === false ? "slate" : SEVERITY_TONE[row.severity] || "slate"}>
                {row.label} · {row.count}×
              </Badge>
              {row.scored === false && (
                <span className="text-xs font-semibold text-slate-500">Not scored</span>
              )}
              {row.benignExplanation && <span className="text-xs text-slate-500">{row.benignExplanation}</span>}
            </div>
          ))}
        </div>
      )}

      {evidenceClips?.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-2 text-sm font-semibold text-slate-900">Evidence clips ({evidenceClips.length})</p>
          <p className="mb-3 text-xs text-slate-500">
            Short clips captured only when a high-severity flag fired — consent-gated, never continuous recording. For
            human review only; they never enter any scoring path.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {evidenceClips.map((clip) => (
              <EvidenceClip key={clip._id} clip={clip} />
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
        Integrity flags are advisory signals for your review — not proof of misconduct, and never on their own a reason to reject.
      </p>
    </Card>
  );
}

// `delivery` is deliberately not a prop any more. Every spoken answer used to carry
// "Delivery: 64/100" right next to its answer score, which put a number on how the candidate
// SOUNDED — pace, hesitation, filler words — beside a number on what they said, in the same
// type, on the same line. See backend/utils/prosody.js for why that had to go.
function Bubble({ role, text, score, spoken, wordCount, durationSec, responsive }) {
  const isAi = role === "ai";
  return (
    <div className={`flex gap-2.5 ${isAi ? "" : "flex-row-reverse"}`}>
      <div
        className={
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
          (isAi ? "bg-brand-100 text-brand-700" : "bg-slate-200 text-slate-600")
        }
      >
        {isAi ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isAi ? "bg-slate-50 text-slate-700" : "bg-brand-600 text-white"}`}>
        <p>{text}</p>
        {/* The readout below sits on the violet bubble at white/90, not brand-100:
            on this ramp brand-100 over brand-600 lands at 4.49:1, and this is an
            11px score figure — the smallest number in the report and the one most
            likely to be quoted back in a dispute. */}
        {!isAi && score != null && (
          <p className="mt-1 text-[11px] font-semibold text-white/90">Answer score: {score}/100</p>
        )}
        {!isAi && wordCount != null && (
          <p className="mt-0.5 text-[11px] text-white/90">
            {wordCount} word{wordCount === 1 ? "" : "s"} · {durationSec != null ? `${durationSec}s` : "duration unknown"} ·{" "}
            <span className={responsive ? "" : "font-semibold text-amber-200"}>{responsive ? "Responsive" : "Non-responsive"}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Section 2's wrapper.
 *
 * Collapsed by default, and that default is the whole change: a recruiter who
 * needs the answer gets it in one screen, and a recruiter who needs to defend
 * the answer is one click from every criterion, quote and turn that produced it.
 * Nothing was removed to make the summary — this is the same eight cards.
 *
 * A real <button> with `aria-expanded` and `aria-controls`, not a styled div and
 * not a bare <details>: the label has to change with the state ("See" → "Hide"),
 * and the region has to be nameable from the control that toggles it.
 *
 * The content is UNMOUNTED while closed rather than hidden, which is deliberate —
 * the transcript can run to hundreds of turns and the evidence clips are video
 * elements. Hiding them with CSS would still pay for them on every report open.
 */
function DetailDisclosure({ open, onToggle, children }) {
  return (
    <section aria-labelledby="detail-toggle">
      <button
        type="button"
        id="detail-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="detail-region"
        className="tap-target flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left shadow-card transition-colors duration-150 hover:border-brand-200 hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-slate-900">
            {open ? "Hide the detailed report" : "See the detailed report"}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Every requirement, both quotes on each probed claim, the assessment, integrity flags and the full transcript — the
            same content as the PDF.
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id="detail-region" className="mt-6 space-y-6">
          {children}
        </div>
      )}
    </section>
  );
}

// The full evaluation — every number with the sentence that qualifies it.
// Extracted from the page body when the report split into summary + detail;
// the markup is unchanged, it simply lives behind the disclosure now.
function EvaluationCard({ interview, ev, rec }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900">Evaluation</h3>
        {rec && <Badge tone={rec.tone}>Recommendation: {rec.label}</Badge>}
      </div>

      {ev ? (
        <>
          {interview.substance && (
            <p className="mt-3 text-sm font-medium text-slate-500">
              Responsive answers: {interview.substance.responsiveCount} / {interview.substance.totalAnswers}
            </p>
          )}

          {ev.generatedBy === "fallback" && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              Deterministic fallback — every score below is a PLACEHOLDER from answer-completeness heuristics, not a real evaluation.
            </p>
          )}

          {/* What the score is a score OF.
              An overall of 72 over eight answered questions and an overall of 72 over two
              answered and six declined are entirely different findings, and the number
              alone cannot tell them apart. The count travels with the score so a reviewer
              cannot read one without the other — and `reviewReason` states, in code's
              words rather than the model's, why an automated recommendation was withheld
              (the candidate ended the interview early, or declined most of it). */}
          {ev.reviewReason && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              Recommendation withheld — {ev.reviewReason}. This interview needs human review before any decision.
            </p>
          )}

          {/* The interviewer went off-script and we stopped the interview. Shown above
              everything else and in the strongest available tone, because the single most
              likely misreading of a short transcript is "this candidate gave up" — and the
              truth is the opposite. The offending sentence is quoted verbatim: a reviewer
              deciding what to do about this needs to see what was actually said, not a
              rule name. */}
          {interview.haltedBy && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-bold text-red-800">
                Interview stopped automatically — our fault, not the candidate&apos;s
              </p>
              <p className="mt-1 text-xs text-red-700">
                The AI interviewer {interview.haltedBy.label || "went outside its approved script"}, so this
                interview was ended after {interview.haltedBy.questionsAsked ?? 0} question
                {interview.haltedBy.questionsAsked === 1 ? "" : "s"}. Nothing here is a measurement of this
                candidate, and this must not count against them. Please contact them directly about next steps.
              </p>
              {interview.haltedBy.utterance && (
                <p className="mt-1.5 rounded bg-white/60 px-2 py-1 text-xs italic text-red-900">
                  “{interview.haltedBy.utterance}”
                </p>
              )}
            </div>
          )}

          {/* Off-script speech that did not warrant stopping the interview — an invented
              question, or feedback given to the candidate's face. Not a halt, but a real
              finding: an unapproved question means this candidate did not sit quite the same
              instrument as everyone else. */}
          {interview.guardrailHits?.length > 0 && !interview.haltedBy && (
            <details className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-amber-800">
                {interview.guardrailHits.length} interviewer utterance
                {interview.guardrailHits.length === 1 ? "" : "s"} flagged as off-script
              </summary>
              <ul className="mt-2 space-y-1.5">
                {interview.guardrailHits.map((h, i) => (
                  <li key={i} className="text-xs text-amber-900">
                    <span className="font-semibold">{h.label || h.ruleId}</span>
                    {h.utterance && <span className="italic"> — “{h.utterance}”</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {typeof ev.questionsDeclined === "number" && ev.questionsDeclined > 0 && (
            <p className="mt-2 text-sm font-medium text-slate-500">
              Declined: {ev.questionsDeclined} of {ev.questionsAsked} question
              {ev.questionsAsked === 1 ? "" : "s"} — the candidate was asked and said they could not answer.
              Scores below cover only the {ev.questionsAnswered} answered.
            </p>
          )}

          <div className="mt-4 flex items-center gap-4">
            <div className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl text-white ${ev.generatedBy === "fallback" ? "bg-slate-400" : "bg-slate-900"}`}>
              <span className="text-2xl font-bold">{ev.overallScore ?? "—"}</span>
              <span className="text-[10px] text-slate-300">{ev.generatedBy === "fallback" ? "Placeholder" : "Overall"}</span>
            </div>
            {interview.competencyTriplet ? (
              <div className="grid flex-1 gap-3 sm:grid-cols-3">
                <ScoreBar label="Communication" value={interview.competencyTriplet.communication} />
                <ScoreBar label="Technical" value={interview.competencyTriplet.technicalKnowledge} />
                <ScoreBar label="Problem Solving" value={interview.competencyTriplet.problemSolving} />
              </div>
            ) : (
              <p className="flex-1 text-sm text-slate-500">
                Communication / Technical / Problem solving:{" "}
                {ev.generatedBy === "fallback" ? "PLACEHOLDER — not a real evaluation." : "not separately measured for this interview."}
              </p>
            )}
          </div>

          {ev.summary && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{ev.summary}</p>}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {ev.strengths?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-600">Strengths</p>
                <ul className="space-y-1">
                  {ev.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-sm text-slate-600">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {ev.weaknesses?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-600">Weaknesses</p>
                <ul className="space-y-1">
                  {ev.weaknesses.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-sm text-slate-600">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {ev.missingSkills?.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-600">Skills to probe</p>
              <div className="flex flex-wrap gap-1.5">
                {ev.missingSkills.map((s) => (
                  <Badge key={s} tone="red">{s}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Spoken communication. Present only when this role's approved rubric declared
              that it is assessed AND a human wrote down why — the justification is shown
              here, next to the number, because a score whose job-relatedness lives on
              another screen is a score nobody checks the basis of.

              These bars existed before and were removed: they were computed from pace,
              filler rate and hesitation, which are accent, nervousness and speech-difference
              proxies. The names came back; the inputs did not. Both are now derived from the
              transcript alone (backend/utils/communication.js). */}
          {(ev.delivery != null || ev.confidence != null) && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-medium text-slate-600">
                Spoken communication — assessed for this role
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ScoreBar label="Clarity" value={ev.delivery} />
                <ScoreBar label="Calibration" value={ev.confidence} />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Measured from the transcript only — never from pace, accent, hesitation or
                filler words. <strong>Clarity</strong>: did the answer address the question,
                concretely and followably. <strong>Calibration</strong>: did they distinguish
                what they knew from what they didn't — saying so counts in their favour.
                {ev.spokenCommunication?.answersScored != null && (
                  <> Over {ev.spokenCommunication.answersScored} answer
                    {ev.spokenCommunication.answersScored === 1 ? "" : "s"}.</>
                )}
              </p>
              {ev.spokenCommunication?.justification && (
                <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                  <span className="font-medium">Why this role assesses it: </span>
                  {ev.spokenCommunication.justification}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Not part of the overall score. It cannot decline a candidate on its own.
              </p>
            </div>
          )}

          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Generated by {ev.generatedBy === "fallback" ? "deterministic fallback (AI provider not configured)" : "AI"}
            {ev.generatedAt ? ` · ${formatWhen(ev.generatedAt)}` : ""}
            {interview.startedAt ? ` · interview ${formatWhen(interview.startedAt)}` : ""}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Evaluation not available yet.</p>
      )}
    </Card>
  );
}

export default function InterviewReport() {
  const { id } = useParams();
  const toast = useToast();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [movingTo, setMovingTo] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/candidates/${id}/interview-report`);
      setReport(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not load the interview report.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Live-refresh if the candidate's stage changes elsewhere.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    function onStage(payload) {
      if (payload?.candidateId === id) load();
    }
    socket.on("candidate:stage", onStage);
    return () => socket.off("candidate:stage", onStage);
  }, [id, load]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const res = await api.get(`/candidates/${id}/interview-report/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const slug = (report?.candidate?.name || "candidate").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "candidate";
      const a = document.createElement("a");
      a.href = url;
      a.download = `interview-report-${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not generate the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function moveStage(stage) {
    setMovingTo(stage);
    try {
      await api.patch(`/candidates/${id}/stage`, { stage, note: note || undefined });
      toast.success(`Moved to ${stageLabel(stage)}`);
      setNote("");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not move candidate");
    } finally {
      setMovingTo("");
    }
  }

  if (!report) {
    return (
      <div className="space-y-4">
        {error ? (
          <Card className="text-center text-sm font-medium text-red-600">{error}</Card>
        ) : (
          <>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-48 w-full" />
          </>
        )}
      </div>
    );
  }

  const { candidate, job, interview, allowedNextStages = [], stage, decisionTrail, coverage } = report;
  const ev = interview?.evaluation;
  const rec = ev?.recommendation ? RECOMMENDATION[ev.recommendation] : null;
  const quality = interview?.sessionQuality;
  // One source of criterion labels for every card on the page, so nothing renders
  // a bare "c5" at the recruiter.
  const criterionLabels = Object.fromEntries((coverage?.rows || []).map((r) => [r.criterionId, r.label]));

  return (
    <div className="space-y-6">
      <Link to={`/candidates/${id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to candidate
      </Link>

      {/* Ordered by what a recruiter must not miss: a broken session invalidates
          everything below it, so it sits above the verdict. */}
      <SessionQualityBanner quality={quality} />
      <VerdictBanner verdict={interview?.verdict} />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">
              <Cpu className="h-5 w-5 text-brand-600" /> AI Interview Report
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {candidate?.name} · <span className="font-medium text-slate-700">{job?.title}</span>
            </p>
            {decisionTrail && (
              <p className="mt-1 text-xs text-slate-500">
                Moved to &ldquo;{decisionTrail.stageLabel}&rdquo; by {decisionTrail.by || "system"} · {formatWhen(decisionTrail.at)}
                {decisionTrail.note ? ` — ${decisionTrail.note}` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stageTone(stage)}>{stageLabel(stage)}</Badge>
            {interview?.engine === "fallback" && (
              <Badge tone="amber">
                <AlertTriangle className="mr-1 h-3 w-3" /> Fallback engine — placeholder scores
              </Badge>
            )}
            {interview?.status && <Badge tone={interview.status === "completed" ? "green" : "slate"}>{interview.status}</Badge>}
            {interview?.modality === "voice" && (
              <Badge tone="brand">
                <Mic className="mr-1 h-3 w-3" /> Voice
              </Badge>
            )}
            {report.hasInterview && (
              <Button variant="outline" size="sm" loading={downloading} onClick={downloadPdf}>
                <Download className="h-3.5 w-3.5" /> Download PDF
              </Button>
            )}
          </div>
        </div>

        {/* §4: identity + duration flags surfaced immediately, not buried in Integrity */}
        {report.hasInterview && (
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
            <IdentityRow identityMatch={report.proctoring?.identityMatch} />
            {interview?.durationFlag?.abnormallyShort && (
              <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Abnormally short session — averaging {interview.durationFlag.secondsPerQuestion}s/question
              </div>
            )}
          </div>
        )}
      </Card>

      {!report.hasInterview ? (
        <>
          {/* Spans all three evidence legs, so it renders with or without an
              interview — a report with no interview still shows what was tested,
              and with no summary to open with it stays expanded. */}
          <CoverageMatrix coverage={coverage} />
          <AssessmentCard assessment={report.assessment} criterionLabels={criterionLabels} />
          <Card>
            <EmptyState
              icon={Bot}
              title="No AI interview yet"
              description="This candidate hasn't completed the AI interview. The report appears here once the interview is finished."
            />
          </Card>
        </>
      ) : (
        <>
          {/* ---- Section 1: how it went ------------------------------------ */}
          <PerformanceSummary
            report={report}
            interview={interview}
            ev={ev}
            coverage={coverage}
            quality={quality}
            onDownloadPdf={downloadPdf}
            downloading={downloading}
          />

          <RecommendedActionCard action={interview.recommendedAction} />

          {/* The decision stays OUT of the disclosure. Everything below it is
              reading; this is the act. Burying the control that moves a person
              through the pipeline behind an expander is how a report becomes
              something recruiters skim and then decide from memory. */}
          {allowedNextStages.length > 0 && (
            <Card>
              <h3 className="mb-3 text-base font-semibold text-slate-900">Decision</h3>
              <FormGroup className="mb-3">
                <Label>Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / internal note recorded on the timeline" />
              </FormGroup>
              <div className="flex flex-wrap gap-2">
                {allowedNextStages.map((s) => (
                  <Button
                    key={s.stage}
                    variant={s.stage === "rejected" ? "outline" : "primary"}
                    size="sm"
                    loading={movingTo === s.stage}
                    onClick={() => moveStage(s.stage)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </Card>
          )}

          {/* ---- Section 2: the evidence behind it ------------------------- */}
          <DetailDisclosure open={showDetail} onToggle={() => setShowDetail((v) => !v)}>
            <CoverageMatrix coverage={coverage} />

            <EvaluationCard interview={interview} ev={ev} rec={rec} />

            <ClaimVerificationCard cv={report.claimVerification} />

            <AssessmentCard assessment={report.assessment} criterionLabels={criterionLabels} />

            <CompetencyTable rows={interview.competencyTable} />

            {/* Integrity / proctoring */}
            {report.proctoring && <IntegrityCard proctoring={report.proctoring} evidenceClips={report.evidenceClips} />}

            {/* Transcript */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Transcript</h3>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {interview.substance && (
                    <span>Responsive: {interview.substance.responsiveCount}/{interview.substance.totalAnswers}</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {interview.questionCount}/{interview.maxQuestions} questions
                  </span>
                </div>
              </div>
              <div className="space-y-4">
                {(interview.transcript || []).map((t, i) => (
                  <Bubble
                    key={i}
                    role={t.role}
                    text={t.text}
                    score={t.answerScore}
                    spoken={t.inputMode === "voice"}
                    wordCount={t.wordCount}
                    durationSec={t.durationSec}
                    responsive={t.responsive}
                  />
                ))}
                {(!interview.transcript || interview.transcript.length === 0) && (
                  <p className="text-sm text-slate-500">No transcript recorded.</p>
                )}
              </div>

              {/* THE AUDIT RECORD, not the assessment — and the distinction is the point, so it
                  is stated on screen rather than implied by placement. The transcript above is
                  the scored evidence: answers matched to questions, as the engine segmented
                  them. This is the raw conversation, both sides, everything else included.

                  It is here because the most dangerous way to misread a short transcript is as a
                  candidate with nothing to say. When the real story is two minutes of "sorry, can
                  you hear me?", only this shows it. Collapsed by default so it cannot compete
                  with the evidence, and explicitly marked unscored so nobody reaches for it as a
                  tiebreaker — how often someone asks for a repeat measures their connection, not
                  their ability. */}
              {interview.conversationLog?.length > 0 && (
                <details className="mt-6 border-t border-slate-200 pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                    Full conversation log ({interview.conversationLog.length} utterances)
                  </summary>
                  <p className="mt-1.5 text-xs text-slate-500">
                    Everything said in the room, in order, exactly as recorded — including the parts
                    that were not answers. <span className="font-semibold">Not scored, and never
                    used in scoring.</span> It is here so an interview that went wrong can be told
                    apart from a candidate who did badly.
                    {interview.agentPromptVersion && (
                      <> Interviewer instructions: <code>{interview.agentPromptVersion}</code>.</>
                    )}
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {interview.conversationLog.map((u, i) => (
                      <li key={i} className="flex gap-2 text-xs">
                        <span
                          className={`w-20 shrink-0 font-semibold ${
                            u.role === "candidate" ? "text-slate-900" : "text-slate-500"
                          }`}
                        >
                          {u.role === "candidate" ? "Candidate" : "Interviewer"}
                        </span>
                        <span className="text-slate-700">{u.text}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          </DetailDisclosure>
        </>
      )}
    </div>
  );
}
