import { useState } from "react";
import { Link } from "react-router-dom";
import { Users, Search } from "lucide-react";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Avatar, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { RecordCard, RecordGrid } from "../../components/ui/Panels.jsx";
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
        <RecordGrid>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} padding="compact">
              <Skeleton className="h-20 w-full" />
            </Card>
          ))}
        </RecordGrid>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No candidates found" description="Applicants will appear here once they apply to your jobs." />
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {filtered.length} of {allCandidates.length} candidate{allCandidates.length === 1 ? "" : "s"}
          </p>
          <RecordGrid>
            {filtered.map((c) => (
              <RecordCard
                key={c._id}
                avatar={<Avatar name={c.basicDetails?.name} />}
                title={c.basicDetails?.name || "Unnamed applicant"}
                subtitle={c.job?.title || "No job on record"}
                link={{ as: Link, to: `/candidates/${c._id}` }}
                trailing={
                  // The score is the headline figure, so it sits where the eye
                  // lands first — but it stays a <Badge>, never a card fill.
                  // The Reserved Verdict Rule holds: green here means the
                  // engine's own pass decision, not "good candidate".
                  c.ats?.overallScore != null ? (
                    <Badge tone={c.ats.decision === "pass" ? "green" : c.ats.decision === "fail" ? "red" : "slate"}>
                      {c.ats.overallScore}%
                    </Badge>
                  ) : (
                    <Badge tone="slate">Not scored</Badge>
                  )
                }
                footer={
                  // The footer states what produced the number, which the old
                  // table had no column for. `engine !== "evidence"` means this
                  // job has no approved rubric and the legacy keyword matcher
                  // carried the decision — said in words, not a lone glyph.
                  c.ats?.overallScore == null
                    ? `Applied ${new Date(c.createdAt).toLocaleDateString()}`
                    : c.ats.engine === "evidence"
                      ? `Evidence engine · applied ${new Date(c.createdAt).toLocaleDateString()}`
                      : `Legacy keyword match · applied ${new Date(c.createdAt).toLocaleDateString()}`
                }
                footerTrailing={<Badge tone={stageTone(c.status)}>{stageLabel(c.status)}</Badge>}
              />
            ))}
          </RecordGrid>
        </>
      )}
    </div>
  );
}
