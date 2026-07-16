import { useState } from "react";
import { Link } from "react-router-dom";
import { Users, Search } from "lucide-react";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { Input } from "../../components/ui/Field.jsx";

function statusTone(status) {
  return { applied: "slate", interview_queue: "brand", shortlisted: "green", next_round: "brand", rejected: "red" }[status] || "slate";
}

export default function CandidatesAll() {
  const { allCandidates, loading } = useCompanyData();
  const [search, setSearch] = useState("");

  const filtered = allCandidates
    .filter((c) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return c.basicDetails?.name?.toLowerCase().includes(q) || c.basicDetails?.email?.toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Candidates</h1>
          <p className="mt-1 text-sm text-slate-500">Every applicant across all your jobs.</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className="pl-9" />
        </div>
      </div>

      <Card className="p-0">
        {loading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Users} title="No candidates found" description="Applicants will appear here once they apply to your jobs." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Job</th>
                  <th className="px-6 py-3 font-medium">ATS Score</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c._id}>
                    <td className="px-6 py-3 font-medium text-slate-800">
                      <Link to={`/candidates/${c._id}`} className="hover:text-brand-700">
                        {c.basicDetails?.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-500">{c.job?.title || "—"}</td>
                    <td className="px-6 py-3">
                      {c.ats?.overallScore != null ? (
                        <Badge tone={c.ats.decision === "pass" ? "green" : c.ats.decision === "fail" ? "red" : "slate"}>
                          {c.ats.overallScore}%
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
