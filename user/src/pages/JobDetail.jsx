import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import api from "../api/client.js";
import { Card, Skeleton } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState(null);

  useEffect(() => {
    api.get(`/jobs/${id}`).then((res) => setJob(res.data));
  }, [id]);

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

        <Button as={Link} to={`/jobs/${job.slug || id}/apply`} size="lg" className="mt-6">
          Apply Now
        </Button>
      </Card>
    </div>
  );
}
