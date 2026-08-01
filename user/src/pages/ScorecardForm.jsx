import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Target,
  Info,
  ClipboardCheck,
} from "lucide-react";
import api from "../api/client.js";
import { authHeader, getAuth, clearAuth } from "../portal/scorecardAuth.js";
import { Card, Badge } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

// The interviewer's form. Three rules are enforced in the UI because they are
// what makes the record worth keeping — and all three are re-enforced server-side
// in scorecardEngine, so a hand-rolled request cannot get around them:
//
//   1. EVIDENCE GATES THE RATING. The 1–5 buttons stay inert until there is an
//      observation to attach them to. A number with nothing behind it is an
//      opinion; a number with a quote behind it is a record.
//   2. "NOT ASSESSED" IS THE DEFAULT. Every row starts there. An interviewer who
//      ran out of time says so in one tap, and the honest answer stays the
//      cheapest one to give.
//   3. NOTHING ABOUT THE AI'S OPINION IS ON THIS SCREEN. The engine's score is
//      not in the payload at all (see scorecardService.panelistPayload) — it is
//      revealed only after submit, so what gets recorded is what this person
//      actually thought.

const VERDICT_OPTIONS = [
  { value: "verified", label: "Verified", tone: "green", help: "They evidenced it" },
  { value: "contradicted", label: "Contradicted", tone: "red", help: "It did not hold up" },
  { value: "inconclusive", label: "Didn't get to it", tone: "slate", help: "No conclusion" },
];

const DECISION_COPY = {
  advance: { label: "Advance", help: "Move to the next round" },
  hold: { label: "Hold", help: "Undecided — needs another look" },
  decline: { label: "Decline", help: "Do not proceed" },
};

function draftKey(stage) {
  return `scorecardDraft:${stage || "round"}`;
}

