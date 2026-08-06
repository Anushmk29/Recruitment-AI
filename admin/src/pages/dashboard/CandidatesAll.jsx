import { useState } from "react";
import { Link } from "react-router-dom";
import { Users, Search, AlertTriangle } from "lucide-react";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Avatar, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { RecordRow, RecordList } from "../../components/ui/Panels.jsx";
import { Input, Select } from "../../components/ui/Field.jsx";
import { ALL_STAGES, stageLabel, stageTone, normalizeStage } from "../../lib/pipeline.js";

export default function CandidatesAll() {
  const { allCandidates, loading } = useCompanyData();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");

  const filtered = allCandidates
    .filter((c) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q || c.basicDetails?.name?.toLowerCase().includes(q) || c.basicDetails?.email?.toLowerCase().includes(q);
      const matchesStage = stageFilter === "all" || normalizeStage(c.status) === stageFilter;
      return matchesSearch && matchesStage;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Candidates</h1>
          <p className="mt-1 text-sm text-slate-500">Every applicant across all your jobs.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className="pl-9" />
          </div>
          <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="w-auto">
            <option value="all">All stages</option>
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading ? (
        <Card padding="none" className="divide-y divide-slate-100 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No candidates found" description="Applicants will appear here once they apply to your jobs." />
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {filtered.length} of {allCandidates.length} candidate{allCandidates.length === 1 ? "" : "s"}
          </p>
          <RecordList label="All candidates">
            {filtered.map((c) => (
              <RecordRow
                key={c._id}
                avatar={<Avatar name={c.basicDetails?.name} size="sm" />}
                title={c.basicDetails?.name || "Unnamed applicant"}
                subtitle={c.job?.title || "No job on record"}
                link={{ as: Link, to: `/candidates/${c._id}` }}
                meta={[
                  { label: "Applied", value: new Date(c.createdAt).toLocaleDateString() },
                  // What produced the number, as its own column. `engine !==
                  // "evidence"` means this job has no approved rubric and the
                  // legacy keyword matcher carried the decision.
                  {
                    label: "Scored by",
                    value: c.ats?.overallScore == null ? null : c.ats.engine === "evidence" ? "Evidence engine" : "Keyword match",
                  },
                ]}
                trailing={
                  <>
                    {/* The score is the headline figure, so it sits where the
                        eye lands first — but it stays a <Badge>, never a fill.
                        The Reserved Verdict Rule holds: green here means the
                        engine's own pass decision, not "good candidate". */}
                    {c.ats?.overallScore != null ? (
                      <Badge tone={c.ats.decision === "pass" ? "green" : c.ats.decision === "fail" ? "red" : "slate"}>
                        {c.ats.overallScore}%
                      </Badge>
                    ) : (
                      <Badge tone="slate">Not scored</Badge>
                    )}
                    <Badge tone={stageTone(c.status)}>{stageLabel(c.status)}</Badge>
                  </>
                }
                note={
                  // Below `lg` the "Scored by" column is dropped, and a legacy
                  // score must not silently lose its caveat with it — that is
                  // the one thing the Honest Reading Rule will not absorb. On a
                  // narrow viewport it comes back as a sentence.
                  c.ats?.overallScore != null && c.ats.engine !== "evidence" ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 lg:hidden">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Legacy keyword match — rubric not approved
                    </span>
                  ) : null
                }
              />
            ))}
          </RecordList>
        </>
      )}
    </div>
  );
}
