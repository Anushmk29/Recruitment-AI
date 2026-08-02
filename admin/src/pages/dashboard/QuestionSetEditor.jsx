import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Cpu,
  AlertTriangle,
  Info,
  Lock,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  MessageSquareQuote,
} from "lucide-react";
import api from "../../api/client.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { Textarea, Input, Label } from "../../components/ui/Field.jsx";
import Button from "../../components/ui/Button.jsx";

// The must-ask question set for a job — review & approval screen.
//
// THE DESIGN GOAL IS THAT THE RECRUITER DOES ALMOST NOTHING. This screen does not open on a blank
// page: the server compiles a full set from the job description and the approved rubric before
// this renders, so the default path is read eight questions, click Approve. Editing is available
// and expected to be rare.
//
// The human approval stays, and it is worth being clear why it is not bureaucracy: these
// questions are read verbatim to every candidate for this role. When a rejected candidate's
// lawyer asks who decided what was asked, the answer needs a name and a timestamp on it. That
// signature is the entire reason this artifact is versioned and frozen.
//
// AUTHORING RULE: nothing typed here decides what an answer is WORTH. A question set decides what
// gets asked; the versioned rubric decides what it counts for. There is no weight, no score and
// no threshold on this screen, by design.

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `q${keySeq}`;
}

// Human-readable explanation for the vetting codes the server returns. The server always sends a
// `message` too — this is the short label beside it, so a row can be scanned without reading.
const ISSUE_LABEL = {
  duplicate: "Duplicate",
  too_short: "Too short",
  too_long: "Too long",
  empty: "Empty",
  control_chars: "Invalid characters",
};
function issueLabel(code) {
  if (ISSUE_LABEL[code]) return ISSUE_LABEL[code];
  if (code?.startsWith("protected_")) return "Unlawful to ask";
  if (code?.startsWith("accusatory_")) return "Accusatory";
  return "Problem";
}

