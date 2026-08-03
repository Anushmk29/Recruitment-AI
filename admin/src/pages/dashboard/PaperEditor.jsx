import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Cpu,
  Lock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  FileQuestion,
  Ban,
} from "lucide-react";
import api from "../../api/client.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { Input, Textarea, Label, Select } from "../../components/ui/Field.jsx";
import Button from "../../components/ui/Button.jsx";

// Assessment paper editor (ASSESSMENT-ENGINE-PLAN A1.4). The recruiter's
// review-and-approve surface for the agentically generated test: blueprint →
// generate (blind-solve gated) → item review → Approve & Freeze. Flagged items
// (the blind solvers disagreed) are surfaced with the disagreement — never
// silently kept. This screen is the ONLY place item keys are ever rendered.

const STATUS_META = {
  draft: { label: "Draft", tone: "amber" },
  approved: { label: "Approved & frozen", tone: "green" },
  archived: { label: "Archived", tone: "slate" },
};

const TYPE_LABELS = {
  mcq_single: "Single choice",
  mcq_multi: "Multi select",
  numeric: "Numeric",
  ordering: "Ordering",
};

const DIFF_TONES = { easy: "slate", medium: "amber", hard: "red" };

function keySummary(item) {
  if (item.type === "numeric") return `${item.key?.value}${item.key?.tolerance ? ` ± ${item.key.tolerance}` : ""}`;
  if (item.type === "ordering") return (item.key?.order || []).join(" → ");
  return (item.key?.optionIds || []).join(", ");
}

