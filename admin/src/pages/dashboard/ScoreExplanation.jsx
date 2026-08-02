/* Hallmark · genre: modern-minimal · macrostructure: Long Document (app-scope adaptation)
 * theme: HireFlow AI (DESIGN.md, locked) · accent: verification blue (inherited ramp)
 * enrichment: none — typography only · nav/footer: n/a (renders inside the dashboard shell)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 *
 * Structure note: the score is deliberately NOT a headline figure. The masthead
 * carries the DECISION; the number appears once, at the foot of the ledger, as
 * the sum of its line items. evidenceScorer.js rounds each criterion's points
 * before accumulating precisely so that decomposition sums to the stored total
 * exactly — this screen makes that invariant visible instead of hiding it.
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, ShieldAlert, Scale, AlertTriangle, Check, Copy } from "lucide-react";
import api from "../../api/client.js";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";

// "Why this score" (BUILD-PLAN Phase 6.6) — the evidence assessment as a
// first-class screen: every criterion, its verdict, its weight, its exact
// contribution in points, and the quoted résumé line behind it. Every number
// on this page was computed by deterministic code over cited evidence.

const STATUS_META = {
  satisfied: { tone: "green", label: "Satisfied" },
  partial: { tone: "amber", label: "Partially met" },
  absent: { tone: "slate", label: "No evidence" },
  contradicted: { tone: "red", label: "Contradicted" },
};

const BAND_META = {
  advance: { tone: "green", label: "Advance" },
  review: { tone: "amber", label: "Human review" },
  decline: { tone: "red", label: "Decline" },
};

const VERIFICATION_LABEL = {
  unverified: "self-reported",
  corroborated_internally: "internally corroborated",
  contradicted_internally: "internally contradicted",
  verified_in_interview: "verified in interview",
  contradicted_in_interview: "contradicted in interview",
};

// The ledger's two numeric columns keep fixed widths so every row aligns down
// the page — the column is meant to be added up by eye.
const COL_WEIGHT = "w-20 shrink-0 text-right";
const COL_EARNED = "w-32 shrink-0 text-right";

function CopyHash({ value }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard denied (insecure origin, permission). Leave the label alone —
      // the hash is selectable on screen either way.
    }
  }

  // Label swap is the feedback; no toast. Width is reserved so the row doesn't
  // reflow when the label changes.
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="w-12 text-left">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** One line item. The evidence sits under the claim it paid for, not in a nested card. */
function LedgerRow({ finding }) {
  const meta = STATUS_META[finding.status] || STATUS_META.absent;
  const earned = Number(finding.points) || 0;
  const available = (Number(finding.weight) || 0) * 100;

  return (
    <li className="border-b border-slate-100 py-5 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="font-medium text-slate-800">{finding.label}</span>
          {finding.kind === "nice_to_have" && <span className="text-xs text-slate-400">nice-to-have</span>}
        </div>
        <div className="flex items-baseline tabular-nums">
          <span className={`${COL_WEIGHT} text-sm text-slate-500`}>{available.toFixed(0)}%</span>
          <span className={COL_EARNED}>
            <span className="text-base font-semibold text-slate-900">{earned.toFixed(1)}</span>
            <span className="text-sm text-slate-400"> / {available.toFixed(1)}</span>
          </span>
        </div>
      </div>

      {finding.reasoning && <p className="mt-2.5 max-w-3xl text-sm text-slate-600">{finding.reasoning}</p>}

      {finding.evidence?.length > 0 && (
        <div className="mt-3 space-y-3 border-l border-slate-200 pl-4">
          {finding.evidence.map((e) => (
            <figure key={e.claimId} className="max-w-3xl">
              <blockquote className="text-sm leading-relaxed text-slate-700">“{e.quote}”</blockquote>
              <figcaption className="mt-1 text-xs text-slate-400">
                {e.statement} · {e.specificity} · {VERIFICATION_LABEL[e.verificationStatus] || e.verificationStatus}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {finding.evidence?.length === 0 && finding.status === "absent" && (
        <p className="mt-2.5 text-sm text-slate-400">No claim in the résumé addresses this criterion.</p>
      )}
    </li>
  );
}

export default function ScoreExplanation() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .get(`/candidates/${id}/assessment`)
      .then((res) => alive && setData(res.data))
      .catch((err) => alive && setError(err.response?.data?.error || "Could not load the assessment"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link to={`/candidates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to candidate
        </Link>
        <Card>
          <EmptyState
            icon={Scale}
            title="No evidence assessment yet"
            description={error || "This candidate has not been scored by the evidence engine (it may be running in legacy mode, or no rubric is approved for the job)."}
          />
        </Card>
      </div>
    );
  }

  const band = BAND_META[data.band] || BAND_META.review;
  const scoreable = data.criterionFindings.filter((f) => f.kind !== "disqualifier");
  const disqualifiers = data.criterionFindings.filter((f) => f.kind === "disqualifier");

  // The ledger foots to the same value the engine stored. Points are rounded
  // per-criterion before accumulation upstream, so this sum is exact — and the
  // recorded score is that sum rounded to a whole number.
  const totalEarned = scoreable.reduce((sum, f) => sum + (Number(f.points) || 0), 0);
  const totalAvailable = scoreable.reduce((sum, f) => sum + (Number(f.weight) || 0) * 100, 0);

  const hasMovement = Boolean((data.stages?.post && data.stages?.pre) || data.calibration);

  return (
    <div className="space-y-6">
      <Link to={`/candidates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Back to candidate
      </Link>

      {/* Masthead — the decision, not the number. The figure is derived below. */}
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Why this score</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data.candidateName} — scored against rubric v{data.rubricVersion},{" "}
            {data.mode === "shadow" ? "shadow run (did not drive the decision)" : "live"}
          </p>
        </div>
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <Badge tone={band.tone}>{band.label}</Badge>
          <p className="text-xs tabular-nums text-slate-400">
            advance ≥ {data.thresholds?.advance ?? "—"} · review ≥ {data.thresholds?.review ?? "—"}
          </p>
        </div>
      </header>

      {data.reviewReason && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Routed to a human — <span className="font-semibold">{data.reviewReason.replace(/_/g, " ")}</span>. No adverse
          action is taken automatically.
        </p>
      )}

      {/* The ledger. Each criterion is a line item; the column sums to the total. */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-base font-semibold text-slate-900">Criterion ledger</h2>
          <p className="text-xs text-slate-400">Earned points = evidence quality × criterion weight</p>
        </div>

        <div className="mt-5 flex items-baseline justify-between gap-x-6 border-b border-slate-200 pb-2 text-xs font-semibold text-slate-500">
          <span>Criterion and the evidence behind it</span>
          <span className="flex items-baseline">
            <span className={COL_WEIGHT}>Weight</span>
            <span className={COL_EARNED}>Earned / available</span>
          </span>
        </div>

        <ul className="mt-5">
          {scoreable.map((f) => (
            <LedgerRow key={f.criterionId} finding={f} />
          ))}
        </ul>

        {/* Double rule — the accountant's total. */}
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t-4 border-double border-slate-300 pt-4">
          <span className="font-semibold text-slate-900">Total</span>
          <span className="flex items-baseline tabular-nums">
            <span className={`${COL_WEIGHT} text-sm text-slate-500`}>{totalAvailable.toFixed(0)}%</span>
            <span className={COL_EARNED}>
              <span className="text-xl font-bold text-slate-900">{totalEarned.toFixed(1)}</span>
              <span className="text-sm text-slate-400"> / {totalAvailable.toFixed(1)}</span>
            </span>
          </span>
        </div>

        <p className="mt-3 text-sm text-slate-500">
          Recorded score <span className="font-semibold tabular-nums text-slate-900">{data.overallScore}</span> — the
          total above, rounded to a whole number. Add the column yourself; it reconciles by construction.
        </p>
      </Card>

      {hasMovement && (
        <Card>
          <h2 className="text-base font-semibold text-slate-900">What moved this total</h2>

          {data.stages?.post && data.stages?.pre && (
            <div className="mt-4">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-slate-700">
                <span className="tabular-nums">
                  Interview verdicts moved the score{" "}
                  <span className="font-semibold">{data.stages.pre.overallScore}</span> →{" "}
                  <span className="font-semibold">{data.stages.post.overallScore}</span>
                </span>
                <Badge tone={data.stages.delta > 0 ? "green" : data.stages.delta < 0 ? "red" : "slate"}>
                  {data.stages.delta > 0 ? "+" : ""}
                  {data.stages.delta}
                </Badge>
              </p>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">
                Claims proven in the interview count fully; claims the interview contradicted count zero.
                {data.stage === "pre_interview" && " You are viewing the pre-interview assessment."}
                {data.stage === "post_interview" && " You are viewing the post-interview assessment."}
              </p>
            </div>
          )}

          {data.calibration && (
            <div className={data.stages?.post && data.stages?.pre ? "mt-5 border-t border-slate-100 pt-5" : "mt-4"}>
              <p className="max-w-3xl text-sm text-slate-700">
                Candidates scoring{" "}
                <span className="tabular-nums">
                  {data.calibration.band.lo}–{data.calibration.band.hi}
                </span>{" "}
                at this company advanced past screening{" "}
                <span className="font-semibold tabular-nums">{Math.round(data.calibration.probability * 100)}%</span> of
                the time.
              </p>
              <p className="mt-1.5 text-xs tabular-nums text-slate-400">
                n={data.calibration.n} · 95% CI {Math.round(data.calibration.ciLow * 100)}–
                {Math.round(data.calibration.ciHigh * 100)}% · {data.calibration.sampleSize} decided outcomes ·
                display-only, never feeds the score
              </p>
            </div>
          )}
        </Card>
      )}

      {disqualifiers.length > 0 && (
        <Card>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ShieldAlert className="h-4 w-4 text-red-500" /> Knock-out gates
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Pass/fail conditions. They carry no weight and add no points — a triggered gate bypasses the ledger entirely.
          </p>
          <ul className="mt-4">
            {disqualifiers.map((f) => (
              <li
                key={f.criterionId}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-100 py-3 text-sm first:pt-0 last:border-b-0 last:pb-0"
              >
                <span className="text-slate-700">{f.label}</span>
                <Badge tone={f.status === "satisfied" ? "red" : f.status === "partial" ? "amber" : "green"}>
                  {f.status === "satisfied" ? "Triggered" : f.status === "partial" ? "Ambiguous — human review" : "Clear"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(data.internalContradictions?.length > 0 || data.unverifiedHighWeightClaims?.length > 0) && (
        <Card>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Open questions for the interview
          </h2>

          {data.internalContradictions?.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700">Internal inconsistencies</p>
              <p className="mt-0.5 text-xs text-slate-400">Never scored — they become probe targets.</p>
              <ul className="mt-2.5 space-y-2 border-l border-slate-200 pl-4">
                {data.internalContradictions.map((c, i) => (
                  <li key={i} className="max-w-3xl text-sm text-slate-600">
                    {c.description}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.unverifiedHighWeightClaims?.length > 0 && (
            <p
              className={`max-w-3xl text-sm text-slate-600 ${
                data.internalContradictions?.length > 0 ? "mt-5 border-t border-slate-100 pt-5" : "mt-4"
              }`}
            >
              <span className="font-semibold tabular-nums text-slate-800">
                {data.unverifiedHighWeightClaims.length}
              </span>{" "}
              high-weight claim{data.unverifiedHighWeightClaims.length === 1 ? " is" : "s are"} self-reported and
              unquantified. The AI interview is targeted at testing exactly these.
            </p>
          )}
        </Card>
      )}

      {/* Colophon — how this record was produced. Deliberately uncarded: it closes
          the document rather than adding another object to it. */}
      <footer className="border-t border-slate-200 pt-6">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-emerald-600" /> How this record was produced
        </h2>

        <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold text-slate-500">Quality gate</dt>
            <dd className="mt-1 text-slate-800">
              {data.qa?.outcome || "—"}
              {data.qa?.mode && <span className="text-slate-400"> ({data.qa.mode})</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">Model agreement</dt>
            <dd className="mt-1 tabular-nums text-slate-800">
              {data.qa?.agreement != null ? `${Math.round(data.qa.agreement * 100)}%` : "not boundary-tested"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">Bias counterfactual</dt>
            <dd className="mt-1 text-slate-800">
              {data.qa?.counterfactual?.ran
                ? data.qa.counterfactual.identical
                  ? "zero delta (identical input)"
                  : "leak detected — under review"
                : "sampled out"}
            </dd>
          </div>
        </dl>

        {data.qa?.reasons?.length > 0 && (
          <p className="mt-4 text-sm text-slate-500">Gate notes: {data.qa.reasons.join(" · ")}</p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            Reproducibility hash
            <span className="tabular-nums tracking-tight text-slate-600">
              {String(data.reproducibilityHash).slice(0, 16)}…
            </span>
            <CopyHash value={String(data.reproducibilityHash)} />
          </span>
          <span>Scorer {data.scorerVersion}</span>
          {data.promptVersions?.length > 0 && <span>Prompts {data.promptVersions.join(", ")}</span>}
        </div>

        <p className="mt-4 max-w-3xl text-xs text-slate-400">
          Every point above was computed by deterministic code from cited evidence. The model extracts and reasons over
          the text; it never emits the score.
        </p>
      </footer>
    </div>
  );
}
