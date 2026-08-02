import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Cpu, AlertTriangle, Info, Lock, Plus, Trash2, RefreshCw, Save, CheckCircle2, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
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

// Group order + the plain-language explanation shown once above each section,
// so a first-time user never has to guess what "must-have" changes about scoring.
// Each group is rendered as its own boxed "lane" (stacked vertically, not side by
// side) so the three kinds read as clearly separate blocks, not one long list.
const KIND_GROUPS = [
  {
    kind: "must_have",
    title: "Must-have criteria",
    blurb: "Expected of every candidate and counted toward the score below.",
    accent: "brand",
  },
  {
    kind: "nice_to_have",
    title: "Nice-to-have criteria",
    blurb: "Not required, but count toward the score when a candidate has them.",
    accent: "slate",
  },
  {
    kind: "disqualifier",
    title: "Disqualifiers",
    blurb: "Instant knock-outs — carry no weight. If a candidate fails one, they fail overall no matter how they score elsewhere.",
    accent: "red",
  },
];

// Border/header/ring classes per lane accent. Written out per-key (not built with
// template strings) so Tailwind's static class scanner can see every class name.
const LANE_STYLES = {
  brand: { border: "border-brand-200", header: "bg-brand-50/70", ring: "ring-brand-300" },
  slate: { border: "border-slate-300", header: "bg-slate-50", ring: "ring-slate-300" },
  red: { border: "border-red-200", header: "bg-red-50/70", ring: "ring-red-300" },
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
  // Rows and sections start collapsed — a rubric with a dozen criteria should read as a
  // scannable list, not a wall of open forms. Reset whenever the selected version changes.
  const [openRows, setOpenRows] = useState(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState(() => new Set());
  // Drag-to-reclassify: dragging a row's handle into a different section changes
  // its kind, so you don't have to open the row and use the dropdown just to
  // move a criterion from must-have to nice-to-have (or into a disqualifier).
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);

  // Reclassify + reorder: pull the item out, retarget its kind, and reinsert it
  // just before whatever occupied `toIndexBeforeRemoval` prior to removal.
  function moveCriterion(fromIndex, toIndexBeforeRemoval, newKind) {
    setCriteria((list) => {
      const next = [...list];
      const [item] = next.splice(fromIndex, 1);
      let insertAt = toIndexBeforeRemoval;
      if (fromIndex < toIndexBeforeRemoval) insertAt -= 1;
      next.splice(insertAt, 0, { ...item, kind: newKind });
      return next;
    });
  }

  // Dropped on a section itself (not on a specific row) — reclassify and send
  // it to the end of that section.
  function moveCriterionToEnd(fromIndex, newKind) {
    setCriteria((list) => {
      const next = [...list];
      const [item] = next.splice(fromIndex, 1);
      next.push({ ...item, kind: newKind });
      return next;
    });
  }

  function toggleRow(i) {
    setOpenRows((set) => {
      const next = new Set(set);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleSection(kind) {
    setCollapsedSections((set) => {
      const next = new Set(set);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

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
    setOpenRows(new Set());
    setCollapsedSections(new Set());
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

  function addCriterion(kind = "nice_to_have") {
    setCriteria((list) => [
      ...list,
      { id: `c${list.length + 1}`, label: "", kind, weight: 10, rationale: "", evidenceTypes: ["experience"], acceptableEvidence: [], probeHint: "", seniorityFloor: "" },
    ]);
  }

  function removeCriterion(idx) {
    setCriteria((list) => list.filter((_, i) => i !== idx));
  }

  const relativeTotal = criteria.filter((c) => c.kind !== "disqualifier").reduce((s, c) => s + (Number(c.weight) || 0), 0);

  // Aggregate share per kind so a new user can SEE the weight split (a bar) instead
  // of having to add up percentages in their head.
  const kindShareTotals = { must_have: 0, nice_to_have: 0 };
  criteria.forEach((c) => {
    if (c.kind !== "must_have" && c.kind !== "nice_to_have") return;
    kindShareTotals[c.kind] += relativeTotal === 0 ? 0 : ((Number(c.weight) || 0) / relativeTotal) * 100;
  });
  const disqualifierCount = criteria.filter((c) => c.kind === "disqualifier").length;

  // Three-step progress: where is this rubric in its lifecycle right now.
  const stepState = {
    compile: versions.length ? "done" : "active",
    review: !versions.length ? "todo" : isDraft ? "active" : "done",
    approve: selected?.status === "approved" ? "done" : isDraft && versions.length ? "active" : "todo",
  };
  const STEPS = [
    { key: "compile", label: "Compile from JD" },
    { key: "review", label: "Review & adjust" },
    { key: "approve", label: "Approve & freeze" },
  ];

  // Each criterion is one line by default — label, kind, weight — expand it to
  // edit rationale, probe hint, and evidence types. Reviewing a 12-criterion
  // rubric should mean scanning a list, not scrolling past 12 open forms.
  function renderCriterion(c, i, sectionKind) {
    const kindMeta = KIND_META[c.kind] || KIND_META.nice_to_have;
    const share = c.kind === "disqualifier" || relativeTotal === 0 ? 0 : Math.round(((Number(c.weight) || 0) / relativeTotal) * 100);
    const isOpen = openRows.has(i);
    const isDragging = draggedIndex === i;
    return (
      <div
        key={i}
        className={`rounded-xl border border-slate-200 ${isDragging ? "opacity-40" : ""}`}
        onDragOver={(e) => {
          if (draggedIndex === null) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          if (draggedIndex === null) return;
          e.preventDefault();
          e.stopPropagation();
          if (draggedIndex !== i) moveCriterion(draggedIndex, i, sectionKind);
          setDraggedIndex(null);
          setDragOverSection(null);
        }}
      >
        <div className="flex items-center gap-2 px-4 py-3">
          {isDraft && (
            <span
              draggable
              onDragStart={(e) => {
                setDraggedIndex(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDraggedIndex(null);
                setDragOverSection(null);
              }}
              className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
              aria-label="Drag to move to a different section"
            >
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          <button
            type="button"
            onClick={() => toggleRow(i)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={isOpen}
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
              {c.label || <span className="italic text-slate-500">Untitled criterion</span>}
            </span>
            <Badge tone={kindMeta.tone}>{kindMeta.label}</Badge>
          </button>

          {c.kind === "disqualifier" ? (
            <span className="shrink-0 text-xs font-medium text-red-500">no weight</span>
          ) : isDraft ? (
            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-slate-700">
              <input
                type="number"
                min="0"
                max="100"
                value={c.weight}
                onChange={(e) => setCriterion(i, { weight: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                aria-label="Weight value"
                className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              %
            </span>
          ) : (
            <span className="shrink-0 text-sm font-semibold text-slate-700">{Math.round(c.weight)}%</span>
          )}

          {isDraft && (
            <Button variant="ghost" size="sm" onClick={() => removeCriterion(i)} aria-label="Remove criterion" className="shrink-0">
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>

        {isOpen && (
          <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
            {isDraft && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Label>Label</Label>
                  <Input value={c.label} placeholder="Criterion label" onChange={(e) => setCriterion(i, { label: e.target.value })} />
                </div>
                <div>
                  <Label>Kind</Label>
                  <Select value={c.kind} onChange={(e) => setCriterion(i, { kind: e.target.value })} className="w-40">
                    <option value="must_have">Must-have</option>
                    <option value="nice_to_have">Nice-to-have</option>
                    <option value="disqualifier">Disqualifier</option>
                  </Select>
                </div>
              </div>
            )}

            {c.kind !== "disqualifier" && isDraft && (
              <div>
                <Label>Weight</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={c.weight}
                    onChange={(e) => setCriterion(i, { weight: Number(e.target.value) })}
                    className="h-2 flex-1 accent-brand-600"
                  />
                  <span className="w-32 shrink-0 text-right text-xs text-slate-500">≈ {share}% of total score</span>
                </div>
              </div>
            )}
            {c.kind === "disqualifier" && (
              <p className="text-xs font-medium text-red-600">Knock-out gate — carries no weight; failing it fails the candidate.</p>
            )}

            <div>
              {isDraft ? (
                <>
                  <Label>Why this criterion exists</Label>
                  <Textarea
                    rows={2}
                    value={c.rationale}
                    placeholder="Why this criterion exists (required)"
                    onChange={(e) => setCriterion(i, { rationale: e.target.value })}
                  />
                </>
              ) : (
                <p className="text-sm text-slate-600">{c.rationale}</p>
              )}
            </div>

            {(c.probeHint || isDraft) && (
              <div>
                {isDraft ? (
                  <>
                    <Label>Interview probe</Label>
                    <Input
                      value={c.probeHint}
                      placeholder="Interview probe hint (how to test this claim)"
                      onChange={(e) => setCriterion(i, { probeHint: e.target.value })}
                    />
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold">Interview probe:</span> {c.probeHint}
                  </p>
                )}
              </div>
            )}

            {c.evidenceTypes?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {c.evidenceTypes.map((t) => (
                  <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

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
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Scoring Rubric</h1>
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

      {/* Where this rubric is in its lifecycle, at a glance. */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
        {STEPS.map((step, idx) => {
          const state = stepState[step.key];
          return (
            <div key={step.key} className="flex flex-1 items-center gap-2.5">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  state === "done"
                    ? "bg-emerald-100 text-emerald-600"
                    : state === "active"
                      ? "bg-brand-100 text-brand-700"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {state === "done" ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
              </div>
              <span className={`text-xs font-semibold ${state === "todo" ? "text-slate-500" : "text-slate-700"}`}>{step.label}</span>
              {idx < STEPS.length - 1 && <div className="mx-1 hidden h-px flex-1 bg-slate-200 sm:block" />}
            </div>
          );
        })}
      </div>

      {!versions.length ? (
        <EmptyState
          icon={Cpu}
          title="No rubric yet"
          description="Compile the job description into explicit, weighted, individually-testable hiring criteria. You review and approve before anything is used for scoring."
          action={
            <Button onClick={compileRubric} loading={busy}>
              <Cpu className="h-4 w-4" /> Compile rubric
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
                  <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
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
                  <p className="mb-3 text-xs text-slate-500">
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
                          <span className="text-xs text-slate-500">
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
                <div className="mb-4">
                  <h2 className="text-base font-bold text-slate-900">Criteria ({criteria.length})</h2>
                </div>

                {/* At-a-glance weight split — no mental math required. */}
                {kindShareTotals.must_have + kindShareTotals.nice_to_have > 0 && (
                  <div className="mb-5">
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-brand-500" style={{ width: `${kindShareTotals.must_have}%` }} />
                      <div className="bg-slate-400" style={{ width: `${kindShareTotals.nice_to_have}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-brand-500" /> Must-have — {Math.round(kindShareTotals.must_have)}% of score
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-slate-400" /> Nice-to-have — {Math.round(kindShareTotals.nice_to_have)}% of score
                      </span>
                      {disqualifierCount > 0 && (
                        <span>
                          + {disqualifierCount} disqualifier{disqualifierCount > 1 ? "s" : ""} (no weight — automatic fail)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {isDraft && (
                  <div className="mb-5 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <p>
                      Drag a slider (or type a number) to make a criterion matter more or less. These are <strong>relative</strong> — they
                      don&apos;t need to add up to 100. The bar above always shows each group&apos;s true share of the total score.
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  {KIND_GROUPS.map((group) => {
                    const rows = criteria.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === group.kind);
                    if (!rows.length && !isDraft) return null;
                    const isCollapsed = collapsedSections.has(group.kind);
                    const isDropTarget = isDraft && draggedIndex !== null;
                    const isDragOver = dragOverSection === group.kind;
                    const style = LANE_STYLES[group.accent];
                    return (
                      <div
                        key={group.kind}
                        className={`overflow-hidden rounded-2xl border-2 transition ${style.border} ${
                          isDragOver ? `ring-2 ring-offset-1 ${style.ring}` : ""
                        }`}
                        onDragOver={(e) => {
                          if (!isDropTarget) return;
                          e.preventDefault();
                          setDragOverSection(group.kind);
                        }}
                        onDragLeave={() => setDragOverSection((cur) => (cur === group.kind ? null : cur))}
                        onDrop={(e) => {
                          if (!isDropTarget) return;
                          e.preventDefault();
                          moveCriterionToEnd(draggedIndex, group.kind);
                          setDraggedIndex(null);
                          setDragOverSection(null);
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSection(group.kind)}
                          className={`flex w-full items-start justify-between gap-2 px-4 py-3 text-left ${style.header}`}
                          aria-expanded={!isCollapsed}
                        >
                          <div className="flex items-start gap-2">
                            {isCollapsed ? (
                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            ) : (
                              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            )}
                            <div>
                              <h3 className="text-sm font-bold text-slate-800">
                                {group.title} <span className="font-normal text-slate-500">({rows.length})</span>
                              </h3>
                              <p className="text-xs text-slate-500">{group.blurb}</p>
                            </div>
                          </div>
                        </button>
                        {!isCollapsed && (
                          <div className="bg-white p-3">
                            {isDraft && (
                              <div className="mb-3 flex justify-end">
                                <Button variant="ghost" size="sm" onClick={() => addCriterion(group.kind)}>
                                  <Plus className="h-3.5 w-3.5" /> Add {KIND_META[group.kind].label.toLowerCase()}
                                </Button>
                              </div>
                            )}
                            {rows.length ? (
                              <div className="space-y-2">{rows.map(({ c, i }) => renderCriterion(c, i, group.kind))}</div>
                            ) : (
                              <p className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                                {isDropTarget ? "Drop here to move it into this section." : "None yet."}
                              </p>
                            )}
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
                <p className="text-xs text-slate-500">
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
