import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, MapPin, ArrowRight, Building2, GraduationCap, Clock } from "lucide-react";
import api from "../api/client.js";
import { Card, Skeleton, EmptyState, IconTile } from "../components/ui/Card.jsx";
import { PageHero, TokenList, MetaItem } from "../components/ui/Panels.jsx";

// Reads as a sentence next to the icon. `0` is a real answer here — "open to
// all experience levels" — and is worth saying rather than hiding the row.
function experienceLabel(years) {
  if (years == null) return null;
  return years > 0 ? `${years}+ yrs experience` : "No minimum experience";
}

function JobCard({ job }) {
  const to = `/jobs/${job.slug || job._id}`;

  return (
    // `relative` + the stretched link below: the whole card is the hit area,
    // but only ONE link is in the accessibility tree, named by the job title.
    // Wrapping the card in <Link> instead would swallow the meta text into the
    // link name and give a screen-reader user a single 40-word target.
    <Card interactive className="relative flex h-full flex-col">
      <div className="flex items-start gap-4">
        <IconTile icon={Building2} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-snug font-semibold text-slate-900">
            <Link
              to={to}
              className="rounded after:absolute after:inset-0 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
            >
              {job.title}
            </Link>
          </h2>
          <p className="mt-1 truncate text-sm text-slate-500">
            {job.company?.name && <span className="font-medium text-slate-600">{job.company.name}</span>}
            {job.company?.name && job.department ? " · " : ""}
            {job.department}
          </p>
        </div>
      </div>

      {/* The meta line only renders the fields this posting actually set, so a
          sparse job looks sparse rather than looking broken.
          Location lives HERE and not also in a badge up top: the reference's
          top-right pill is employment type, which this schema has no field for.
          Filling it with the location instead just printed the same string
          twice on every card. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <MetaItem icon={MapPin}>{job.location}</MetaItem>
        <MetaItem icon={Clock}>{experienceLabel(job.minExperienceYears)}</MetaItem>
        <MetaItem icon={GraduationCap}>{job.requiredEducation}</MetaItem>
      </div>

      {job.description && (
        <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-slate-600">{job.description}</p>
      )}

      <TokenList className="mt-5" label="Skills this role asks for" items={job.requiredSkills} max={5} />

      {/* `mt-auto` pins this to the bottom so the row of cards lines up without
          anyone hardcoding a height a longer description would then break. */}
      <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-brand-700">
        {/* aria-hidden: the stretched link above already covers these pixels and
            is the card's real control. Announcing "View & apply" as a second
            target for the same destination is noise. */}
        <span aria-hidden="true">View &amp; apply</span>
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </div>
    </Card>
  );
}

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
      <PageHero
        eyebrow="Careers"
        eyebrowIcon={Briefcase}
        title="Open positions"
        description="Apply once — AI screening and interviews take it from there. Every step names who it's waiting on and when it closes."
        points={["One application per role", "Evidence-backed screening", "Track every stage"]}
      />

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-verdict-negative">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-11 w-11 rounded-2xl" />
              <Skeleton className="mt-4 h-5 w-2/3" />
              <Skeleton className="mt-2 h-4 w-1/3" />
              <Skeleton className="mt-5 h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Briefcase}
            title="No open positions right now"
            description="Check back soon — new roles are posted regularly."
          />
        </Card>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{jobs.length}</span>{" "}
            {jobs.length === 1 ? "role is" : "roles are"} open right now.
          </p>
          {/* `items-stretch` so every card in a row shares the tallest height and
              the bottom action rows align across the grid. */}
          <ul className="grid list-none items-stretch gap-5 lg:grid-cols-2">
            {jobs.map((job) => (
              <li key={job._id}>
                <JobCard job={job} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
