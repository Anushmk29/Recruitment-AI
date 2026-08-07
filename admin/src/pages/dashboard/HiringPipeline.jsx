import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { KanbanSquare, Eye, EyeOff } from "lucide-react";
import api from "../../api/client.js";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { RecordCard, Chip } from "../../components/ui/Panels.jsx";
import StageMenu from "../../components/ui/StageMenu.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { ALL_STAGES, REJECTED, stageLabel, stageTone, stageStep, normalizeStage } from "../../lib/pipeline.js";

// One card per candidate, built from the app's own record card rather than a
// bespoke board tile. The slots are the ones every other list screen uses —
// name, role, score top-right, stage control at the foot — so a recruiter who
// has learned the candidate list has already learned this board. It also brings
// the stretched link with it: the whole card is the target, not the ~120px of
// name text that used to be the only clickable thing in a 288px column.
function CandidateCard({ candidate, onMove, busy }) {
  return (
    <RecordCard
      title={candidate.basicDetails?.name || "Unnamed applicant"}
      subtitle={candidate.job?.title || "No job on record"}
      link={{ as: Link, to: `/candidates/${candidate._id}` }}
      trailing={
        candidate.ats?.overallScore != null ? (
          <Badge
            tone={
              candidate.ats.decision === "pass" ? "green" : candidate.ats.decision === "fail" ? "red" : "slate"
            }
            className="tabular-nums"
          >
            {candidate.ats.overallScore}%
          </Badge>
        ) : (
          // Not a zero. A candidate the engine never scored and a candidate it
          // scored 0 are different claims, and only one of them is a
          // measurement.
          <Badge tone="slate">Not scored</Badge>
        )
      }
      actions={
        // Compact: the column is 288px, so the button label goes generic and
        // the destination lives in the accessible name. The menu itself is
        // portalled — an absolutely-positioned one would be clipped by this
        // board's `overflow-x-auto` rail, and now also by the column's own
        // `overflow-y-auto` body.
        <StageMenu
          compact
          status={candidate.status}
          name={candidate.basicDetails?.name}
          busy={busy}
          onMove={(stage) => onMove(candidate, stage)}
        />
      }
    />
  );
}

/**
 * One stage column.
 *
 * The column is a WELL, not a panel: slate ground behind a hairline, no shadow
 * of its own. Depth on this screen runs one way — the board recedes, the cards
 * a recruiter actually acts on sit on top of it at `shadow-card`. Giving the
 * column a shadow too would put both planes at the same height and flatten the
 * only distinction that matters here.
 *
 * The header sits OUTSIDE the scrolling body rather than being `sticky` inside
 * it. Same result — the stage name never leaves the screen — with none of the
 * stacking-context trouble sticky brings to a rail that also scrolls sideways.
 */
function StageColumn({ stage, candidates, onMove, busyId }) {
  const step = stageStep(stage);
  const terminal = stage === REJECTED;

  return (
    <section
      aria-label={`${stageLabel(stage)} — ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`}
      // `snap-start` so a sideways flick lands on a column edge instead of
      // halfway through one. On a 16-stage pipeline that is the difference
      // between reading the board and hunting for it.
      className={`flex w-72 shrink-0 snap-start flex-col rounded-2xl bg-slate-50 p-3 ${
        // The off-ramp is drawn as an off-ramp. `rejected` is not step 16 of the
        // pipeline — it is the exit, and a dashed edge says so without spending
        // a colour to say it.
        terminal ? "border border-dashed border-slate-300" : "border border-slate-200"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          {/* The ordinal is the orientation cue. Sixteen columns in a horizontal
              rail otherwise give a recruiter no way to know how far along they
              have scrolled; "07" does, and it is the same numbering the
              candidate-facing StepTrack and the stage menu already use. */}
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">
            {step ? String(step).padStart(2, "0") : "—"}
          </span>
          <h2 className="truncate text-sm font-semibold text-slate-700">{stageLabel(stage)}</h2>
        </div>
        <Badge tone={stageTone(stage)}>{candidates.length}</Badge>
      </div>

      {/* The column scrolls, not the page. Before this, one busy stage made the
          whole board as tall as its longest column and every other stage became
          a screenful of empty ground you had to scroll past to reach the rail
          again. Capped at 60vh so the board is always one screen. */}
      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto overscroll-contain">
        {candidates.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">No candidates at this stage</p>
        ) : (
          candidates.map((c) => (
            <CandidateCard key={c._id} candidate={c} onMove={onMove} busy={busyId === c._id} />
          ))
        )}
      </div>
    </section>
  );
}

export default function HiringPipeline() {
  const { allCandidates, loading, refresh } = useCompanyData();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  // Default to the stages that actually hold someone. A 16-column rail where 12
  // columns read "0" is not a picture of a pipeline, it is a scrolling task —
  // and the four that matter are usually the four furthest from where the rail
  // starts. Hiding is reversible in one click and always states its own count,
  // so nothing is quietly withheld.
  const [showEmpty, setShowEmpty] = useState(false);

  const columns = useMemo(() => {
    const grouped = Object.fromEntries(ALL_STAGES.map((s) => [s, []]));
    for (const c of allCandidates) {
      const stage = normalizeStage(c.status);
      if (grouped[stage]) grouped[stage].push(c);
    }
    return grouped;
  }, [allCandidates]);

  const occupied = ALL_STAGES.filter((s) => columns[s].length > 0);
  // If nothing is occupied there is nothing to hide — showing an empty board
  // with "0 of 16 stages" would be a worse answer than showing the pipeline.
  const visibleStages = showEmpty || occupied.length === 0 ? ALL_STAGES : occupied;
  const hiddenCount = ALL_STAGES.length - visibleStages.length;

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Hiring Pipeline</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every candidate across all jobs, grouped by hiring stage. Move them forward as they progress.
          </p>
        </div>

        {!loading && allCandidates.length > 0 && (hiddenCount > 0 || showEmpty) && (
          <div className="flex flex-wrap items-center gap-3">
            {/* The count is stated whether or not anything is hidden, so the
                board never looks complete while it is not. */}
            <span className="text-xs text-slate-500">
              Showing {visibleStages.length} of {ALL_STAGES.length} stages
            </span>
            {/* Deliberately NOT `active`. The chip's label is the action it
                takes; the sentence beside it is the state. A filled pill
                reading "Show all stages" says both at once and means neither.
                The label also names the exact number being withheld, so the
                board can never be quietly shorter than the pipeline. */}
            <Chip icon={showEmpty ? EyeOff : Eye} onClick={() => setShowEmpty((v) => !v)}>
              {showEmpty
                ? "Hide empty stages"
                : `Show ${hiddenCount} empty stage${hiddenCount === 1 ? "" : "s"}`}
            </Chip>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-72 shrink-0" />
          ))}
        </div>
      ) : allCandidates.length === 0 ? (
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="No candidates yet"
            description="Applicants appear here and flow through the pipeline as you move them."
          />
        </Card>
      ) : (
        <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-4">
          {visibleStages.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              candidates={columns[stage]}
              onMove={handleMove}
              busyId={busyId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
