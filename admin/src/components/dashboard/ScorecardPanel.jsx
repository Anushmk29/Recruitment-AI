import { useCallback, useEffect, useState } from "react";
import {
  UserPlus,
  Send,
  RefreshCw,
  X,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Info,
} from "lucide-react";
import api from "../../api/client.js";
import { Card, Badge } from "../ui/Card.jsx";
import { Input, Select, Label, FormGroup } from "../ui/Field.jsx";
import Button from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import { ROUND_STAGES, stageLabel } from "../../lib/pipeline.js";

// Human interview rounds: invite a panelist, track who has filled theirs in, and
// read the Evidence Ledger.
//
// The ledger is the point of the whole feature — one grid where a machine verdict
// and a human verdict sit in the same vocabulary, each naming its evidence. Note
// what is deliberately absent: there is no control here that lets a recruiter
// edit or override someone else's observation. A correction is a new scorecard.

const DECISION_TONE = { advance: "green", hold: "amber", decline: "red" };

function statusTone(status) {
  if (status === "submitted") return "green";
  if (status === "cancelled") return "slate";
  return "amber";
}

export default function ScorecardPanel({ candidateId, enabled = true }) {
  const toast = useToast();
  const [scorecards, setScorecards] = useState([]);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState("");

  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ stage: ROUND_STAGES[0], name: "", email: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        api.get(`/scorecards/candidate/${candidateId}`),
        api.get(`/scorecards/candidate/${candidateId}/ledger`),
      ]);
      setScorecards(a.data.scorecards || []);
      setLedger(b.data);
      setUnavailable("");
    } catch (err) {
      // 404 = the feature flag is off on this deployment. Say so honestly rather
      // than rendering an empty panel that reads like "no rounds happened".
      setUnavailable(
        err.response?.status === 404
          ? "Round scorecards are not enabled on this workspace."
          : err.response?.data?.error || "Could not load scorecards."
      );
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    if (enabled) load();
    else setLoading(false);
  }, [enabled, load]);

  async function invite(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/scorecards", {
        candidateId,
        stage: form.stage,
        interviewer: { name: form.name, email: form.email },
      });
      toast.success(`Scorecard sent to ${form.name}`);
      setForm({ stage: ROUND_STAGES[0], name: "", email: "" });
      setInviting(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not send the scorecard");
    } finally {
      setBusy(false);
    }
  }

  async function act(id, path, okMessage) {
    setBusy(true);
    try {
      await api.post(`/scorecards/${id}/${path}`);
      toast.success(okMessage);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled || unavailable) return null;
  if (loading) return null;

  const submitted = scorecards.filter((s) => s.status === "submitted");
  const open = scorecards.filter((s) => s.status === "open");

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">Interview Rounds</h3>
        <Button size="sm" variant="secondary" onClick={() => setInviting((v) => !v)}>
          <UserPlus className="h-4 w-4" />
          Invite interviewer
        </Button>
      </div>

      {inviting && (
        <form onSubmit={invite} className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormGroup>
              <Label>Round</Label>
              <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {ROUND_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </Select>
            </FormGroup>
            <FormGroup>
              <Label>Interviewer name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Priya Nair"
                required
              />
            </FormGroup>
            <FormGroup>
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="priya@company.com"
                required
              />
            </FormGroup>
          </div>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            They get a link — no account needed. The form carries this role&apos;s approved criteria and the
            claims still worth probing, and it stays blind to the engine&apos;s score until they submit.
          </p>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" loading={busy}>
              <Send className="h-4 w-4" />
              Send scorecard
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setInviting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {scorecards.length === 0 ? (
        <p className="text-sm text-slate-500">
          No interview rounds recorded yet. Invite an interviewer to capture one.
        </p>
      ) : (
        <>
          {/* Awaiting */}
          {open.length > 0 && (
            <div className="mb-4 space-y-2">
              {open.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2"
                >
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold text-slate-800">{s.interviewer.name}</span>
                    <span className="text-slate-500"> · {stageLabel(s.stage)}</span>
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700">
                      <Clock className="h-3 w-3" />
                      {s.openedAt ? "opened, not submitted" : "not opened yet"}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(s.id, "resend", "A fresh link was sent")}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Resend
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(s.id, "cancel", "Scorecard withdrawn")}>
                      <X className="h-3.5 w-3.5" />
                      Withdraw
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Submitted rounds */}
          {submitted.map((s) => (
            <div key={s.id} className="mb-3 rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-semibold text-slate-800">{s.interviewer.name}</span>
                  <span className="text-slate-500"> · {stageLabel(s.stage)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {s.rollup?.score === null || s.rollup?.score === undefined ? (
                    <Badge tone="slate">Not scored</Badge>
                  ) : (
                    <Badge tone="brand">{s.rollup.score}/100</Badge>
                  )}
                  <Badge tone={DECISION_TONE[s.decision] || "slate"}>{s.decision}</Badge>
                </div>
              </div>

              {s.rollup?.withheldReason && (
                <p className="mt-1.5 text-xs text-slate-500">{s.rollup.withheldReason}</p>
              )}
              {s.decisionReason && (
                <p className="mt-1.5 text-xs text-slate-600">
                  <strong>Reason:</strong> {s.decisionReason}
                </p>
              )}

              {/* Engine vs human — recorded, never reconciled by code */}
              {s.disagreement?.delta !== null && s.disagreement?.delta !== undefined && (
                <p
                  className={`mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
                    Math.abs(s.disagreement.delta) >= 25
                      ? "bg-amber-50 text-amber-800"
                      : "bg-slate-50 text-slate-600"
                  }`}
                >
                  {Math.abs(s.disagreement.delta) >= 25 && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  {s.disagreement.delta === 0
                    ? "Interviewer and engine agreed."
                    : `Interviewer rated ${Math.abs(s.disagreement.delta)} points ${
                        s.disagreement.direction === "human_higher" ? "higher" : "lower"
                      } than the engine (${s.disagreement.engineScore}). Recorded, not reconciled.`}
                </p>
              )}

              {s.rollup?.reproducibilityHash && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <ShieldCheck className="h-3 w-3" />
                  Computed by code from rubric v{s.rubricVersion} · record {s.rollup.reproducibilityHash.slice(0, 12)}
                </p>
              )}
            </div>
          ))}

          {/* The Evidence Ledger */}
          {ledger?.available && ledger.rounds.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-semibold text-slate-800">Evidence ledger</h4>
              {/* One card per criterion, each holding a cell per round.
                  The cross-tab it replaced compared rounds along a row, which is
                  the comparison that matters — so the cells stay side by side
                  inside the card and only stack once the viewport can't hold
                  them. What the card adds is room for the interviewer's note at
                  a readable width instead of the 220px a table column allowed. */}
              <div className="space-y-2.5">
                {ledger.criteria.map((c) => (
                  <div key={c.criterionId} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-slate-800">{c.label}</span>
                      <span className="text-xs text-slate-500">{Math.round(c.weight * 100)}% of the rubric</span>
                    </div>

                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {c.cells.map((cell, i) => {
                        const round = ledger.rounds[i];
                        return (
                          <div key={cell.roundId} className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="text-[11px] font-semibold text-slate-500">
                              {round ? stageLabel(round.stage) : "Round"}
                              {round?.interviewer && (
                                <span className="font-normal"> · {round.interviewer}</span>
                              )}
                            </p>
                            {!cell.assessed ? (
                              // Rule 5: an unassessed criterion is labelled, never
                              // left blank in a way that reads as a zero.
                              <p className="mt-1 text-xs italic text-slate-500">not assessed</p>
                            ) : (
                              <>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{cell.rating}/5</p>
                                {cell.note && <p className="mt-0.5 text-xs text-slate-500">{cell.note}</p>}
                                {cell.claimVerdicts?.map((v) => (
                                  <span
                                    key={v.claimId}
                                    className={`mt-1 mr-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                      v.verdict === "verified"
                                        ? "bg-emerald-50 text-emerald-700"
                                        : v.verdict === "contradicted"
                                          ? "bg-red-50 text-red-700"
                                          : "bg-slate-100 text-slate-500"
                                    }`}
                                  >
                                    {v.verdict === "verified" && <CheckCircle2 className="h-3 w-3" />}
                                    {v.verdict}
                                  </span>
                                ))}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Every cell names the person who observed it and what they saw. Ratings are per-criterion; the
                round score is computed from them in code, never entered by hand.
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
