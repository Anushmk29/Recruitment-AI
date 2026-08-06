import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ShieldCheck,
  Cpu,
  AlertTriangle,
  Info,
  Lock,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import api from "../../api/client.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { Input, Textarea, Label, Select } from "../../components/ui/Field.jsx";
import Button from "../../components/ui/Button.jsx";

// Rubric review & approval screen (BUILD-PLAN Phase 3.4). The recruiter reviews
// the compiled criteria, sets how much each one matters, reads the JD-quality
// flags, and then APPROVES & FREEZES. No candidate is ever scored by the
// evidence engine against an unapproved rubric — this screen is the
// human-in-the-loop boundary.
//
// AUTHORING RULE: nobody types a weight here. A criterion's importance is a WORD
// picked from the server's fixed ladder, and the server turns the word into the
// number. That is engineering rule 1 (code computes, not the model) extended to
// the human — "why is this 35%?" has no answer, "it is Critical, and Critical
// means the same thing in every rubric this tenant has approved" does. The
// percentages this screen shows are therefore OUTPUT, never input.

// Only used if the API responds without `vocab` (mid-deploy skew). The server's
// copy always wins; this exists so the screen still renders rather than blanking.
const FALLBACK_VOCAB = {
  importanceTiers: [
    { key: "critical", label: "Critical", multiplier: 8, kind: "must_have", blurb: "Weak here and the candidate is not hireable for this role." },
    { key: "important", label: "Important", multiplier: 4, kind: "must_have", blurb: "Expected of the role. Counts heavily, but one gap is survivable." },
    { key: "helpful", label: "Helpful", multiplier: 2, kind: "nice_to_have", blurb: "Genuinely useful; someone without it can still advance." },
    { key: "bonus", label: "Bonus", multiplier: 1, kind: "nice_to_have", blurb: "A tiebreaker. Barely moves the score on its own." },
  ],
  defaultImportance: "important",
  thresholdPresets: [
    { key: "wide", label: "Wide net", advance: 50, review: 35, blurb: "Interview generously; let the interview do the filtering." },
    { key: "balanced", label: "Balanced", advance: 60, review: 45, blurb: "The default. Clear passes advance, clear misses decline." },
    { key: "selective", label: "Selective", advance: 70, review: 55, blurb: "Only strong evidence advances without a human read." },
    { key: "very_selective", label: "Very selective", advance: 80, review: 65, blurb: "Senior or scarce roles where a weak hire costs more than a slow one." },
  ],
  evidenceTypes: ["skill", "experience", "education", "project", "certification", "outcome"],
  maxCriteria: 20,
};

// Visual ladder for the four tiers — strongest to faintest, so the weighting of
// a rubric is legible at a glance without reading a single number. Written out
// per-key (not built with template strings) so Tailwind's static scanner sees
// every class name.
const TIER_STYLES = {
  critical: { chip: "bg-brand-100 text-brand-700", bar: "bg-brand-600" },
  important: { chip: "bg-brand-50 text-brand-700", bar: "bg-brand-400" },
  helpful: { chip: "bg-slate-100 text-slate-600", bar: "bg-slate-400" },
  bonus: { chip: "bg-slate-50 text-slate-500", bar: "bg-slate-300" },
};
const DEFAULT_TIER_STYLE = { chip: "bg-slate-100 text-slate-600", bar: "bg-slate-300" };

const SEVERITY_META = {
  critical: { icon: AlertTriangle, cls: "border-red-200 bg-red-50 text-red-800", badge: "red" },
  warning: { icon: AlertTriangle, cls: "border-amber-200 bg-amber-50 text-amber-800", badge: "amber" },
  info: { icon: Info, cls: "border-slate-200 bg-slate-50 text-slate-700", badge: "slate" },
};

// A criterion added by clicking rather than typing still needs a non-empty
// reason (schema guardrail), so the click supplies a truthful one — it records
// how the criterion got here. It is deliberately recognisable: rows carrying it
// get a nudge to replace it with the real reason before freezing.
const LIBRARY_REASON_PREFIX = "Chosen from the standard criteria library";
const CUSTOM_REASON = "Added by the recruiter during rubric review as a requirement for this role.";
function reasonIsPlaceholder(rationale) {
  const r = String(rationale || "");
  return r.startsWith(LIBRARY_REASON_PREFIX) || r === CUSTOM_REASON;
}

