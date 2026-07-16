import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Users, Pencil, Trash2, UploadCloud, Briefcase, Link2 } from "lucide-react";
import api from "../api/client.js";
import { useToast } from "../components/ui/Toast.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

const CANDIDATE_PORTAL_URL = import.meta.env.VITE_CANDIDATE_PORTAL_URL || "http://localhost:5174";

function buildApplyUrl(job) {
  return `${CANDIDATE_PORTAL_URL}/jobs/${job.slug || job._id}`;
}

export default function JobList() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();

  function loadJobs() {
    setLoading(true);
    api
      .get("/jobs")
      .then((res) => setJobs(res.data))
      .catch(() => setError("Failed to load jobs"))
      .finally(() => setLoading(false));
  }

  useEffect(loadJobs, []);

  async function handlePublish(id) {
    await api.patch(`/jobs/${id}/publish`);
    toast.success("Job published");
    loadJobs();
  }

  async function handleDelete(id) {
    if (!confirm("Delete this job?")) return;
    await api.delete(`/jobs/${id}`);
    toast.success("Job deleted");
    loadJobs();
  }

  async function handleCopyApplyLink(job) {
    try {
      await navigator.clipboard.writeText(buildApplyUrl(job));
      toast.success("Apply link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
          <p className="mt-1 text-sm text-slate-500">Manage your open roles and track applicants.</p>
        </div>
        <Button as={Link} to="/jobs/new">
          <Plus className="h-4 w-4" /> New Job
        </Button>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <Card className="p-0">
        {loading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Briefcase}
              title="No jobs yet"
              description="Create your first job posting to start receiving applications."
              action={
                <Button as={Link} to="/jobs/new">
                  <Plus className="h-4 w-4" /> New Job
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Title</th>
                  <th className="px-6 py-3 font-medium">Department</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Candidates</th>
                  <th className="px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <tr key={job._id}>
                    <td className="px-6 py-3 font-medium text-slate-800">{job.title}</td>
                    <td className="px-6 py-3 text-slate-500">{job.department || "—"}</td>
                    <td className="px-6 py-3">
                      <Badge tone={job.status === "published" ? "green" : "amber"}>{job.status}</Badge>
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        to={`/jobs/${job._id}/candidates`}
                        className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                      >
                        <Users className="h-3.5 w-3.5" /> View
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Link to={`/jobs/${job._id}/edit`} className="text-slate-400 hover:text-brand-700" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Link>
                        {job.status === "published" && (
                          <button
                            onClick={() => handleCopyApplyLink(job)}
                            className="text-slate-400 hover:text-brand-700"
                            title="Copy Apply Link"
                          >
                            <Link2 className="h-4 w-4" />
                          </button>
                        )}
                        {job.status !== "published" && (
                          <button onClick={() => handlePublish(job._id)} className="text-slate-400 hover:text-emerald-600" title="Publish">
                            <UploadCloud className="h-4 w-4" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(job._id)} className="text-slate-400 hover:text-red-600" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
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
