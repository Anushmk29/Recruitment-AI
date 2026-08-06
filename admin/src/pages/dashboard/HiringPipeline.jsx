import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { KanbanSquare } from "lucide-react";
import api from "../../api/client.js";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import StageMenu from "../../components/ui/StageMenu.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { ALL_STAGES, stageLabel, stageTone, normalizeStage } from "../../lib/pipeline.js";

// Stages hidden by default keep the board readable; the automated top-of-funnel
// stages (applied / ats_passed) are collapsed into their own toggle.
const PRIMARY_STAGES = ALL_STAGES;

function CandidateCard({ candidate, onMove, busy }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <Link to={`/candidates/${candidate._id}`} className="text-sm font-semibold text-slate-800 hover:text-brand-700">
        {candidate.basicDetails?.name}
      </Link>
      <p className="truncate text-xs text-slate-500">{candidate.job?.title || "—"}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {candidate.ats?.overallScore != null ? (
          <Badge tone={candidate.ats.decision === "pass" ? "green" : candidate.ats.decision === "fail" ? "red" : "slate"}>
            ATS {candidate.ats.overallScore}%
          </Badge>
        ) : (
          <span className="text-xs text-slate-500">No ATS</span>
        )}
        {/* Compact: the column is 288px, so the button label goes generic and
            the destination lives in the accessible name. The menu itself is
            portalled — an absolutely-positioned one would be clipped by this
            board's `overflow-x-auto` rail. */}
        <StageMenu
          compact
          status={candidate.status}
          name={candidate.basicDetails?.name}
          busy={busy}
          onMove={(stage) => onMove(candidate, stage)}
        />
      </div>
    </div>
  );
}

export default function HiringPipeline() {
  const { allCandidates, loading, refresh } = useCompanyData();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  const columns = useMemo(() => {
    const grouped = Object.fromEntries(PRIMARY_STAGES.map((s) => [s, []]));
    for (const c of allCandidates) {
      const stage = normalizeStage(c.status);
      if (grouped[stage]) grouped[stage].push(c);
    }
    return grouped;
  }, [allCandidates]);

  async function handleMove(candidate, toStage) {
    setBusyId(candidate._id);
    try {
      await api.patch(`/candidates/${candidate._id}/stage`, { stage: toStage });
      toast.success(`${candidate.basicDetails?.name} → ${stageLabel(toStage)}`);
      await refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not move candidate");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Hiring Pipeline</h1>
        <p className="mt-1 text-sm text-slate-500">Every candidate across all jobs, grouped by hiring stage. Move them forward as they progress.</p>
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-72 shrink-0" />
          ))}
        </div>
      ) : allCandidates.length === 0 ? (
        <Card>
          <EmptyState icon={KanbanSquare} title="No candidates yet" description="Applicants appear here and flow through the pipeline as you move them." />
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PRIMARY_STAGES.map((stage) => (
            <div key={stage} className="flex w-72 shrink-0 flex-col rounded-2xl bg-slate-50 p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-slate-700">{stageLabel(stage)}</span>
                <Badge tone={stageTone(stage)}>{columns[stage].length}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {columns[stage].length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-slate-300">—</p>
                ) : (
                  columns[stage].map((c) => (
                    <CandidateCard key={c._id} candidate={c} onMove={handleMove} busy={busyId === c._id} />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
