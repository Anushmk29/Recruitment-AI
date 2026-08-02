import { useState } from "react";
import { Link } from "react-router-dom";
import { Bot, ExternalLink, Cpu } from "lucide-react";
import api from "../../api/client.js";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";

export default function AIInterviews() {
  const { queue, loading, refresh } = useCompanyData();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  async function removeFromQueue(id) {
    setBusyId(id);
    try {
      await api.patch(`/interview-queue/${id}`, { status: "removed" });
      toast.success("Removed from interview queue");
      await refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not update queue entry");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">AI Interviews</h1>
        <p className="mt-1 text-sm text-slate-500">Candidates who passed ATS screening and are queued for an AI interview.</p>
      </div>

      <Card className="p-0">
        {loading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Bot}
              title="No one in the queue yet"
              description="Candidates land here automatically once they pass your ATS threshold for a job."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-6 py-3 font-semibold">Candidate</th>
                  <th className="px-6 py-3 font-semibold">Job</th>
                  <th className="px-6 py-3 font-semibold">ATS Score</th>
                  <th className="px-6 py-3 font-semibold">Queued</th>
                  <th className="px-6 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((entry) => (
                  <tr key={entry._id}>
                    <td className="px-6 py-3 font-medium text-slate-800">
                      <Link to={`/candidates/${entry.candidate?._id}`} className="hover:text-brand-700">
                        {entry.candidate?.basicDetails?.name || "—"}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-500">{entry.job?.title || "—"}</td>
                    <td className="px-6 py-3">
                      <Badge tone="brand">{entry.atsScore ?? entry.candidate?.ats?.overallScore ?? "—"}%</Badge>
                    </td>
                    <td className="px-6 py-3 text-slate-500">{new Date(entry.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <Button
                          as={Link}
                          to={`/candidates/${entry.candidate?._id}`}
                          variant="outline"
                          size="sm"
                        >
                          View <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          as={Link}
                          to={`/candidates/${entry.candidate?._id}/interview-report`}
                          variant="ghost"
                          size="sm"
                        >
                          <Cpu className="h-3.5 w-3.5" /> Report
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busyId === entry._id}
                          onClick={() => removeFromQueue(entry._id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
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
