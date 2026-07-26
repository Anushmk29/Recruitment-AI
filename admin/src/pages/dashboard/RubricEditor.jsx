import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Sparkles, AlertTriangle, Info, Lock, Plus, Trash2, RefreshCw, Save } from "lucide-react";
import api from "../../api/client.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { Input, Textarea, Label, Select } from "../../components/ui/Field.jsx";
import Button from "../../components/ui/Button.jsx";

// Rubric review & approval screen (BUILD-PLAN Phase 3.4). The recruiter reviews
// the compiled criteria, adjusts weights, reads the JD-quality flags, and then
// APPROVES & FREEZES. No candidate is ever scored by the evidence engine against
// an unapproved rubric — this screen is the human-in-the-loop boundary.

const KIND_META = {
  must_have: { label: "Must-have", tone: "brand" },
  nice_to_have: { label: "Nice-to-have", tone: "slate" },
  disqualifier: { label: "Disqualifier", tone: "red" },
};

const SEVERITY_META = {
  critical: { icon: AlertTriangle, cls: "border-red-200 bg-red-50 text-red-800", badge: "red" },
  warning: { icon: AlertTriangle, cls: "border-amber-200 bg-amber-50 text-amber-800", badge: "amber" },
  info: { icon: Info, cls: "border-slate-200 bg-slate-50 text-slate-700", badge: "slate" },
};

function pct(weight) {
  return Math.round((Number(weight) || 0) * 100);
}

