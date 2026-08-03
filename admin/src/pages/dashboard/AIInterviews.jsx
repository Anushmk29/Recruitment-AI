import { useState } from "react";
import { Link } from "react-router-dom";
import { Bot, ExternalLink, Cpu } from "lucide-react";
import api from "../../api/client.js";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Avatar, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { RecordCard, RecordGrid } from "../../components/ui/Panels.jsx";
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

      {loading ? (
        <RecordGrid>
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} padding="compact">
              <Skeleton className="h-28 w-full" />
            </Card>
          ))}
        </RecordGrid>
      ) : queue.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No one in the queue yet"
          description="Candidates land here automatically once they pass your ATS threshold for a job."
        />
      ) : (
        <RecordGrid>
          {queue.map((entry) => (
            <RecordCard
              key={entry._id}
              avatar={<Avatar name={entry.candidate?.basicDetails?.name} />}
              title={entry.candidate?.basicDetails?.name || "Unnamed candidate"}
              subtitle={entry.job?.title || "No job on record"}
              link={{ as: Link, to: `/candidates/${entry.candidate?._id}` }}
              trailing={
                (entry.atsScore ?? entry.candidate?.ats?.overallScore) != null ? (
                  <Badge tone="brand">{entry.atsScore ?? entry.candidate?.ats?.overallScore}%</Badge>
                ) : (
                  <Badge tone="slate">Not scored</Badge>
                )
              }
              footer={`Queued ${new Date(entry.createdAt).toLocaleDateString()}`}
              actions={
                <>
                  <Button as={Link} to={`/candidates/${entry.candidate?._id}`} variant="outline" size="sm">
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
                </>
              }
            />
          ))}
        </RecordGrid>
      )}
    </div>
  );
}
