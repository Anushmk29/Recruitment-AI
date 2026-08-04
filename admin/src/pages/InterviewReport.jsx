import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Bot, User, Cpu, Clock, CheckCircle2, AlertTriangle, Download, Mic, ShieldCheck, ShieldAlert, ScanFace, Eye } from "lucide-react";
import api from "../api/client.js";
import { getSocket } from "../lib/socket.js";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../components/ui/Field.jsx";
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

function scoreTone(v) {
  if (v == null) return "bg-slate-200";
  if (v >= 75) return "bg-emerald-500";
  if (v >= 55) return "bg-amber-500";
  return "bg-red-500";
}

function ScoreBar({ label, value }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="font-semibold text-slate-800">{value != null ? `${value}/100` : "—"}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${scoreTone(value)}`} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
      </div>
    </div>
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

function TurnQualityStrip({ quality }) {
  if (!quality?.perTurn?.length) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Mic className="h-4 w-4 text-brand-600" /> Answer-by-answer quality
        </h3>
        <span className="text-xs text-slate-500">
          {quality.degradedCount} of {quality.total} answers flagged
        </span>
      </div>
      <div className="mt-4 flex items-end gap-1 overflow-x-auto pb-1">
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
            <div key={t.index} title={tip} className="flex w-5 shrink-0 flex-col items-center gap-1">
              <div className="flex h-16 w-full items-end rounded-sm bg-slate-100">
                <div
                  className={`w-full rounded-sm ${t.degraded ? "bg-red-600" : "bg-brand-500"}`}
                  style={{ height: `${Math.max(4, Math.min(100, score))}%` }}
                />
              </div>
              {/* Secondary encoding — the flag is never colour-alone. */}
              <span className={`text-[10px] leading-none ${t.degraded ? "text-red-600" : "text-transparent"}`} aria-hidden>
                !
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-500" /> Answer score
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-600" /> ! Degraded audio signature
        </span>
        <span className="text-slate-500">Hover any bar for the reason.</span>
      </div>
    </Card>
  );
}

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
      <Card className="border-2 border-dashed border-amber-400 bg-amber-50">
        <p className="text-xs font-medium text-amber-700">Recommendation withheld</p>
        <p className="mt-1 text-lg font-bold text-amber-900">{action.action}</p>
        <p className="mt-1 text-sm text-amber-800">{action.justification}</p>
      </Card>
    );
  }
  return (
    <Card className="border-2 border-slate-800 bg-slate-900 text-white">
      <p className="text-xs font-medium text-slate-300">Recommended action</p>
      <p className="mt-1 text-lg font-bold">{action.action}</p>
      <p className="mt-1 text-sm text-slate-300">{action.justification}</p>
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

export default function InterviewReport() {
  const { id } = useParams();
  const toast = useToast();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [movingTo, setMovingTo] = useState("");
  const [downloading, setDownloading] = useState(false);

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

      {/* Spans all three evidence legs, so it renders with or without an
          interview — a report with no interview still shows what was tested. */}
      <CoverageMatrix coverage={coverage} />

      {!report.hasInterview ? (
        <>
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
          {/* Evaluation */}
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

          <TurnQualityStrip quality={quality} />

          <ClaimVerificationCard cv={report.claimVerification} />

          <AssessmentCard assessment={report.assessment} criterionLabels={criterionLabels} />

          <CompetencyTable rows={interview.competencyTable} />

          {/* Integrity / proctoring */}
          {report.proctoring && <IntegrityCard proctoring={report.proctoring} evidenceClips={report.evidenceClips} />}

          {/* Decision actions */}
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
          </Card>

          <RecommendedActionCard action={interview.recommendedAction} />
        </>
      )}
    </div>
  );
}