// Click-to-add criteria that apply to almost any role. Each carries its own
// reason, evidence types and interview probe, so adding one is a single click
// and still produces a criterion that can be defended and tested.
const LIBRARY = [
  {
    label: "Owns work end to end",
    importance: "important",
    evidenceTypes: ["experience", "project", "outcome"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate has carried work from problem to shipped result, not only completed assigned tasks.`,
    probeHint: "Ask for one thing they shipped end to end, and who they had to convince along the way.",
  },
  {
    label: "Debugging an unfamiliar system",
    importance: "important",
    evidenceTypes: ["experience", "project"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate can diagnose a failure they have never seen before, rather than only follow a known runbook.`,
    probeHint: "Ask about the hardest bug they found the root cause of, and how they narrowed it down.",
  },
  {
    label: "Works from incomplete requirements",
    importance: "important",
    evidenceTypes: ["experience", "outcome"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate makes progress when the spec is ambiguous instead of waiting to be unblocked.`,
    probeHint: "Ask about a time the requirements were wrong or missing, and what they did before escalating.",
  },
  {
    label: "Production ownership",
    importance: "important",
    evidenceTypes: ["experience", "outcome"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate has been accountable for something running in production, not only for building it.`,
    probeHint: "Ask what broke on their watch, how they found out, and what changed afterwards.",
  },
  {
    label: "Measurable impact on a real metric",
    importance: "important",
    evidenceTypes: ["outcome", "project"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate can point to a number that moved because of their work, rather than describing activity.`,
    probeHint: "Ask which metric moved, what it was before and after, and how they knew it was their change.",
  },
  {
    label: "Written communication",
    importance: "helpful",
    evidenceTypes: ["project", "outcome"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate can make a decision understandable to someone who was not in the room.`,
    probeHint: "Ask about something they wrote up for a decision, and who the audience was.",
  },
  {
    label: "Mentoring or code review",
    importance: "helpful",
    evidenceTypes: ["experience"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate raises the people around them, not only their own output.`,
    probeHint: "Ask about someone they helped level up, and what specifically they did.",
  },
  {
    label: "Cross-functional collaboration",
    importance: "helpful",
    evidenceTypes: ["experience", "outcome"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate can get an outcome that needed people outside their own team.`,
    probeHint: "Ask about a result that required another team, and where it nearly fell apart.",
  },
  {
    label: "Picks up unfamiliar technology quickly",
    importance: "helpful",
    evidenceTypes: ["skill", "project"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests learning speed, which matters more than any single tool on a stack that will change.`,
    probeHint: "Ask what they learned most recently under time pressure, and how they got productive.",
  },
  {
    label: "Handles conflicting priorities",
    importance: "bonus",
    evidenceTypes: ["experience"],
    rationale: `${LIBRARY_REASON_PREFIX} — tests whether the candidate can sequence work when two people both want to be first.`,
    probeHint: "Ask about two things that were both urgent, and how they decided.",
  },
];

function normLabel(s) {
  return String(s || "").trim().toLowerCase();
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `k${keySeq}`;
}

// A criterion the compiler produced before importance tiers existed carries no
// `importance`. Fall back to the kind it was authored with rather than inventing
// a precision the original author never expressed. Mirrors rubricEngine.importanceOf.
function importanceOf(c) {
  if (c?.importance) return c.importance;
  if (c?.kind === "must_have") return "critical";
  if (c?.kind === "nice_to_have") return "helpful";
  return null;
}
function isGate(c) {
  return c?.kind === "disqualifier";
}

export default function RubricEditor() {
  const { id: jobId } = useParams();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [vocab, setVocab] = useState(FALLBACK_VOCAB);
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [thresholds, setThresholds] = useState({ advance: 60, review: 45 });
  const [presetKey, setPresetKey] = useState("balanced");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Rows start collapsed — a rubric with a dozen criteria should read as a
  // scannable list, not a wall of open forms. Keyed by the client-side `_key`
  // so adding or removing a row never re-opens the wrong one.
  const [openRows, setOpenRows] = useState(() => new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const customRef = useRef(null);

  const tiers = vocab.importanceTiers || FALLBACK_VOCAB.importanceTiers;
  const tierByKey = useMemo(() => Object.fromEntries(tiers.map((t) => [t.key, t])), [tiers]);
  const tierRank = useMemo(() => Object.fromEntries(tiers.map((t, i) => [t.key, i])), [tiers]);
  const presets = vocab.thresholdPresets || FALLBACK_VOCAB.thresholdPresets;
  const evidenceTypes = vocab.evidenceTypes || FALLBACK_VOCAB.evidenceTypes;
  const maxCriteria = vocab.maxCriteria || FALLBACK_VOCAB.maxCriteria;

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
        if (rubricRes.data.vocab) setVocab(rubricRes.data.vocab);
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
    setCriteria(
      selected.criteria.map((c) => ({
        ...c,
        _key: nextKey(),
        importance: importanceOf(c),
        evidenceTypes: c.evidenceTypes || [],
        acceptableEvidence: c.acceptableEvidence || [],
        probeHint: c.probeHint || "",
        seniorityFloor: c.seniorityFloor || "",
      }))
    );
    const t = { advance: selected.thresholds?.advance ?? 60, review: selected.thresholds?.review ?? 45 };
    setThresholds(t);
    const hit = presets.find((p) => p.advance === t.advance && p.review === t.review);
    setPresetKey(hit ? hit.key : "custom");
    setOpenRows(new Set());
    setShowAdd(false);
    setCustomLabel("");
  }, [selected, presets]);

  function toggleRow(key) {
    setOpenRows((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  // The payload carries an importance WORD and never a weight — the server
  // derives kind and weight from the tier, so no number chosen in this browser
  // can become part of a candidate's score. Legacy knock-out gates are sent back
  // untouched so an old draft keeps meaning exactly what it meant.
  function criteriaPayload() {
    return criteria.map((c) => {
      const base = {
        label: String(c.label || "").trim(),
        rationale: String(c.rationale || "").trim(),
        evidenceTypes: c.evidenceTypes || [],
        acceptableEvidence: c.acceptableEvidence || [],
        probeHint: c.probeHint || "",
        seniorityFloor: c.seniorityFloor || "",
      };
      return isGate(c) ? { ...base, kind: "disqualifier" } : { ...base, importance: c.importance };
    });
  }

  async function saveDraft() {
    const incomplete = criteria.find((c) => !String(c.label || "").trim() || !String(c.rationale || "").trim());
    if (incomplete) {
      setOpenRows((set) => new Set(set).add(incomplete._key));
      toast.error("Every criterion needs a name and a reason it exists — the highlighted one is missing something.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.patch(`/rubrics/${selected._id}`, {
        criteria: criteriaPayload(),
        ...(presetKey === "custom"
          ? { thresholds: { advance: Number(thresholds.advance), review: Number(thresholds.review) } }
          : { thresholdPreset: presetKey }),
      });
      toast.success("Draft saved");
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

  function setCriterion(key, patch) {
    setCriteria((list) => list.map((c) => (c._key === key ? { ...c, ...patch } : c)));
  }

  function removeCriterion(key) {
    setCriteria((list) => list.filter((c) => c._key !== key));
  }

  function toggleEvidenceType(key, type) {
    setCriteria((list) =>
      list.map((c) => {
        if (c._key !== key) return c;
        const has = (c.evidenceTypes || []).includes(type);
        return { ...c, evidenceTypes: has ? c.evidenceTypes.filter((t) => t !== type) : [...(c.evidenceTypes || []), type] };
      })
    );
  }

  const existingLabels = useMemo(() => new Set(criteria.map((c) => normLabel(c.label))), [criteria]);

  // One click = one fully-formed criterion (name, reason, evidence types,
  // interview probe). Typing is the fallback, not the default path.
  function addFromTemplate(tpl, { open = false } = {}) {
    if (criteria.length >= maxCriteria) {
      toast.error(`A rubric holds at most ${maxCriteria} criteria — remove one first.`);
      return;
    }
    const key = nextKey();
    setCriteria((list) => [
      ...list,
      {
        _key: key,
        id: "",
        label: tpl.label,
        importance: tpl.importance || vocab.defaultImportance || "important",
        kind: null,
        rationale: tpl.rationale,
        evidenceTypes: tpl.evidenceTypes || ["experience"],
        acceptableEvidence: tpl.acceptableEvidence || [],
        probeHint: tpl.probeHint || "",
        seniorityFloor: "",
      },
    ]);
    if (open) setOpenRows((set) => new Set(set).add(key));
  }

  function addCustom() {
    const label = customLabel.trim();
    if (!label) return;
    if (existingLabels.has(normLabel(label))) {
      toast.error("That criterion is already on the rubric.");
      return;
    }
    addFromTemplate({ label, importance: vocab.defaultImportance || "important", rationale: CUSTOM_REASON, evidenceTypes: ["experience"] }, { open: true });
    setCustomLabel("");
    customRef.current?.focus();
  }

  // Suggestions drawn from what the job already states, so the common case is
  // "click the four things you already typed into the posting".
  const jobSuggestions = useMemo(() => {
    const out = [];
    for (const skill of job?.requiredSkills || []) {
      const s = String(skill).trim();
      if (!s) continue;
      out.push({
        label: `Working proficiency in ${s}`,
        importance: "important",
        rationale: `"${s}" is listed as a required skill on this posting.`,
        evidenceTypes: ["skill", "experience", "project"],
        acceptableEvidence: [`Hands-on work experience using ${s}`, `A project or deliverable built with ${s}`],
        probeHint: `Ask for a specific task the candidate completed with ${s}, then probe one detail only hands-on use would teach.`,
      });
    }
    if (Number(job?.minExperienceYears) > 0) {
      out.push({
        label: `At least ${job.minExperienceYears} year(s) of relevant professional experience`,
        importance: "critical",
        rationale: `The posting sets a minimum of ${job.minExperienceYears} year(s) of experience.`,
        evidenceTypes: ["experience"],
        acceptableEvidence: ["Employment history in a relevant role covering the required duration"],
        probeHint: "Ask the candidate to walk through the scope and ownership of their most recent relevant role.",
      });
    }
    if (job?.requiredEducation && String(job.requiredEducation).trim()) {
      const edu = String(job.requiredEducation).trim();
      out.push({
        label: `Education: ${edu}`,
        importance: "helpful",
        rationale: `The posting lists "${edu}" as required education.`,
        evidenceTypes: ["education"],
        acceptableEvidence: [edu],
        probeHint: "",
      });
    }
    return out.filter((s) => !existingLabels.has(normLabel(s.label)));
  }, [job, existingLabels]);

  const librarySuggestions = useMemo(() => LIBRARY.filter((s) => !existingLabels.has(normLabel(s.label))), [existingLabels]);

  // --- Derived weighting (OUTPUT, never input) ---------------------------------
  // On a draft, share is computed live from the tier multipliers so changing a
  // word updates the picture immediately. On a frozen version, the STORED weight
  // is the audit fact and is what gets shown — never a recomputation of it.
  const gates = criteria.filter(isGate);
  const scoreable = criteria.filter((c) => !isGate(c));
  const multiplierTotal = scoreable.reduce((s, c) => s + (tierByKey[c.importance]?.multiplier || 0), 0);

  function shareOf(c) {
    if (isGate(c)) return 0;
    if (!isDraft) return Math.round((Number(c.weight) || 0) * 100);
    if (!multiplierTotal) return 0;
    return Math.round(((tierByKey[c.importance]?.multiplier || 0) / multiplierTotal) * 100);
  }

  const tierTotals = tiers.map((t) => {
    const rows = scoreable.filter((c) => c.importance === t.key);
    const share = rows.reduce((s, c) => s + shareOf(c), 0);
    return { tier: t, count: rows.length, share };
  });
  const requiredCount = scoreable.filter((c) => tierByKey[c.importance]?.kind === "must_have").length;
  const preferredCount = scoreable.length - requiredCount;

  const sortedRows = useMemo(() => {
    return criteria
      .filter((c) => !isGate(c))
      .map((c, order) => ({ c, order }))
      .sort((a, b) => (tierRank[a.c.importance] ?? 99) - (tierRank[b.c.importance] ?? 99) || a.order - b.order)
      .map(({ c }) => c);
  }, [criteria, tierRank]);

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

  const activePreset = presets.find((p) => p.key === presetKey) || null;
  // A custom pair can collapse the review band to nothing. Say so rather than
  // printing a range that routes nobody to a human (rule 5 — never render a
  // guarantee the settings don't actually make).
  const advanceNum = Number(thresholds.advance);
  const reviewNum = Number(thresholds.review);
  const hasReviewBand = Number.isFinite(advanceNum) && Number.isFinite(reviewNum) && reviewNum < advanceNum;

  // Each criterion is one line by default — name, importance word, resulting
  // share — expand it to edit the reason, the interview probe, and the evidence
  // types. Reviewing a 12-criterion rubric should mean scanning a list, not
  // scrolling past 12 open forms.
  function renderCriterion(c) {
    const tier = tierByKey[c.importance];
    const style = TIER_STYLES[c.importance] || DEFAULT_TIER_STYLE;
    const isOpen = openRows.has(c._key);
    const needsReason = !String(c.rationale || "").trim() || reasonIsPlaceholder(c.rationale);
    return (
      <div key={c._key} className="rounded-xl border border-slate-200">
        {/* The name is the row. The importance control and the share it produces
            are a fixed-width group pinned to the right, and the name takes
            whatever is left — never the other way round. `min-w-0` on both
            halves is what lets the name truncate instead of forcing the row
            wider than the card. */}
        <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <button type="button" onClick={() => toggleRow(c._key)} className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left" aria-expanded={isOpen}>
            {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
              {c.label || <span className="italic text-slate-500">Untitled criterion</span>}
            </span>
            {isDraft && needsReason && (
              <span className="hidden shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 sm:inline">
                needs a reason
              </span>
            )}
          </button>

          <div className="flex shrink-0 items-center gap-2">
            {isDraft ? (
              <Select
                compact
                value={c.importance || ""}
                onChange={(e) => setCriterion(c._key, { importance: e.target.value })}
                aria-label={`How much does "${c.label || "this criterion"}" matter?`}
                className="w-28 sm:w-36"
              >
                {tiers.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            ) : (
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style.chip}`}>{tier?.label || "—"}</span>
            )}

            <span
              className="w-10 text-right text-xs font-semibold tabular-nums text-slate-500"
              title="Share of the total score — computed from the importance you picked"
            >
              {shareOf(c)}%
            </span>

            {isDraft && (
              <Button variant="ghost" size="sm" onClick={() => removeCriterion(c._key)} aria-label="Remove criterion">
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>
        </div>

        {isOpen && (
          <div className="space-y-3 border-t border-slate-100 px-3 pb-4 pt-3 sm:px-4">
            {isDraft && (
              <div>
                <Label>Criterion</Label>
                <Input value={c.label} placeholder="What are you measuring?" onChange={(e) => setCriterion(c._key, { label: e.target.value })} />
              </div>
            )}

            {tier && <p className="text-xs text-slate-500">{tier.blurb}</p>}

            <div>
              {isDraft ? (
                <>
                  <Label>Why it matters for this role</Label>
                  <Textarea
                    rows={2}
                    value={c.rationale}
                    placeholder="One sentence — this is what you point at if the decision is ever challenged."
                    onChange={(e) => setCriterion(c._key, { rationale: e.target.value })}
                  />
                  {needsReason && (
                    <p className="mt-1 text-xs text-amber-700">
                      Replace this with the real reason before you freeze — it is the sentence that defends the decision later.
                    </p>
                  )}
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
                      placeholder="How would you test this if the résumé merely asserts it? (optional)"
                      onChange={(e) => setCriterion(c._key, { probeHint: e.target.value })}
                    />
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold">Interview probe:</span> {c.probeHint}
                  </p>
                )}
              </div>
            )}

            <div>
              {isDraft && <Label>Where the evidence can come from</Label>}
              <div className="flex flex-wrap gap-1.5">
                {(isDraft ? evidenceTypes : c.evidenceTypes || []).map((t) => {
                  const on = (c.evidenceTypes || []).includes(t);
                  if (!isDraft) {
                    return (
                      <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        {t}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleEvidenceType(c._key, t)}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        on ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
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
          description="Compile the job description into explicit, individually-testable hiring criteria. You review and approve before anything is used for scoring."
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
                v{v.version} <Badge tone={v.status === "approved" ? "green" : v.status === "draft" ? "amber" : "slate"}>{v.status}</Badge>
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
                    <strong>Compiled without AI.</strong> This draft was derived only from the job&apos;s structured fields — the free-text
                    description was not decomposed. Review and edit carefully before approving.
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                  <div>
                    Compiled by <strong>{selected.compiledBy?.model}</strong> (prompt {selected.compiledBy?.promptVersion}). The model proposed the
                    criteria and how much each one matters; every weight and threshold is computed in code.
                  </div>
                </div>
              )}

              {selected.frozenAt && (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <strong>Frozen {new Date(selected.frozenAt).toLocaleString()}.</strong> Every candidate for this job is scored against this exact
                    version. Editing the JD creates a new draft for review — it never changes this one.
                  </div>
                </div>
              )}

              {/* Phase 10.4 — outcome insights: which criteria actually predicted
                  advancement here. Read-only; you edit, every edit is a new version. */}
              {flaggedInsights.length > 0 && (
                <Card>
                  <h3 className="mb-1 text-base font-semibold text-slate-900">Outcome insights</h3>
                  <p className="mb-3 text-xs text-slate-500">
                    Based on {insights.sampleSize} candidates with decided outcomes against this rubric. Importance is never auto-tuned from
                    outcomes — that would automate past bias. You decide what to change.
                  </p>
                  <div className="space-y-2">
                    {flaggedInsights.map((c) => (
                      <div key={c.criterionId} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={c.insight === "inverse" ? "red" : "amber"}>{c.insight === "inverse" ? "Anti-predictive" : "No signal"}</Badge>
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
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-bold text-slate-900">Criteria ({scoreable.length})</h2>
                  <p className="text-xs text-slate-500">
                    {requiredCount} required · {preferredCount} preferred
                  </p>
                </div>

                {/* The weighting, as a picture. Nobody types a percentage — you pick
                    a word per criterion and this is what it adds up to. */}
                {multiplierTotal > 0 && (
                  <div className="mb-5">
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      {tierTotals.map(({ tier, share }) =>
                        share > 0 ? (
                          <div
                            key={tier.key}
                            className={TIER_STYLES[tier.key]?.bar || DEFAULT_TIER_STYLE.bar}
                            style={{ width: `${share}%` }}
                            title={`${tier.label} — ${share}% of the score`}
                          />
                        ) : null
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      {tierTotals
                        .filter(({ count }) => count > 0)
                        .map(({ tier, count, share }) => (
                          <span key={tier.key} className="inline-flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${TIER_STYLES[tier.key]?.bar || DEFAULT_TIER_STYLE.bar}`} />
                            {tier.label} × {count} — {share}% of score
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {isDraft && (
                  <div className="mb-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <p>
                      You never type a percentage. Pick how much each criterion matters and the weighting is computed for you — a{" "}
                      <strong>Critical</strong> criterion counts twice an <strong>Important</strong> one, four times a <strong>Helpful</strong> one,
                      eight times a <strong>Bonus</strong>. That is what makes two candidates comparable and the number explainable later.
                    </p>
                  </div>
                )}

                {/* Add criteria — click, don't type. */}
                {isDraft && (
                  <div className="mb-4">
                    <Button variant={showAdd ? "secondary" : "outline"} size="sm" onClick={() => setShowAdd((v) => !v)}>
                      <Plus className="h-3.5 w-3.5" /> Add criteria
                    </Button>

                    {showAdd && (
                      <div className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        {jobSuggestions.length > 0 && (
                          <div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">From this job posting</h4>
                              <button
                                type="button"
                                onClick={() => jobSuggestions.forEach((s) => addFromTemplate(s))}
                                className="text-xs font-semibold text-brand-700 hover:underline"
                              >
                                Add all {jobSuggestions.length}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {jobSuggestions.map((s) => (
                                <button
                                  key={s.label}
                                  type="button"
                                  onClick={() => addFromTemplate(s)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-50"
                                >
                                  <Plus className="h-3 w-3" /> {s.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {librarySuggestions.length > 0 && (
                          <div>
                            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                              <Sparkles className="h-3.5 w-3.5" /> Common criteria
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {librarySuggestions.map((s) => (
                                <button
                                  key={s.label}
                                  type="button"
                                  onClick={() => addFromTemplate(s)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-white hover:text-brand-700"
                                >
                                  <Plus className="h-3 w-3" /> {s.label}
                                </button>
                              ))}
                            </div>
                            <p className="mt-2 text-[11px] text-slate-500">
                              Each of these arrives with a reason and an interview probe already filled in — edit the reason to say why it matters
                              <em> here</em>.
                            </p>
                          </div>
                        )}

                        <div>
                          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Something else</h4>
                          <div className="flex gap-2">
                            <Input
                              ref={customRef}
                              value={customLabel}
                              placeholder="Name your own criterion…"
                              onChange={(e) => setCustomLabel(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addCustom();
                                }
                              }}
                            />
                            <Button variant="secondary" onClick={addCustom} disabled={!customLabel.trim()}>
                              Add
                            </Button>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-500">
                          {criteria.length} of {maxCriteria} criteria used.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {sortedRows.length ? (
                  <div className="space-y-2">{sortedRows.map((c) => renderCriterion(c))}</div>
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                    No criteria yet — use <strong>Add criteria</strong> above, or recompile from the job description.
                  </p>
                )}

                {/* Knock-out gates are no longer authored here. Any that survive
                    on an old draft are shown as-is and can be removed — silently
                    reweighting one into a scoreable criterion would change what
                    the rubric means without anyone deciding to. */}
                {gates.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                      Legacy knock-out gates ({gates.length})
                    </h4>
                    <p className="mb-2 text-xs text-slate-500">
                      Compiled by an older version of the rubric engine. They carry no weight and fail a candidate outright. New rubrics don&apos;t
                      use them — ambiguity belongs in front of a human, not behind an automatic rejection.
                    </p>
                    <div className="space-y-2">
                      {gates.map((c) => (
                        <div key={c._key} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{c.label}</span>
                          {isDraft && (
                            <Button variant="ghost" size="sm" onClick={() => removeCriterion(c._key)} aria-label="Remove gate">
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              {/* Thresholds */}
              <Card>
                <h2 className="mb-1 text-base font-bold text-slate-900">How selective is this role?</h2>
                <p className="mb-4 text-sm text-slate-500">
                  Two cut-offs, not one: a clear pass advances, a clear miss declines, and everything in between goes to a person. Ambiguity never
                  gets resolved by a coin-flip.
                </p>

                <div className="max-w-md space-y-3">
                  <Select value={presetKey} disabled={!isDraft} onChange={(e) => {
                    const key = e.target.value;
                    setPresetKey(key);
                    const p = presets.find((x) => x.key === key);
                    if (p) setThresholds({ advance: p.advance, review: p.review });
                  }}>
                    {presets.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                    <option value="custom">Custom…</option>
                  </Select>

                  {activePreset && <p className="text-xs text-slate-500">{activePreset.blurb}</p>}

                  {presetKey === "custom" && (
                    <div className="grid grid-cols-2 gap-4">
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
                  )}

                  {hasReviewBand ? (
                    <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                      Scores <strong>{advanceNum} and above</strong> advance · <strong>{reviewNum}–{advanceNum - 1}</strong> goes to a human ·{" "}
                      <strong>below {reviewNum}</strong> declines.
                    </p>
                  ) : (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      These two cut-offs leave <strong>no review band</strong> — every candidate either advances or declines with nobody reading
                      the borderline cases. Lower the review floor below {advanceNum || 0} to put ambiguity back in front of a person.
                    </p>
                  )}
                </div>
              </Card>

              {selected.approvedBy?.at && (
                <p className="text-xs text-slate-500">Approved {new Date(selected.approvedBy.at).toLocaleString()} — recorded in the audit log.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