export default function ScorecardForm() {
  const navigate = useNavigate();
  const auth = getAuth();

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [rows, setRows] = useState({});
  const [decision, setDecision] = useState("");
  const [decisionReason, setDecisionReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);

  // --- load ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.get("/scorecard-portal/me", { headers: authHeader() });
        if (cancelled) return;
        setPayload(res.data);

        // Restore an in-progress draft: this form is meant to be open DURING the
        // interview, so a refresh, a dropped connection, or a locked phone must
        // never cost someone their notes.
        let restored = null;
        try {
          restored = JSON.parse(localStorage.getItem(draftKey(res.data.stage)) || "null");
        } catch {
          restored = null;
        }
        const seeded = {};
        for (const c of res.data.criteria || []) {
          seeded[c.id] = restored?.rows?.[c.id] || {
            rating: null,
            notAssessed: true, // rule 2: the honest default
            note: "",
            claimVerdicts: {},
          };
        }
        setRows(seeded);
        if (restored?.decision) setDecision(restored.decision);
        if (restored?.decisionReason) setDecisionReason(restored.decisionReason);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err.response?.data?.error || "Could not open this scorecard.");
        if (err.response?.status === 401) clearAuth();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- draft persistence -----------------------------------------------------
  useEffect(() => {
    if (!payload || result) return;
    localStorage.setItem(draftKey(payload.stage), JSON.stringify({ rows, decision, decisionReason }));
  }, [payload, rows, decision, decisionReason, result]);

  const patchRow = useCallback((criterionId, patch) => {
    setRows((prev) => ({ ...prev, [criterionId]: { ...prev[criterionId], ...patch } }));
  }, []);

  const setVerdict = useCallback((criterionId, claimId, patch) => {
    setRows((prev) => {
      const row = prev[criterionId] || {};
      const existing = row.claimVerdicts?.[claimId] || { verdict: "", note: "" };
      return {
        ...prev,
        [criterionId]: {
          ...row,
          claimVerdicts: { ...row.claimVerdicts, [claimId]: { ...existing, ...patch } },
        },
      };
    });
  }, []);

  const assessedCount = useMemo(
    () => Object.values(rows).filter((r) => !r.notAssessed && r.rating).length,
    [rows]
  );

  // --- submit ----------------------------------------------------------------
  async function submit() {
    setSubmitError("");
    setSubmitting(true);
    try {
      const ratings = (payload.criteria || []).map((c) => {
        const row = rows[c.id] || {};
        return {
          criterionId: c.id,
          rating: row.notAssessed ? null : row.rating,
          notAssessed: Boolean(row.notAssessed),
          note: row.note || "",
          claimVerdicts: Object.entries(row.claimVerdicts || {})
            .filter(([, v]) => v.verdict)
            .map(([claimId, v]) => ({ claimId, verdict: v.verdict, note: v.note || "" })),
        };
      });
      const res = await api.post(
        "/scorecard-portal/submit",
        { ratings, decision, decisionReason },
        { headers: authHeader() }
      );
      localStorage.removeItem(draftKey(payload.stage));
      setResult(res.data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setSubmitError(err.response?.data?.error || "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // --- render ----------------------------------------------------------------

  if (loading) {
    return (
      <Shell>
        <Card className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-600" />
          <p className="mt-3 text-sm text-slate-500">Loading your scorecard…</p>
        </Card>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <Card className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Scorecard unavailable</h1>
          <p className="mt-2 text-sm font-medium text-red-600">{loadError}</p>
          <Button variant="outline" className="mt-5" onClick={() => navigate("/welcome")}>
            Close
          </Button>
        </Card>
      </Shell>
    );
  }

  // The reveal. They rated blind; now they see how it compared.
  if (result) {
    return (
      <Shell>
        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Scorecard recorded</h1>
              <p className="mt-1 text-sm text-slate-600">{result.message}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your rating</p>
              {result.score === null ? (
                <>
                  <p className="mt-1 text-2xl font-bold text-slate-400">Not scored</p>
                  <p className="mt-1 text-xs text-slate-500">{result.withheldReason}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{result.score}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Computed from your per-criterion ratings and this role&apos;s rubric weights — not entered by you or by AI.
                  </p>
                </>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                What the screening engine had
              </p>
              {result.engineSnapshot?.score === null || result.engineSnapshot?.score === undefined ? (
                <p className="mt-1 text-sm text-slate-500">
                  No engine score for this candidate — nothing to compare against.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{result.engineSnapshot.score}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {result.disagreement?.delta === null || result.disagreement?.delta === undefined
                      ? "No comparison available."
                      : result.disagreement.delta === 0
                        ? "You and the engine landed in the same place."
                        : `You rated ${Math.abs(result.disagreement.delta)} points ${
                            result.disagreement.direction === "human_higher" ? "higher" : "lower"
                          }. That gap is recorded, not resolved — a recruiter will look at it.`}
                  </p>
                </>
              )}
            </div>
          </div>

          {result.reproducibilityHash && (
            <p className="mt-5 flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Record {result.reproducibilityHash.slice(0, 12)} — the same observations will always produce the same number.
            </p>
          )}
        </Card>
      </Shell>
    );
  }

  const decisionValid = decision && (decision !== "decline" || decisionReason.trim());

  return (
    <Shell>
      {/* Header */}
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          {payload.stage?.replace(/_/g, " ")}
        </p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">{payload.candidate?.name}</h1>
        <p className="text-sm text-slate-500">
          {payload.job?.title}
          {payload.job?.department ? ` · ${payload.job.department}` : ""} · rubric v{payload.rubricVersion}
        </p>
      </div>

      <Card className="mb-5 border-brand-200 bg-brand-50/50 p-4">
        <p className="flex items-start gap-2 text-sm text-slate-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <span>
            Keep this open during the interview. Rate only what you actually probed — anything you didn&apos;t get
            to, leave as <strong>Not assessed</strong>. A blank is more useful to us than a guess, and it costs
            you nothing.
          </span>
        </p>
      </Card>

      {/* Criteria */}
      <div className="space-y-4">
        {payload.criteria.map((c) => {
          const row = rows[c.id] || {};
          const hasNote = Boolean((row.note || "").trim());
          return (
            <Card key={c.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">{c.label}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{c.rationale}</p>
                </div>
                <Badge tone={c.kind === "must_have" ? "brand" : "slate"}>
                  {c.kind === "must_have" ? "Must have" : "Nice to have"}
                </Badge>
              </div>

              {c.probeHint && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <strong className="text-slate-700">Suggested probe:</strong> {c.probeHint}
                </p>
              )}

              {/* What this round was asked to test */}
              {c.targetClaims?.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                    <Target className="h-3.5 w-3.5" />
                    Still unproven — worth testing
                  </p>
                  <div className="mt-2 space-y-3">
                    {c.targetClaims.map((t) => {
                      const v = row.claimVerdicts?.[t.claimId] || {};
                      return (
                        <div key={t.claimId} className="rounded-lg bg-white/70 p-2.5">
                          <p className="text-sm text-slate-800">&ldquo;{t.summary}&rdquo;</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {VERDICT_OPTIONS.map((o) => (
                              <button
                                key={o.value}
                                type="button"
                                onClick={() => setVerdict(c.id, t.claimId, { verdict: v.verdict === o.value ? "" : o.value })}
                                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                  v.verdict === o.value
                                    ? "bg-slate-900 text-white"
                                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                                }`}
                                title={o.help}
                              >
                                {o.label}
                              </button>
                            ))}
                          </div>
                          {v.verdict && v.verdict !== "inconclusive" && (
                            <input
                              value={v.note || ""}
                              onChange={(e) => setVerdict(c.id, t.claimId, { note: e.target.value })}
                              placeholder="What did they say? A rough quote is enough."
                              className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Evidence first — this is the gate */}
              <label className="mt-4 block text-xs font-semibold text-slate-700">
                What did you observe?
              </label>
              <textarea
                value={row.note || ""}
                onChange={(e) => patchRow(c.id, { note: e.target.value })}
                rows={2}
                placeholder="e.g. Walked through a Sev1 he was primary on-call for, named the rollback step."
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />

              {/* Rating — inert until there is something behind it */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = !row.notAssessed && row.rating === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      disabled={!hasNote}
                      onClick={() => patchRow(c.id, { rating: n, notAssessed: false })}
                      title={payload.ratingLabels?.[n]}
                      className={`h-10 w-10 rounded-xl text-sm font-bold transition ${
                        active
                          ? "bg-brand-600 text-white shadow-soft"
                          : hasNote
                            ? "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                            : "cursor-not-allowed bg-slate-100 text-slate-300"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => patchRow(c.id, { notAssessed: true, rating: null })}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    row.notAssessed
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  Not assessed
                </button>
              </div>

              {!hasNote ? (
                <p className="mt-2 text-xs text-slate-400">
                  Add an observation to enable the rating — or leave this as Not assessed.
                </p>
              ) : (
                !row.notAssessed &&
                row.rating && (
                  <p className="mt-2 text-xs text-slate-500">{payload.ratingLabels?.[row.rating]}</p>
                )
              )}
            </Card>
          );
        })}
      </div>

      {/* Decision */}
      <Card className="mt-5 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <ClipboardCheck className="h-4 w-4 text-brand-600" />
          Your recommendation
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          This is a recommendation, not the decision — a recruiter reviews it alongside the other rounds.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {payload.decisions.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDecision(d)}
              className={`rounded-xl px-4 py-3 text-left transition ${
                decision === d
                  ? "bg-slate-900 text-white"
                  : "bg-white ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="block text-sm font-semibold">{DECISION_COPY[d]?.label || d}</span>
              <span className={`block text-xs ${decision === d ? "text-slate-300" : "text-slate-500"}`}>
                {DECISION_COPY[d]?.help}
              </span>
            </button>
          ))}
        </div>

        {decision === "decline" && (
          <div className="mt-3">
            <label className="block text-xs font-semibold text-slate-700">
              Why? <span className="font-normal text-slate-500">(required — a decline is recorded with its reason)</span>
            </label>
            <textarea
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              placeholder="Could not evidence the must-have at any depth."
            />
          </div>
        )}

        {submitError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {assessedCount} of {payload.criteria.length} criteria rated · your notes save as you type
          </p>
          <Button onClick={submit} loading={submitting} disabled={!decisionValid} size="lg">
            Submit scorecard
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Once submitted it can&apos;t be edited — it becomes part of the hiring record.
        </p>
      </Card>
    </Shell>
  );
}

function Shell({ children }) {
  return <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">{children}</div>;
}
