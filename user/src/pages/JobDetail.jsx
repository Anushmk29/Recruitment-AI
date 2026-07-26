import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import api from "../api/client.js";
import { Card, Skeleton } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  // Phase 13 fix: a failed fetch used to leave the skeleton up forever.
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    setJob(null);
    api
      .get(`/jobs/${id}`)
      .then((res) => {
        if (!cancelled) setJob(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err.response?.status === 404
            ? "This job doesn't exist or is no longer open."
            : "Could not load this job. Please check your connection and try again."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (error) {
    return (
      <div className="space-y-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Back to listings
        </Link>
        <Card className="py-10 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Job unavailable</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{error}</p>
          <Button variant="outline" className="mt-5" onClick={() => setAttempt((a) => a + 1)}>
            Try Again
          </Button>
        </Card>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-32" />
        <Card><Skeleton className="h-48 w-full" /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to listings
      </Link>

      <Card>
        <h1 className="text-2xl font-bold text-slate-900">{job.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          {job.company?.name && <span className="font-medium text-slate-600">{job.company.name}</span>}
          {job.department && <span>{job.department}</span>}
          {job.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {job.location}
            </span>
          )}
        </p>

        <div className="mt-5 border-t border-slate-100 pt-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{job.description}</p>
        </div>

        {job.requirements && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-900">Requirements</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{job.requirements}</p>
          </div>
        )}

        <Button as={Link} to={`/jobs/${job.slug || id}/apply${window.location.search}`} size="lg" className="mt-6">
          Apply Now
        </Button>
      </Card>
    </div>
  );
}
