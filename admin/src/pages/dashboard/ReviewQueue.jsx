import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Inbox, CheckCircle2, XCircle, Scale } from "lucide-react";
import api from "../../api/client.js";
import { getSocket } from "../../lib/socket.js";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { Textarea } from "../../components/ui/Field.jsx";
import Button from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";

// Human review queue (BUILD-PLAN Phase 7.6): everything the pipeline is NOT
// confident about — review-band scores, low model agreement, ambiguous
// knock-out gates — each with its reason and evidence, resolved in one click.
// Every resolution is recorded as a labelled signal (engine said X, human
// decided Y) that later calibrates the score.

const REASON_LABELS = {
  score_in_review_band: "Score in the review band",
  low_model_agreement: "Model runs disagreed — genuinely ambiguous",
  counterfactual_leak: "Bias check flagged an input anomaly",
};

function reasonLabel(r) {
  if (REASON_LABELS[r]) return REASON_LABELS[r];
  if (r?.startsWith("disqualifier_ambiguous:")) return `Knock-out gate ambiguous: ${r.split(":")[1]}`;
  if (r?.startsWith("critic_refuted:")) return "Adversarial check weakened some evidence";
  return r;
}

export default function ReviewQueue() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const res = await api.get("/review-queue");
    setItems(res.data);
  }, []);

  useEffect(() => {
    load().catch(() => setItems([]));
  }, [load]);

  // Live-sync: a candidate's stage can change from outside this page (their
  // profile, the Hiring Pipeline board) — the backend auto-resolves the
  // matching review item when that happens, so refetch here to drop it from
  // view instead of leaving a stale entry until the next manual reload.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStage = () => load().catch(() => {});
    socket.on("candidate:stage", onStage);
    return () => socket.off("candidate:stage", onStage);
  }, [load]);

  async function resolve(item, decision) {
    setBusy(item._id + decision);
    try {
      await api.post(`/review-queue/${item._id}/resolve`, { decision, note: notes[item._id] || undefined });
      toast.success(decision === "advance" ? "Candidate advanced to interview" : "Candidate declined");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not resolve");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Review Queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Candidates the screening engine is <span className="font-medium text-slate-700">honestly unsure about</span> —
          it routed them to you instead of forcing a confident answer. Your decision is recorded and used to calibrate
          future scores.
        </p>
      </div>

      {items === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title="Queue is clear" description="Nothing needs a human decision right now." />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <Card key={item._id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Link to={`/candidates/${item.candidate?._id}`} className="text-base font-semibold text-slate-900 hover:text-brand-700">
                    {item.candidate?.basicDetails?.name || "Candidate"}
                  </Link>
                  <p className="mt-0.5 text-sm text-slate-500">{item.job?.title}</p>
                </div>
                <div className="flex items-center gap-2">
                  {item.assessment?.overallScore != null && (
                    <Badge tone="amber">Score {item.assessment.overallScore}</Badge>
                  )}
                  <Link
                    to={`/candidates/${item.candidate?._id}/score`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Scale className="h-4 w-4" /> Why this score
                  </Link>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {(item.reasons || []).map((r) => (
                  <Badge key={r} tone="slate">{reasonLabel(r)}</Badge>
                ))}
              </div>
              {item.summary && <p className="mt-2 text-sm text-slate-600">{item.summary}</p>}

              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                <div className="min-w-64 flex-1">
                  <Textarea
                    rows={1}
                    placeholder="Decision note (optional, recorded in the timeline)"
                    value={notes[item._id] || ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [item._id]: e.target.value }))}
                  />
                </div>
                <Button
                  onClick={() => resolve(item, "advance")}
                  disabled={busy !== ""}
                  className="inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="h-4 w-4" /> {busy === item._id + "advance" ? "Advancing…" : "Advance to interview"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => resolve(item, "decline")}
                  disabled={busy !== ""}
                  className="inline-flex items-center gap-1.5 !text-red-600"
                >
                  <XCircle className="h-4 w-4" /> {busy === item._id + "decline" ? "Declining…" : "Decline"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