export default function PaperEditor() {
  const { id: jobId } = useParams();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [papers, setPapers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [openItems, setOpenItems] = useState(() => new Set());
  const pollRef = useRef(null);

  const selected = useMemo(() => papers.find((p) => p._id === selectedId) || null, [papers, selectedId]);
  const isDraft = selected?.status === "draft";
  // `generationStalled` is computed server-side: the run says "running" but its
  // heartbeat died with the process that owned it. Treating that as "generating"
  // is what wedges this screen — it spins forever AND disables the one button that
  // would fix it. A stalled run is not generating; it is waiting to be resumed.
  const stalled = Boolean(selected?.generationStalled);
  const generating = selected?.generationRun?.status === "running" && !stalled;

  const load = useCallback(async () => {
    try {
      const [jobRes, papersRes] = await Promise.all([
        api.get(`/jobs/${jobId}`),
        api.get(`/assessments/papers/job/${jobId}`),
      ]);
      setJob(jobRes.data);
      setPapers(papersRes.data);
      setSelectedId((cur) => cur && papersRes.data.some((p) => p._id === cur) ? cur : papersRes.data[0]?._id || null);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to load assessment papers");
    } finally {
      setLoading(false);
    }
  }, [jobId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while generation runs so the progress counters move live.
  useEffect(() => {
    if (!generating) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/assessments/papers/${selectedId}`);
        setPapers((list) => list.map((p) => (p._id === selectedId ? res.data : p)));
      } catch {
        /* transient poll failures are fine */
      }
    }, 2500);
    return () => clearInterval(pollRef.current);
  }, [generating, selectedId]);

  async function compile() {
    setBusy(true);
    try {
      const res = await api.post(`/assessments/papers/job/${jobId}/compile`);
      setPapers((list) => [res.data, ...list.filter((p) => p._id !== res.data._id)]);
      setSelectedId(res.data._id);
      toast.success("Blueprint compiled from the approved rubric — review the sections, then generate items");
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === "NO_APPROVED_RUBRIC") {
        toast.error("Approve a Scoring Rubric first — the assessment is compiled from it.");
      } else {
        toast.error(data?.error || "Blueprint compilation failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(changes) {
    setBusy(true);
    try {
      const res = await api.patch(`/assessments/papers/${selectedId}`, changes);
      setPapers((list) => list.map((p) => (p._id === selectedId ? res.data : p)));
      toast.success("Draft saved");
    } catch (err) {
      toast.error(err.response?.data?.error || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    try {
      await api.post(`/assessments/papers/${selectedId}/items/generate`);
      toast.success("Item generation started — every item is blind-solved by 3 independent solvers before it's kept");
      const res = await api.get(`/assessments/papers/${selectedId}`);
      setPapers((list) => list.map((p) => (p._id === selectedId ? res.data : p)));
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not start generation");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateItem(itemId) {
    setBusy(true);
    try {
      const res = await api.post(`/assessments/papers/${selectedId}/items/${itemId}/regenerate`);
      setPapers((list) => list.map((p) => (p._id === selectedId ? res.data : p)));
      toast.success("Item regenerated and re-solved");
    } catch (err) {
      toast.error(err.response?.data?.error || "Regeneration failed");
    } finally {
      setBusy(false);
    }
  }

  async function retireItem(itemId) {
    setBusy(true);
    try {
      const res = await api.post(`/assessments/papers/${selectedId}/items/${itemId}/retire`);
      setPapers((list) => list.map((p) => (p._id === selectedId ? res.data : p)));
      toast.success("Item retired — excluded from future assembly (in-flight sessions unaffected)");
    } catch (err) {
      toast.error(err.response?.data?.error || "Retire failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    try {
      const res = await api.post(`/assessments/papers/${selectedId}/approve`);
      setPapers((list) => list.map((p) => (p._id === selectedId ? res.data : { ...p, status: p.status === "approved" ? "archived" : p.status })));
      setConfirmApprove(false);
      toast.success("Paper approved & frozen — every candidate for this role now gets this identical versioned paper");
    } catch (err) {
      toast.error(err.response?.data?.error || "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleItem(id) {
    setOpenItems((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const itemsBySection = new Map();
  for (const item of selected?.items || []) {
    if (!itemsBySection.has(item.sectionId)) itemsBySection.set(item.sectionId, []);
    itemsBySection.get(item.sectionId).push(item);
  }
  const flaggedCount = (selected?.items || []).filter((i) => i.status === "flagged").length;
  // Server-computed (poolItemCount, the per-tier cap and the per-paper ceiling all
  // live in backend config) so this screen can never quote a number generation
  // won't honour.
  const plan = selected?.generationPlan || null;
  const planBySection = new Map((plan?.sections || []).map((s) => [s.sectionId, s]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button as={Link} to={`/jobs/${jobId}/edit`} variant="ghost" className="!px-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Assessment Paper</h1>
            <p className="text-sm text-slate-500">{job?.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selected && (
            <Badge tone={(STATUS_META[selected.status] || STATUS_META.draft).tone}>
              v{selected.version} · {(STATUS_META[selected.status] || STATUS_META.draft).label}
            </Badge>
          )}
          <Button onClick={compile} disabled={busy} variant="secondary">
            <Cpu className="h-4 w-4" /> {papers.length ? "Compile new version" : "Compile blueprint"}
          </Button>
        </div>
      </div>

      {papers.length === 0 && (
        <EmptyState
          icon={FileQuestion}
          title="No assessment paper yet"
          description="Compile the blueprint from this job's approved Scoring Rubric. Every question is generated per-criterion and blind-solved before you review it — there is no generic question bank."
          action={
            <Button onClick={compile} disabled={busy}>
              <Cpu className="h-4 w-4" /> Compile blueprint
            </Button>
          }
        />
      )}

      {papers.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {papers.map((p) => (
            <button
              key={p._id}
              onClick={() => setSelectedId(p._id)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                p._id === selectedId ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              v{p.version} · {(STATUS_META[p.status] || STATUS_META.draft).label}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          {/* Provenance banner — engineering rule 5: nothing renders unlabelled. */}
          <Card className="!p-4 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Compiled by <strong>{selected.compiledBy?.model || "AI"}</strong> (prompt {selected.compiledBy?.promptVersion})
                from rubric v{selected.rubricVersion}
              </span>
              {selected.frozenAt && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <Lock className="h-3.5 w-3.5" /> Frozen {new Date(selected.frozenAt).toLocaleString()} — immutable; changes create a new version
                </span>
              )}
            </div>
          </Card>

          {/* Draft controls */}
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-800">Structure & difficulty</h2>
              {isDraft && (
                <span className="text-xs text-slate-500">Editable until Approve & Freeze</span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Difficulty policy</Label>
                <Select
                  value={selected.difficultyPolicy?.mode || "fixed"}
                  disabled={!isDraft || busy}
                  onChange={(e) => saveDraft({ difficultyPolicy: { mode: e.target.value, fixedTier: selected.difficultyPolicy?.fixedTier || "medium" } })}
                >
                  <option value="fixed">Fixed tier — same difficulty for every candidate</option>
                  <option value="claim_tiered">Claim-tiered — difficulty follows each résumé's own claims (recruiter can override per candidate)</option>
                </Select>
                <p className="mt-1 text-xs text-slate-500">
                  Claim-tiered pitches the test at the level the résumé asserts — verifying “8 years of React” requires the hard items.
                  The tier is derived in code from the candidate's claims, never by a model, and your per-candidate override always wins.
                </p>
              </div>
              {(selected.difficultyPolicy?.mode || "fixed") === "fixed" && (
                <div>
                  <Label>Fixed tier</Label>
                  <Select
                    value={selected.difficultyPolicy?.fixedTier || "medium"}
                    disabled={!isDraft || busy}
                    onChange={(e) => saveDraft({ difficultyPolicy: { mode: "fixed", fixedTier: e.target.value } })}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </Select>
                </div>
              )}
            </div>

            <div className="mt-5 space-y-3">
              {selected.sections.map((s) => (
                <SectionRow
                  key={s.id}
                  section={s}
                  plan={planBySection.get(s.id)}
                  editable={isDraft && !busy}
                  onSave={(edit) => saveDraft({ sections: [edit] })}
                />
              ))}
            </div>

            {plan && (
              <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <strong className="text-slate-700">This paper generates {plan.total} question(s)</strong> across{" "}
                {selected.sections.length} section(s) — more than any one candidate answers, on purpose. Each section keeps a bank
                roughly twice the number it serves so no two candidates get the same draw, and so items the blind solvers reject can
                be discarded without leaving the section short.
                {plan.mode === "claim_tiered" && " Claim-tiered mode builds that bank three times over — one per difficulty tier — because each candidate is served the tier their own claims assert."}
                {plan.capped && (
                  <span className="font-semibold text-amber-700">
                    {" "}
                    Capped: the full plan is {plan.uncappedTotal} items but the per-paper ceiling is {plan.paperCap}, so the last
                    sections will be generated short. Lower the questions-served counts, or raise ASSESSMENT_MAX_ITEMS_PER_PAPER.
                  </span>
                )}
              </p>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Candidate instructions (shown before start)</Label>
                <Textarea
                  rows={3}
                  defaultValue={selected.instructions || ""}
                  disabled={!isDraft || busy}
                  onBlur={(e) => isDraft && e.target.value !== (selected.instructions || "") && saveDraft({ instructions: e.target.value })}
                />
              </div>
              <div>
                <Label>Integrity</Label>
                <label className="mt-1 flex items-start gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(selected.integrityDefaults?.softLock?.enabled)}
                    disabled={!isDraft || busy}
                    onChange={(e) =>
                      saveDraft({ integrityDefaults: { softLock: { enabled: e.target.checked, flagThreshold: selected.integrityDefaults?.softLock?.flagThreshold || 3 } } })
                    }
                  />
                  <span>
                    <strong>Soft-lock</strong>: after {selected.integrityDefaults?.softLock?.flagThreshold || 3} high-severity flags the test{" "}
                    <em>pauses</em> and pings a reviewer. It can only ever pause — if nobody responds it auto-resumes. There is no
                    auto-termination on this platform.
                  </span>
                </label>
              </div>
            </div>
          </Card>

          {/* Generation */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Items</h2>
                <p className="text-xs text-slate-500">
                  {selected.items.filter((i) => i.status === "active").length} approved ·{" "}
                  <span className={flaggedCount ? "font-semibold text-amber-600" : ""}>{flaggedCount} flagged</span> ·{" "}
                  {selected.items.filter((i) => i.status === "retired").length} retired
                </p>
              </div>
              {isDraft && (
                <Button onClick={generate} disabled={busy || generating}>
                  <Cpu className="h-4 w-4" /> {selected.items.length ? "Resume / top-up generation" : "Generate items"}
                </Button>
              )}
            </div>

            {generating && (
              <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm text-brand-800">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Generating and blind-solving items… {selected.generationRun.generated + selected.generationRun.flagged}/
                  {selected.generationRun.target} done ({selected.generationRun.flagged} flagged, {selected.generationRun.failed} failed)
                </div>
                <p className="mt-1 text-xs">
                  Each item is answered by 3 independent solvers who never see the key. Anything they disagree on is revised once, then
                  flagged for you — disagreement means the question is ambiguous, and ambiguity is routed to a human, not shipped.
                </p>
              </div>
            )}
            {stalled && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Generation stopped before it finished
                </div>
                <p className="mt-1 text-xs">
                  The run was interrupted (usually a server restart) at{" "}
                  {selected.generationRun.generated + selected.generationRun.flagged} of {selected.generationRun.target} items. Everything
                  that already passed the blind-solve gate was kept — use <strong>Resume / top-up generation</strong> to carry on from
                  there. Nothing is regenerated twice.
                </p>
              </div>
            )}
            {selected.generationRun?.status === "failed" && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Generation failed: {selected.generationRun.message}
              </div>
            )}
            {selected.generationRun?.message && selected.generationRun?.status === "completed" && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                {selected.generationRun.message}
              </div>
            )}

            <div className="mt-5 space-y-6">
              {selected.sections.map((section) => (
                <div key={section.id}>
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">
                    {section.title}{" "}
                    <span className="font-normal text-slate-500">
                      — serves {section.servedItemCount} of {(itemsBySection.get(section.id) || []).filter((i) => i.status === "active").length} active items
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {(itemsBySection.get(section.id) || []).map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        open={openItems.has(item.id)}
                        onToggle={() => toggleItem(item.id)}
                        isDraft={isDraft}
                        busy={busy}
                        onRegenerate={() => regenerateItem(item.id)}
                        onRetire={() => retireItem(item.id)}
                      />
                    ))}
                    {!(itemsBySection.get(section.id) || []).length && (
                      <p className="text-xs text-slate-500">No items yet — run generation.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Approve & freeze */}
          {isDraft && (
            <Card className="border-brand-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="max-w-2xl">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
                    <ShieldCheck className="h-5 w-5 text-brand-600" /> Approve & Freeze
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Freezing makes this paper immutable and versioned — every candidate for this role is served from this identical
                    pool, which is what makes cross-candidate comparison legitimate and auditable. Changes after freezing create v
                    {selected.version + 1}; candidates mid-test keep v{selected.version}.
                  </p>
                  {flaggedCount > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-amber-600">
                      <AlertTriangle className="h-4 w-4" /> {flaggedCount} flagged item(s) won't be served. Regenerate or retire them —
                      sections must still meet their served count from active items.
                    </p>
                  )}
                </div>
                {!confirmApprove ? (
                  <Button onClick={() => setConfirmApprove(true)} disabled={busy}>
                    <CheckCircle2 className="h-4 w-4" /> Approve & Freeze
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button onClick={approve} disabled={busy}>
                      <Lock className="h-4 w-4" /> Yes, freeze v{selected.version}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmApprove(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SectionRow({ section, plan, editable, onSave }) {
  const [served, setServed] = useState(String(section.servedItemCount));
  const [time, setTime] = useState(String(section.timeLimitSec));
  const dirty = Number(served) !== section.servedItemCount || Number(time) !== section.timeLimitSec;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-semibold text-slate-700">{section.title}</p>
        <p className="text-xs text-slate-500">criteria: {section.criterionIds.join(", ")}</p>
      </div>
      <div>
        <Label className="!text-xs">Questions served</Label>
        <Input type="number" min="2" max="8" value={served} disabled={!editable} onChange={(e) => setServed(e.target.value)} className="w-24" />
        <p className="mt-1 text-[11px] text-slate-500">what one candidate answers</p>
      </div>
      <div>
        <Label className="!text-xs">Questions generated</Label>
        {/* Read-only and derived, not a second knob: the bank is sized from the
            served count so the two can never drift out of step. */}
        <div className="mt-1 w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          {plan ? plan.planned : section.poolItemCount}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {plan?.perTier ? `${plan.perTier} × 3 tiers` : `bank of ${section.poolItemCount}`}
        </p>
      </div>
      <div>
        <Label className="!text-xs">Time limit (sec)</Label>
        <Input type="number" min="60" step="30" value={time} disabled={!editable} onChange={(e) => setTime(e.target.value)} className="w-28" />
      </div>
      <div className="text-xs text-slate-500">
        mix: {section.difficultyMix?.easy || 0}E / {section.difficultyMix?.medium || 0}M / {section.difficultyMix?.hard || 0}H
      </div>
      {editable && dirty && (
        <Button variant="secondary" onClick={() => onSave({ id: section.id, servedItemCount: Number(served), timeLimitSec: Number(time) })}>
          Save
        </Button>
      )}
    </div>
  );
}

function ItemRow({ item, open, onToggle, isDraft, busy, onRegenerate, onRetire }) {
  const solve = item.generation?.blindSolve;
  const flagged = item.status === "flagged";
  const retired = item.status === "retired";
  return (
    <div className={`rounded-xl border p-3 ${flagged ? "border-amber-300 bg-amber-50/50" : retired ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white"}`}>
      <button onClick={onToggle} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{item.stem}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={DIFF_TONES[item.difficulty] || "slate"}>{item.difficulty}</Badge>
            <Badge tone="slate">{TYPE_LABELS[item.type] || item.type}</Badge>
            <Badge tone="slate">criterion {item.criterionId}</Badge>
            {solve && (
              <Badge tone={flagged ? "amber" : "green"}>
                {flagged ? `solvers split ${solve.agreedWithKey}/${solve.n}` : `blind-solve ${solve.agreedWithKey}/${solve.n} ✓`}
              </Badge>
            )}
            {retired && <Badge tone="slate">retired</Badge>}
            {item.exposure?.serves > 0 && (
              <Badge tone="slate">
                served {item.exposure.serves}× · {Math.round(((item.exposure.corrects || 0) / item.exposure.serves) * 100)}% correct
              </Badge>
            )}
          </div>
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
          {(item.options || []).map((o) => {
            const isKey =
              item.type === "ordering"
                ? false
                : (item.key?.optionIds || []).includes(o.id);
            return (
              <p key={o.id} className={isKey ? "font-semibold text-emerald-700" : "text-slate-600"}>
                {o.id}) {o.text} {isKey && "✓"}
              </p>
            );
          })}
          <p className="text-xs text-slate-500">
            <strong>Key:</strong> {keySummary(item)}
          </p>
          {item.rationale && (
            <p className="text-xs text-slate-500">
              <strong>Why:</strong> {item.rationale}
            </p>
          )}
          {flagged && solve && (
            <p className="rounded-lg bg-amber-100/60 p-2 text-xs text-amber-800">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              Independent solvers (who never saw the key) disagreed with it — this question is ambiguous or its key is wrong. It will
              not be served. Regenerate it, or retire it and let the section draw from other items.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            {isDraft && (
              <Button variant="secondary" onClick={onRegenerate} disabled={busy}>
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate
              </Button>
            )}
            {!retired && (
              <Button variant="ghost" onClick={onRetire} disabled={busy}>
                <Ban className="h-3.5 w-3.5" /> Retire
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