export default function QuestionSetEditor() {
  const { id: jobId } = useParams();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Live vetting, keyed by row index, from POST /review. Shown as the recruiter types so a
  // problem is visible where it was created rather than only when approval is refused.
  const [issuesByIndex, setIssuesByIndex] = useState({});
  const [newText, setNewText] = useState("");
  const newRef = useRef(null);

  const selected = useMemo(() => versions.find((v) => v._id === selectedId) || null, [versions, selectedId]);
  const isDraft = selected?.status === "draft";
  const approved = useMemo(() => versions.find((v) => v.status === "approved") || null, [versions]);

  const load = useCallback(
    async (preferId) => {
      setLoading(true);
      try {
        // The list endpoint compiles a draft if this job has none, so by the time this resolves
        // there is always something to read.
        const [jobRes, setRes] = await Promise.all([api.get(`/jobs/${jobId}`), api.get(`/jobs/${jobId}/question-set`)]);
        setJob(jobRes.data);
        const list = setRes.data.versions || [];
        setVersions(list);
        const pick =
          (preferId && list.find((v) => v._id === preferId)) ||
          list.find((v) => v.status === "draft") ||
          list.find((v) => v.status === "approved") ||
          list[0] ||
          null;
        setSelectedId(pick?._id || null);
      } catch (err) {
        toast.error(err.response?.data?.error || "Could not load the question set");
      } finally {
        setLoading(false);
      }
    },
    [jobId, toast]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    setQuestions((selected.questions || []).map((q) => ({ _key: nextKey(), text: q.text, topic: q.topic || "" })));
    setIssuesByIndex({});
    setNewText("");
  }, [selected]);

  // Vet as they type, debounced. Best-effort: a failed check leaves the previous verdict rather
  // than blanking it, because "no issues shown" must never be the result of a network error.
  useEffect(() => {
    if (!isDraft || !questions.length) return;
    const t = setTimeout(() => {
      api
        .post(`/jobs/${jobId}/question-set/review`, { questions: questions.map((q) => ({ text: q.text, topic: q.topic })) })
        .then((res) => {
          const map = {};
          for (const issue of res.data.issues || []) {
            if (issue.index < 0) continue;
            (map[issue.index] = map[issue.index] || []).push(issue);
          }
          setIssuesByIndex(map);
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [questions, isDraft, jobId]);

  const blockingIssues = useMemo(() => Object.values(issuesByIndex).flat(), [issuesByIndex]);

  async function regenerate() {
    const ok =
      !questions.length ||
      window.confirm("Recompile from the job description?\n\nThis creates a NEW draft. Any edits on the current draft stay on it.");
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post(`/jobs/${jobId}/question-set/auto-draft`);
      toast.success(
        `Draft v${res.data.version} compiled — ${res.data.questions.length} questions` +
          (res.data.compiledBy?.engine === "fallback" ? " (deterministic fallback)" : "")
      );
      await load(res.data._id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not compile a set");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    try {
      const res = await api.patch(`/jobs/${jobId}/question-set/${selected._id}`, {
        questions: questions.map((q) => ({ text: q.text.trim(), topic: q.topic })),
      });
      toast.success("Draft saved");
      await load(res.data._id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not save the draft");
    } finally {
      setBusy(false);
    }
  }

  async function approveSet() {
    const ok = window.confirm(
      `Approve & freeze v${selected.version}?\n\n` +
        `All ${questions.length} questions will be asked, word for word, to every candidate for this job. ` +
        `Once frozen this version can never be edited — changing it means approving a new one.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      // Save any unsaved edits first, so what gets frozen is what is on screen.
      await api.patch(`/jobs/${jobId}/question-set/${selected._id}`, {
        questions: questions.map((q) => ({ text: q.text.trim(), topic: q.topic })),
      });
      await api.post(`/jobs/${jobId}/question-set/${selected._id}/approve`);
      toast.success(`Question set v${selected.version} approved & frozen`);
      await load(selected._id);
    } catch (err) {
      const issues = err.response?.data?.issues;
      if (issues?.length) {
        const map = {};
        for (const issue of issues) {
          if (issue.index < 0) continue;
          (map[issue.index] = map[issue.index] || []).push(issue);
        }
        setIssuesByIndex(map);
        toast.error(`${issues.length} question(s) need fixing before this can be approved.`);
      } else {
        toast.error(err.response?.data?.error || "Approval failed");
      }
    } finally {
      setBusy(false);
    }
  }

  function setQuestion(key, patch) {
    setQuestions((list) => list.map((q) => (q._key === key ? { ...q, ...patch } : q)));
  }
  function removeQuestion(key) {
    setQuestions((list) => list.filter((q) => q._key !== key));
  }
  function move(index, delta) {
    setQuestions((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function addQuestion() {
    const text = newText.trim();
    if (!text) return;
    setQuestions((list) => [...list, { _key: nextKey(), text, topic: "" }]);
    setNewText("");
    newRef.current?.focus();
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const dropped = selected?.droppedAtCompile || [];

  return (
    <div className="space-y-6">
      <Link to={`/jobs/${jobId}/edit`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to job
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Interview Questions</h1>
          <p className="mt-1 text-sm text-slate-500">{job?.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={regenerate} loading={busy && !versions.length}>
            <RefreshCw className="h-4 w-4" /> {versions.length ? "Recompile from JD" : "Compile questions"}
          </Button>
          {isDraft && (
            <>
              <Button variant="secondary" onClick={saveDraft} loading={busy}>
                <Save className="h-4 w-4" /> Save draft
              </Button>
              <Button onClick={approveSet} loading={busy} disabled={!questions.length || blockingIssues.length > 0}>
                <ShieldCheck className="h-4 w-4" /> Approve &amp; Freeze
              </Button>
            </>
          )}
        </div>
      </div>

      {/* What is live right now. An unapproved set is not a broken state — the interview still
          runs on résumé claim-probes and adaptive questions — but the recruiter should know which
          of the two they are getting rather than having to infer it. */}
      {approved ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong>v{approved.version} is live.</strong> Every candidate for this job is asked these {approved.questions.length} questions,
            word for word, plus follow-ups and probes drawn from their own résumé.
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong>No approved set yet.</strong> Interviews for this job currently run on résumé claim-probes and adaptive questions only —
            which works, but candidates are not being asked an identical core set, so cross-candidate comparison is weaker. Approving the draft
            below fixes that.
          </div>
        </div>
      )}

      {!versions.length ? (
        <EmptyState
          icon={MessageSquareQuote}
          title="No question set yet"
          description="Compile the job description and the approved rubric into a core set of interview questions. You review and approve before any candidate hears them."
          action={
            <Button onClick={regenerate} loading={busy}>
              <Cpu className="h-4 w-4" /> Compile questions
            </Button>
          }
        />
      ) : (
        <>
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
              {/* Provenance — a degraded path is labelled, never quietly passed off as a compile. */}
              {selected.compiledBy?.engine === "fallback" ? (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <strong>Compiled without AI.</strong> These questions came from the job&apos;s structured fields and the standard anchors —
                    the free-text description was not read. They are perfectly askable, but read them more carefully than usual before approving.
                  </div>
                </div>
              ) : selected.compiledBy?.engine === "ai" ? (
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                  <div>
                    Compiled by <strong>{selected.compiledBy?.model}</strong> (prompt {selected.compiledBy?.promptVersion}) from the job description
                    and the approved rubric. Every question was then checked in code before it reached this screen.
                  </div>
                </div>
              ) : null}

              {/* What the vetting gate REFUSED. Shown rather than swallowed: a buyer should be able
                  to watch the safety net working, not just be told it exists. */}
              {dropped.length > 0 && (
                <Card>
                  <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-slate-900">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" /> Blocked before you saw them ({dropped.length})
                  </h2>
                  <p className="mb-3 text-xs text-slate-500">
                    The compiler proposed these and they were refused in code, so they never reached this set. Questions touching age, family,
                    religion, caste, health, immigration status, salary history or criminal record cannot be asked, whoever writes them.
                  </p>
                  <div className="space-y-2">
                    {dropped.map((d, i) => (
                      <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                        <p className="text-slate-500 line-through [overflow-wrap:anywhere]">{d.text}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {(d.codes || []).map((code) => (
                            <Badge key={code} tone="red">
                              {issueLabel(code)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {selected.frozenAt && (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <strong>Frozen {new Date(selected.frozenAt).toLocaleString()}.</strong> This version can never be edited — that is what lets you
                    say, months later, exactly what every candidate for this role was asked.
                  </div>
                </div>
              )}

              <Card>
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-bold text-slate-900">Questions ({questions.length})</h2>
                  {isDraft && (
                    <p className="text-xs text-slate-500">Asked in this order, word for word, to every candidate.</p>
                  )}
                </div>

                {isDraft && (
                  <div className="mb-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p>
                      These are the <strong>core</strong> of the interview, not all of it. Between them the interviewer follows up on whatever the
                      candidate actually said, and asks probes generated from that person&apos;s own résumé — so every candidate gets an identical
                      backbone plus questions only they will face.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  {questions.map((q, index) => {
                    const issues = issuesByIndex[index] || [];
                    return (
                      <div
                        key={q._key}
                        className={`rounded-xl border p-3 sm:p-4 ${issues.length ? "border-red-300 bg-red-50/50" : "border-slate-200"}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-2 w-5 shrink-0 text-right text-xs font-bold text-slate-500">{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            {isDraft ? (
                              <Textarea
                                rows={2}
                                value={q.text}
                                onChange={(e) => setQuestion(q._key, { text: e.target.value })}
                                aria-label={`Question ${index + 1}`}
                              />
                            ) : (
                              <p className="text-sm text-slate-700 [overflow-wrap:anywhere]">{q.text}</p>
                            )}
                            {q.topic && !isDraft && <p className="mt-1 text-xs text-slate-500">{q.topic}</p>}
                            {issues.map((issue, i) => (
                              <p key={i} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-700">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                  <strong>{issueLabel(issue.code)}.</strong> {issue.message}
                                </span>
                              </p>
                            ))}
                          </div>
                          {isDraft && (
                            <div className="flex shrink-0 flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={() => move(index, -1)}
                                disabled={index === 0}
                                aria-label={`Move question ${index + 1} up`}
                                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => move(index, 1)}
                                disabled={index === questions.length - 1}
                                aria-label={`Move question ${index + 1} down`}
                                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeQuestion(q._key)}
                                aria-label={`Remove question ${index + 1}`}
                                className="rounded p-1 text-red-500 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!questions.length && (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                    No questions on this version — recompile from the job description, or add one below.
                  </p>
                )}

                {isDraft && (
                  <div className="mt-4">
                    <Label>Add a question</Label>
                    <div className="flex gap-2">
                      <Input
                        ref={newRef}
                        value={newText}
                        placeholder="Walk me through…"
                        onChange={(e) => setNewText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addQuestion();
                          }
                        }}
                      />
                      <Button variant="secondary" onClick={addQuestion} disabled={!newText.trim()}>
                        <Plus className="h-4 w-4" /> Add
                      </Button>
                    </div>
                  </div>
                )}

                {isDraft && blockingIssues.length > 0 && (
                  <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                    <strong>
                      {blockingIssues.length} question{blockingIssues.length === 1 ? "" : "s"} cannot be approved yet.
                    </strong>{" "}
                    Fix the highlighted rows above — approval is blocked until they are askable.
                  </p>
                )}
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
