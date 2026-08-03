import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, MapPin, Building2, Clock, GraduationCap } from "lucide-react";
import api from "../api/client.js";
import { Card, Skeleton, IconTile } from "../components/ui/Card.jsx";
import { TokenList, MetaItem } from "../components/ui/Panels.jsx";
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
        <div className="flex items-start gap-4">
          <IconTile icon={Building2} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">{job.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {job.company?.name && <span className="font-medium text-slate-600">{job.company.name}</span>}
              {job.company?.name && job.department ? " · " : ""}
              {job.department}
            </p>
          </div>
        </div>

        {/* Location is stated once, in the meta line — same call as the listing
            card, for the same reason. */}
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <MetaItem icon={MapPin}>{job.location}</MetaItem>
          <MetaItem icon={Clock}>
            {job.minExperienceYears > 0 ? `${job.minExperienceYears}+ yrs experience` : "No minimum experience"}
          </MetaItem>
          <MetaItem icon={GraduationCap}>{job.requiredEducation}</MetaItem>
        </div>

        {/* The full list, not the listing card's truncated set. This is the page
            someone reads before deciding to apply — every skill they'll be
            screened against belongs on it. */}
        <TokenList className="mt-5" label="Skills this role asks for" items={job.requiredSkills} max={Infinity} />

        <div className="mt-6 border-t border-slate-100 pt-6">
          <h2 className="text-sm font-semibold text-slate-900">About this role</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{job.description}</p>
        </div>

        {job.requirements && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-canvas p-5">
            <h2 className="text-sm font-semibold text-slate-900">Requirements</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{job.requirements}</p>
          </div>
        )}

        <div className="mt-6 border-t border-slate-100 pt-6">
          <Button as={Link} to={`/jobs/${job.slug || id}/apply${window.location.search}`} size="lg">
            Apply Now
          </Button>
          <p className="mt-2.5 text-xs text-slate-500">
            You'll be asked for your details and a resume. Screening starts as soon as you submit.
          </p>
        </div>
      </Card>
    </div>
  );
}