export default function RubricEditor() {
  const { id: jobId } = useParams();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [thresholds, setThresholds] = useState({ advance: 60, review: 45 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => versions.find((v) => v._id === selectedId) || null, [versions, selectedId]);
  const isDraft = selected?.status === "draft";

  // Phase 10.4 — outcome-joined criterion insights (read-only; the system
  // never auto-tunes weights — a human reads this and edits, every edit a new
  // version). Loaded best-effort; hidden until enough outcomes exist.
  const [insights, setInsights] = useState(null);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    api
      .get(`/rubrics/${selectedId}/insights`)
      .then((res) => {
        if (!cancelled) setInsights(res.data);
      })
      .catch(() => {
        if (!cancelled) setInsights(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);
  const flaggedInsights = (insights?.criteria || []).filter((c) => c.insight === "no_signal" || c.insight === "inverse");

  const load = useCallback(
    async (preferId) => {
      setLoading(true);
      try {
        const [jobRes, rubricRes] = await Promise.all([api.get(`/jobs/${jobId}`), api.get(`/rubrics/job/${jobId}`)]);
        setJob(jobRes.data);
        const list = rubricRes.data.versions || [];
        setVersions(list);
        const pick =
          (preferId && list.find((v) => v._id === preferId)) ||
          list.find((v) => v.status === "draft") ||
          list.find((v) => v.status === "approved") ||
          list[0] ||
          null;
        setSelectedId(pick?._id || null);
      } catch (err) {
        toast.error(err.response?.data?.error || "Could not load the rubric");
      } finally {
        setLoading(false);
      }
    },
    [jobId, toast]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Local editable copies follow the selected version.
  useEffect(() => {
    if (!selected) return;
    setCriteria(selected.criteria.map((c) => ({ ...c, weight: pct(c.weight) })));
    setThresholds({ advance: selected.thresholds?.advance ?? 60, review: selected.thresholds?.review ?? 45 });
  }, [selected]);

  async function compileRubric() {
    setBusy(true);
    try {
      const res = await api.post(`/rubrics/job/${jobId}/compile`);
      toast.success(`Draft v${res.data.version} compiled (${res.data.compiledBy?.engine === "ai" ? "AI" : "deterministic fallback"})`);
      await load(res.data._id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Compilation failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    try {
      const res = await api.patch(`/rubrics/${selected._id}`, {
        criteria: criteria.map(({ _id, ...c }) => c), // weights are RELATIVE — the server normalises
        thresholds: { advance: Number(thresholds.advance), review: Number(thresholds.review) },
      });
      toast.success("Draft saved — weights re-normalised");
      await load(res.data._id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not save the draft");
    } finally {
      setBusy(false);
    }
  }

  async function approveRubric() {
    const ok = window.confirm(
      `Approve & freeze rubric v${selected.version}?\n\nOnce frozen it can never be edited — every candidate for this job will be scored against this exact version. A JD edit will create a new draft for review instead.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/rubrics/${selected._id}/approve`);
      toast.success(`Rubric v${selected.version} approved & frozen`);
      await load(selected._id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  function setCriterion(idx, patch) {
    setCriteria((list) => list.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function addCriterion() {
    setCriteria((list) => [
      ...list,
      { id: `c${list.length + 1}`, label: "", kind: "nice_to_have", weight: 10, rationale: "", evidenceTypes: ["experience"], acceptableEvidence: [], probeHint: "", seniorityFloor: "" },
    ]);
  }

  function removeCriterion(idx) {
    setCriteria((list) => list.filter((_, i) => i !== idx));
  }

  const relativeTotal = criteria.filter((c) => c.kind !== "disqualifier").reduce((s, c) => s + (Number(c.weight) || 0), 0);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to={`/jobs/${jobId}/edit`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to job
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Scoring Rubric</h1>
          <p className="mt-1 text-sm text-slate-500">{job?.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={compileRubric} loading={busy && !versions.length}>
            <RefreshCw className="h-4 w-4" /> {versions.length ? "Recompile from JD" : "Compile rubric"}
          </Button>
          {isDraft && (
            <>
              <Button variant="secondary" onClick={saveDraft} loading={busy}>
                <Save className="h-4 w-4" /> Save draft
              </Button>
              <Button onClick={approveRubric} loading={busy}>
                <ShieldCheck className="h-4 w-4" /> Approve & Freeze
              </Button>
            </>
          )}
        </div>
      </div>

      {!versions.length ? (
        <EmptyState
          icon={Sparkles}
          title="No rubric yet"
          description="Compile the job description into explicit, weighted, individually-testable hiring criteria. You review and approve before anything is used for scoring."
          action={
            <Button onClick={compileRubric} loading={busy}>
              <Sparkles className="h-4 w-4" /> Compile rubric
            </Button>
          }
        />
      ) : (
        <>
          {/* Version tabs */}
          <div className="flex flex-wrap gap-2">
            {versions.map((v) => (
              <button
                key={v._id}
                onClick={() => setSelectedId(v._id)}
                className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                  v._id === selectedId ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                v{v.version}{" "}
                <Badge tone={v.status === "approved" ? "green" : v.status === "draft" ? "amber" : "slate"}>{v.status}</Badge>
              </button>
            ))}
          </div>

          {selected && (
            <>
              {/* Provenance — degraded paths are labelled, never hidden */}
              {selected.compiledBy?.engine === "fallback" ? (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <strong>Compiled without AI.</strong> This draft was derived only from the job's structured fields — the free-text
                    description was not decomposed. Review and edit carefully before approving.
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                  <div>
                    Compiled by <strong>{selected.compiledBy?.model}</strong> (prompt {selected.compiledBy?.promptVersion}). The model proposed
                    the criteria; all weights and thresholds are computed and normalised in code.
                  </div>
                </div>
              )}

              {selected.frozenAt && (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <strong>Frozen {new Date(selected.frozenAt).toLocaleString()}.</strong> Every candidate for this job is scored against this
                    exact version. Editing the JD creates a new draft for review — it never changes this one.
                  </div>
                </div>
              )}

              {/* Phase 10.4 — outcome insights: which criteria actually predicted
                  advancement here. Read-only; you edit, every edit is a new version. */}
              {flaggedInsights.length > 0 && (
                <Card>
                  <h3 className="mb-1 text-base font-semibold text-slate-900">Outcome insights</h3>
                  <p className="mb-3 text-xs text-slate-400">
                    Based on {insights.sampleSize} candidates with decided outcomes against this rubric. Weights are never auto-tuned
                    from outcomes — that would automate past bias. You decide what to change.
                  </p>
                  <div className="space-y-2">
                    {flaggedInsights.map((c) => (
                      <div key={c.criterionId} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={c.insight === "inverse" ? "red" : "amber"}>
                            {c.insight === "inverse" ? "Anti-predictive" : "No signal"}
                          </Badge>
                          <span className="font-medium text-slate-800">{c.label}</span>
                          <span className="text-xs text-slate-400">
                            satisfied by {Math.round((c.satisfiedAdvancedRate ?? 0) * 100)}% of advanced vs{" "}
                            {Math.round((c.satisfiedRejectedRate ?? 0) * 100)}% of rejected (n={c.nAdvanced + c.nRejected})
                          </span>
                        </div>
                        {c.note && <p className="mt-1 text-xs text-amber-800">{c.note}</p>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* JD quality flags */}
              {selected.qualityFlags?.length > 0 && (
                <Card>
                  <h2 className="mb-3 text-base font-bold text-slate-900">JD quality check ({selected.qualityFlags.length})</h2>
                  <div className="space-y-2.5">
                    {selected.qualityFlags.map((f, i) => {
                      const meta = SEVERITY_META[f.severity] || SEVERITY_META.info;
                      const FlagIcon = meta.icon;
                      return (
                        <div key={i} className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${meta.cls}`}>
                          <FlagIcon className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={meta.badge}>{f.severity}</Badge>
                              <span className="font-mono text-xs opacity-70">{f.code}</span>
                            </div>
                            <p className="mt-1">{f.message}</p>
                            {f.evidence && <p className="mt-1 text-xs italic opacity-80">Found in JD: &ldquo;{f.evidence}&rdquo;</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Criteria */}
              <Card>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-slate-900">Criteria ({criteria.length})</h2>
                  {isDraft && (
                    <Button variant="ghost" size="sm" onClick={addCriterion}>
                      <Plus className="h-4 w-4" /> Add criterion
                    </Button>
                  )}
                </div>

                <div className="space-y-4">
                  {criteria.map((c, i) => {
                    const kindMeta = KIND_META[c.kind] || KIND_META.nice_to_have;
                    const share = c.kind === "disqualifier" || relativeTotal === 0 ? 0 : Math.round(((Number(c.weight) || 0) / relativeTotal) * 100);
                    return (
                      <div key={i} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {isDraft ? (
                              <Input value={c.label} placeholder="Criterion label" onChange={(e) => setCriterion(i, { label: e.target.value })} />
                            ) : (
                              <p className="font-semibold text-slate-900">{c.label}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isDraft ? (
                              <Select value={c.kind} onChange={(e) => setCriterion(i, { kind: e.target.value })} className="w-40">
                                <option value="must_have">Must-have</option>
                                <option value="nice_to_have">Nice-to-have</option>
                                <option value="disqualifier">Disqualifier</option>
                              </Select>
                            ) : (
                              <Badge tone={kindMeta.tone}>{kindMeta.label}</Badge>
                            )}
                            {isDraft && (
                              <Button variant="ghost" size="sm" onClick={() => removeCriterion(i)} aria-label="Remove criterion">
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {c.kind !== "disqualifier" && (
                          <div className="mt-3 flex items-center gap-3">
                            {isDraft ? (
                              <>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={c.weight}
                                  onChange={(e) => setCriterion(i, { weight: Number(e.target.value) })}
                                  className="h-2 flex-1 accent-brand-600"
                                />
                                <span className="w-24 text-right text-sm font-semibold text-slate-700">≈ {share}% weight</span>
                              </>
                            ) : (
                              <span className="text-sm font-semibold text-slate-700">{pct(c.weight)}% of the score</span>
                            )}
                          </div>
                        )}
                        {c.kind === "disqualifier" && (
                          <p className="mt-2 text-xs font-medium text-red-600">Knock-out gate — carries no weight; failing it fails the candidate.</p>
                        )}

                        <div className="mt-3">
                          {isDraft ? (
                            <Textarea
                              rows={2}
                              value={c.rationale}
                              placeholder="Why this criterion exists (required)"
                              onChange={(e) => setCriterion(i, { rationale: e.target.value })}
                            />
                          ) : (
                            <p className="text-sm text-slate-600">{c.rationale}</p>
                          )}
                        </div>

                        {(c.probeHint || isDraft) && (
                          <div className="mt-2">
                            {isDraft ? (
                              <Input
                                value={c.probeHint}
                                placeholder="Interview probe hint (how to test this claim)"
                                onChange={(e) => setCriterion(i, { probeHint: e.target.value })}
                              />
                            ) : (
                              <p className="text-xs text-slate-500">
                                <span className="font-semibold">Interview probe:</span> {c.probeHint}
                              </p>
                            )}
                          </div>
                        )}

                        {c.evidenceTypes?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {c.evidenceTypes.map((t) => (
                              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Thresholds */}
              <Card>
                <h2 className="mb-1 text-base font-bold text-slate-900">Decision thresholds</h2>
                <p className="mb-4 text-sm text-slate-500">
                  At or above <strong>advance</strong> the candidate moves forward; below <strong>review</strong> they do not; anything in
                  between is routed to a human. Two thresholds, so ambiguity goes to people — never to a coin-flip.
                </p>
                <div className="grid max-w-md grid-cols-2 gap-4">
                  <div>
                    <Label>Advance ≥</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={thresholds.advance}
                      disabled={!isDraft}
                      onChange={(e) => setThresholds((t) => ({ ...t, advance: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Review floor</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={thresholds.review}
                      disabled={!isDraft}
                      onChange={(e) => setThresholds((t) => ({ ...t, review: e.target.value }))}
                    />
                  </div>
                </div>
              </Card>

              {selected.approvedBy?.at && (
                <p className="text-xs text-slate-400">
                  Approved {new Date(selected.approvedBy.at).toLocaleString()} — recorded in the audit log.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
