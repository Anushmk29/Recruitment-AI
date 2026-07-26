import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Users, Pencil, Trash2, UploadCloud, Briefcase, Link2, Globe2, X } from "lucide-react";
import api from "../api/client.js";
import { useToast } from "../components/ui/Toast.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

const CANDIDATE_PORTAL_URL = import.meta.env.VITE_CANDIDATE_PORTAL_URL || "http://localhost:5174";

// Phase 15.1 — every shared apply link carries its source, so the funnel can
// report per-source quality (pass rate, claim-verification rate) later.
const LINK_SOURCES = [
  { key: "careers", label: "Careers page" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "naukri", label: "Naukri" },
  { key: "referral", label: "Referral" },
  { key: "other", label: "Other" },
];

function buildApplyUrl(job, src) {
  const base = `${CANDIDATE_PORTAL_URL}/jobs/${job.slug || job._id}`;
  return src ? `${base}?src=${encodeURIComponent(src)}` : base;
}

const PUB_STATUS_TONE = { published: "green", pending: "amber", failed: "red", expired: "slate", withdrawn: "slate" };

// Phase 15.7 — per-board publish panel. One action publishes to N boards;
// per-board status/failure is visible per board, never silent.
function PublishBoardsModal({ job, onClose }) {
  const toast = useToast();
  const [boards, setBoards] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/jobs/${job._id}/publications`);
      setBoards(res.data.boards);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not load board status");
    }
  }, [job._id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function publishSelected() {
    const chosen = Object.keys(selected).filter((k) => selected[k]);
    if (!chosen.length) return;
    setBusy(true);
    try {
      await api.post(`/jobs/${job._id}/publish-boards`, { boards: chosen });
      toast.success("Publishing dispatched — statuses update per board");
      setSelected({});
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not publish");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(board) {
    setBusy(true);
    try {
      await api.post(`/jobs/${job._id}/withdraw-board`, { board });
      toast.success(`Withdrawn from ${board}`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not withdraw");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Publish "{job.title}" to boards</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {!boards ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-2.5">
            {boards.map((b) => {
              const blocked =
                !b.enabled || (b.needsCredential && !b.credentialConfigured) || b.validationErrors.length > 0;
              return (
                <div key={b.board} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        disabled={blocked}
                        checked={!!selected[b.board]}
                        onChange={(e) => setSelected((s) => ({ ...s, [b.board]: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                      {b.name}
                      <Badge tone="slate">Tier {b.tier}</Badge>
                    </label>
                    {b.status && <Badge tone={PUB_STATUS_TONE[b.status] || "slate"}>{b.status}</Badge>}
                  </div>
                  {!b.enabled && <p className="mt-1.5 pl-6 text-xs text-amber-600">{b.reason}</p>}
                  {b.enabled && b.needsCredential && !b.credentialConfigured && (
                    <p className="mt-1.5 pl-6 text-xs text-slate-400">
                      Connect this board's credentials in Settings → Integrations first.
                    </p>
                  )}
                  {b.validationErrors.map((e) => (
                    <p key={e} className="mt-1.5 pl-6 text-xs text-red-600">{e}</p>
                  ))}
                  {b.error && <p className="mt-1.5 pl-6 text-xs text-red-600">Last attempt: {b.error}</p>}
                  {b.externalUrl && b.status === "published" && (
                    <a href={b.externalUrl} target="_blank" rel="noreferrer" className="mt-1.5 block pl-6 text-xs font-medium text-brand-700 hover:underline">
                      View live listing ↗
                    </a>
                  )}
                  {b.status === "published" && (
                    <button onClick={() => withdraw(b.board)} disabled={busy} className="mt-1.5 pl-6 text-xs font-medium text-slate-400 hover:text-red-600">
                      Withdraw from this board
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" loading={busy} onClick={publishSelected} disabled={!boards || Object.values(selected).every((v) => !v)}>
            Publish Selected
          </Button>
        </div>
      </div>
    </div>
  );
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

  const [linkPickerFor, setLinkPickerFor] = useState(null); // job._id with the source picker open
  const [publishModalJob, setPublishModalJob] = useState(null); // job with the boards modal open

  async function handleCopyApplyLink(job, src) {
    setLinkPickerFor(null);
    try {
      await navigator.clipboard.writeText(buildApplyUrl(job, src));
      toast.success(src ? `${src} apply link copied` : "Apply link copied");
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
                            onClick={() => setPublishModalJob(job)}
                            className="text-slate-400 hover:text-brand-700"
                            title="Publish to Job Boards"
                          >
                            <Globe2 className="h-4 w-4" />
                          </button>
                        )}
                        {job.status === "published" && (
                          <span className="relative">
                            <button
                              onClick={() => setLinkPickerFor(linkPickerFor === job._id ? null : job._id)}
                              className="text-slate-400 hover:text-brand-700"
                              title="Copy Apply Link"
                            >
                              <Link2 className="h-4 w-4" />
                            </button>
                            {linkPickerFor === job._id && (
                              <span
                                className="absolute right-0 top-6 z-20 w-44 rounded-xl border border-slate-200 bg-white py-1.5 shadow-soft"
                                onMouseLeave={() => setLinkPickerFor(null)}
                              >
                                {LINK_SOURCES.map((s) => (
                                  <button
                                    key={s.key}
                                    onClick={() => handleCopyApplyLink(job, s.key)}
                                    className="block w-full px-3.5 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50"
                                  >
                                    {s.label} link
                                  </button>
                                ))}
                                <button
                                  onClick={() => handleCopyApplyLink(job)}
                                  className="block w-full border-t border-slate-100 px-3.5 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-50"
                                >
                                  Untagged link
                                </button>
                              </span>
                            )}
                          </span>
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

      {publishModalJob && <PublishBoardsModal job={publishModalJob} onClose={() => setPublishModalJob(null)} />}
    </div>
  );
}
