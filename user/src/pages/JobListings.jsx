import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, MapPin, ArrowRight } from "lucide-react";
import api from "../api/client.js";
import { Card, Skeleton, EmptyState } from "../components/ui/Card.jsx";

export default function JobListings() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/jobs/published")
      .then((res) => setJobs(res.data))
      .catch(() => setError("Failed to load jobs"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Open Positions</h1>
        <p className="mt-1 text-sm text-slate-500">Apply once — AI screening and interviews take it from there.</p>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><Skeleton className="h-16 w-full" /></Card>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState icon={Briefcase} title="No open positions right now" description="Check back soon — new roles are posted regularly." />
        </Card>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <Link key={job._id} to={`/jobs/${job.slug || job._id}`} className="block">
              <Card className="transition hover:-translate-y-0.5 hover:shadow-soft">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{job.title}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                      {job.company?.name && <span className="font-medium text-slate-600">{job.company.name}</span>}
                      {job.department && <span>{job.department}</span>}
                      {job.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {job.location}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-semibold text-brand-700">
                    View & Apply <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
