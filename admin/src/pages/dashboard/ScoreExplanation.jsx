import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, ShieldAlert, Scale, Quote, AlertTriangle } from "lucide-react";
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

  return (
    <div className="space-y-6">
      <Link to={`/candidates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Back to candidate
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Why this score</h1>
            <p className="mt-1 text-sm text-slate-500">
              {data.candidateName} — scored against rubric v{data.rubricVersion}, {data.mode === "shadow" ? "shadow run (did not drive the decision)" : "live"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-3xl font-bold text-slate-900">{data.overallScore}</p>
              <p className="text-xs text-slate-400">
                advance ≥ {data.thresholds?.advance ?? "—"} · review ≥ {data.thresholds?.review ?? "—"}
              </p>
            </div>
            <Badge tone={band.tone}>{band.label}</Badge>
          </div>
        </div>
        {data.reviewReason && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Routing reason: <span className="font-mono">{data.reviewReason}</span>
          </p>
        )}
        {/* Phase 8: the pre→post interview delta — the score changed because the
            interview proved (or disproved) claims the résumé alone couldn't. */}
        {data.stages?.post && data.stages?.pre && (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              data.stages.delta > 0 ? "bg-emerald-50 text-emerald-800" : data.stages.delta < 0 ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-600"
            }`}
          >
            <span className="font-semibold">
              Interview verdicts moved this score {data.stages.pre.overallScore} → {data.stages.post.overallScore} (
              {data.stages.delta > 0 ? "+" : ""}
              {data.stages.delta})
            </span>{" "}
            — claims proven in the interview count fully; contradicted claims count zero.
            {data.stage === "pre_interview" && " You are viewing the pre-interview assessment."}
            {data.stage === "post_interview" && " You are viewing the post-interview assessment."}
          </div>
        )}
        {/* Phase 10: calibration — the score as an observed probability at THIS
            company, shown only when the sample honestly supports it. */}
        {data.calibration && (
          <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
            Candidates scoring {data.calibration.band.lo}–{data.calibration.band.hi} here advanced past screening{" "}
            <span className="font-semibold">{Math.round(data.calibration.probability * 100)}%</span> of the time (n=
            {data.calibration.n}, 95% CI {Math.round(data.calibration.ciLow * 100)}–{Math.round(data.calibration.ciHigh * 100)}%,{" "}
            {data.calibration.sampleSize} decided outcomes). Display-only — it never feeds the score.
          </p>
        )}
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
          Every point below is computed by deterministic code from cited evidence — the model never emits the score.
          Reproducibility hash <span className="font-mono">{String(data.reproducibilityHash).slice(0, 16)}…</span> · scorer{" "}
          {data.scorerVersion} · prompts {data.promptVersions?.join(", ")}
        </p>
      </Card>

      <Card>
        <h2 className="mb-4 text-base font-semibold text-slate-900">Criterion breakdown</h2>
        <div className="space-y-4">
          {scoreable.map((f) => {
            const meta = STATUS_META[f.status] || STATUS_META.absent;
            return (
              <div key={f.criterionId} className="rounded-xl border border-slate-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="font-medium text-slate-800">{f.label}</span>
                    {f.kind === "nice_to_have" && <span className="text-xs text-slate-400">(nice-to-have)</span>}
                  </div>
                  <div className="text-right text-sm">
                    <span className="font-bold text-slate-900">{Number(f.points).toFixed(1)} pts</span>
                    <span className="ml-2 text-xs text-slate-400">weight {(f.weight * 100).toFixed(0)}%</span>
                  </div>
                </div>
                {f.reasoning && <p className="mt-2 text-sm text-slate-600">{f.reasoning}</p>}
                {f.evidence?.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {f.evidence.map((e) => (
                      <div key={e.claimId} className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-start gap-2">
                          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div>
                            <p className="font-mono text-xs text-slate-700">“{e.quote}”</p>
                            <p className="mt-1 text-[11px] text-slate-400">
                              {e.statement} · {e.specificity} · {VERIFICATION_LABEL[e.verificationStatus] || e.verificationStatus}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {f.evidence?.length === 0 && f.status === "absent" && (
                  <p className="mt-2 text-xs text-slate-400">No claim in the résumé addresses this criterion.</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {disqualifiers.length > 0 && (
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
            <ShieldAlert className="h-4 w-4 text-red-500" /> Knock-out gates
          </h2>
          <div className="space-y-2">
            {disqualifiers.map((f) => (
              <div key={f.criterionId} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <span className="text-slate-700">{f.label}</span>
                <Badge tone={f.status === "satisfied" ? "red" : f.status === "partial" ? "amber" : "green"}>
                  {f.status === "satisfied" ? "Triggered" : f.status === "partial" ? "Ambiguous — human review" : "Clear"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(data.internalContradictions?.length > 0 || data.unverifiedHighWeightClaims?.length > 0) && (
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Open questions for the interview
          </h2>
          {data.internalContradictions?.length > 0 && (
            <div className="mb-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Internal inconsistencies (never scored — probe targets)</p>
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
                {data.internalContradictions.map((c, i) => (
                  <li key={i}>{c.description}</li>
                ))}
              </ul>
            </div>
          )}
          {data.unverifiedHighWeightClaims?.length > 0 && (
            <p className="text-sm text-slate-600">
              {data.unverifiedHighWeightClaims.length} high-weight claim(s) are self-reported and unquantified — the AI
              interview will be targeted at testing exactly these.
            </p>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-green-600" /> Quality gate
        </h2>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-400">Gate outcome</p>
            <p className="mt-1 font-medium text-slate-800">{data.qa?.outcome || "—"} ({data.qa?.mode})</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-400">Model agreement</p>
            <p className="mt-1 font-medium text-slate-800">
              {data.qa?.agreement != null ? `${Math.round(data.qa.agreement * 100)}%` : "not boundary-tested"}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-400">Bias counterfactual</p>
            <p className="mt-1 font-medium text-slate-800">
              {data.qa?.counterfactual?.ran
                ? data.qa.counterfactual.identical
                  ? "zero delta (identical input)"
                  : "LEAK DETECTED — under review"
                : "sampled out"}
            </p>
          </div>
        </div>
        {data.qa?.reasons?.length > 0 && (
          <p className="mt-3 text-xs text-slate-400">Gate notes: {data.qa.reasons.join(" · ")}</p>
        )}
      </Card>
    </div>
  );
}
