/* Hallmark · genre: modern-minimal · macrostructure: Bento Grid (app-scope)
 * theme: HireFlow AI (DESIGN.md, locked) · accent: signal violet
 * pre-emit critique: P5 H5 E5 S5 R5 V5
 *
 * Every figure on this screen is derived from data the workspace already holds
 * — jobs, candidates, and the interview queue. There are no placeholder charts,
 * no sample series, and no invented deltas: where a comparison period has no
 * data, the delta renders as "—" rather than as a fabricated percentage.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase,
  Users,
  Bot,
  Scale,
  ArrowUpRight,
  AlertTriangle,
  Clock,
  TrendingUp,
  Layers,
  UserCheck,
  Inbox,
  BarChart3,
  FilePlus2,
} from "lucide-react";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton, EmptyState, IconTile, SectionHeader } from "../../components/ui/Card.jsx";
import { Chip, ChipRow, HeroStat, ActionCard, ListRow } from "../../components/ui/Panels.jsx";
import Button from "../../components/ui/Button.jsx";
import { stageLabel, stageTone } from "../../lib/pipeline.js";
import TrendChart from "../../components/dashboard/TrendChart.jsx";

const DAY = 86_400_000;

function timeAgo(date) {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Initial monogram. No avatar images exist for candidates — a generated face
 *  would be a fabricated likeness of a real applicant. */
function Monogram({ name }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
      {(name || "?")[0].toUpperCase()}
    </span>
  );
}

function Delta({ value }) {
  // No prior period to compare against → say so. A "+100%" from a zero base is
  // the most common fabricated-looking stat in a dashboard.
  if (value == null) return <span className="text-xs text-slate-500">no prior period</span>;
  const up = value > 0;
  const flat = value === 0;
  return (
    <span
      className={`text-xs font-semibold tabular-nums ${
        flat ? "text-slate-500" : up ? "text-emerald-700" : "text-red-600"
      }`}
    >
      {flat ? "no change" : `${up ? "+" : ""}${value}% vs prior 30d`}
    </span>
  );
}

export default function DashboardHome() {
  const { me, jobs, allCandidates, queue, loading } = useCompanyData();

  const model = useMemo(() => {
    const now = Date.now();
    const dated = allCandidates.filter((c) => c.createdAt);

    const last30 = dated.filter((c) => now - new Date(c.createdAt).getTime() <= 30 * DAY).length;
    const prior30 = dated.filter((c) => {
      const age = now - new Date(c.createdAt).getTime();
      return age > 30 * DAY && age <= 60 * DAY;
    }).length;
    const applicantDelta = prior30 === 0 ? null : Math.round(((last30 - prior30) / prior30) * 100);

    // Twelve weekly buckets. Weeks, not days: a daily series on a low-volume
    // tenant is mostly zeroes and reads as a broken chart rather than a quiet one.
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const end = now - (11 - i) * 7 * DAY;
      const start = end - 7 * DAY;
      const d = new Date(end);
      return {
        label: `${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`,
        count: dated.filter((c) => {
          const t = new Date(c.createdAt).getTime();
          return t > start && t <= end;
        }).length,
      };
    });

    const scored = allCandidates.filter((c) => c.ats?.decision && c.ats.decision !== "pending");
    const avgScore = scored.length
      ? Math.round(scored.reduce((sum, c) => sum + (c.ats?.overallScore || 0), 0) / scored.length)
      : null;

    // Stage distribution, biggest first, zero-count stages dropped.
    const stageCounts = new Map();
    for (const c of allCandidates) {
      if (!c.status) continue;
      stageCounts.set(c.status, (stageCounts.get(c.status) || 0) + 1);
    }
    const stages = [...stageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    const stageMax = stages.length ? stages[0][1] : 0;

    // On-thesis: a job with no approved rubric is scored by the legacy keyword
    // engine. That is a state a recruiter must not be able to miss.
    const unapprovedRubrics = jobs.filter((j) => j.rubricStatus !== "approved");

    return {
      last30,
      prior30,
      applicantDelta,
      buckets,
      avgScore,
      scoredCount: scored.length,
      stages,
      stageMax,
      unapprovedRubrics,
      recent: [...allCandidates].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6),
    };
  }, [allCandidates, jobs]);

  const stats = [
    {
      label: "Open jobs",
      value: jobs.length,
      icon: Briefcase,
      foot: `${jobs.filter((j) => j.status === "published").length} published`,
    },
    { label: "Applicants", value: allCandidates.length, icon: Users, delta: model.applicantDelta },
    { label: "Interview queue", value: queue.length, icon: Bot, foot: "passed screening, awaiting interview" },
    {
      label: "Average score",
      value: model.avgScore == null ? "—" : model.avgScore,
      icon: Scale,
      foot: model.avgScore == null ? "nothing scored yet" : `across ${model.scoredCount} scored`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Greeting band. The aurora wash is the one decorative surface on this
          screen — it sits behind the salutation, which carries no data, so
          nothing measurable is ever rendered on a tinted ground. */}
      <header className="overflow-hidden rounded-2xl border border-brand-100 bg-aurora px-6 py-7 shadow-card">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">
          {greeting()}
          {/* /auth/me returns the sanitized user directly, with `company` nested
              inside it — the name is me.name, not me.user.name. */}
          {me?.name ? `, ${me.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-slate-600">
          A live view of the pipeline. Every figure here is computed from your own workspace.
        </p>
      </header>

      {/* Destination chips. These are links to real screens with real counts —
          not filters. A row of pills that looks like a segmented control but
          navigates instead would teach the wrong gesture on the first click. */}
      <ChipRow label="Jump to">
        <Chip as={Link} to="/jobs" icon={Briefcase}>
          Jobs <span className="tabular-nums opacity-70">{jobs.length}</span>
        </Chip>
        <Chip as={Link} to="/candidates" icon={Users}>
          Candidates <span className="tabular-nums opacity-70">{allCandidates.length}</span>
        </Chip>
        <Chip as={Link} to="/review-queue" icon={Scale}>
          Review queue <span className="tabular-nums opacity-70">{queue.length}</span>
        </Chip>
        <Chip as={Link} to="/ai-interviews" icon={Bot}>
          AI interviews
        </Chip>
        <Chip as={Link} to="/reports" icon={BarChart3}>
          Reports
        </Chip>
      </ChipRow>

      {/* Hero figure. Ember is allowed on this one panel because the number is
          pure intake volume — how many people applied — and nothing on it
          evaluates anybody. The instant this surface shows a score or a stage,
          it goes back to brand. */}
      <HeroStat
        tone="ember"
        label="Applications received"
        value={loading ? "—" : model.last30.toLocaleString()}
        basis={
          model.prior30 === 0
            ? "Last 30 days, counted by application date. No prior 30-day window to compare against yet."
            : `Last 30 days, counted by application date — against ${model.prior30.toLocaleString()} in the 30 days before that.`
        }
        badge={<Delta value={model.applicantDelta} />}
        action={
          <Button as={Link} to="/candidates" size="sm">
            View all applicants <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
      />

      {/* KPI strip — one surface divided by hairlines, rather than four separate
          floating cards. The figures belong to one reading, and four detached
          tiles would invite four separate conclusions.
          The icon tiles are new; the single-surface decision is not. */}
      <Card className="p-0">
        <div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {stats.map((s) => (
            <div key={s.label} className="p-5 sm:border-b sm:border-slate-200 lg:border-b-0">
              <div className="flex items-center gap-2.5">
                <IconTile icon={s.icon} size="sm" />
                <span className="text-xs font-semibold text-slate-600">{s.label}</span>
              </div>
              {loading ? (
                <Skeleton className="mt-3 h-8 w-20" />
              ) : (
                <p className="font-display mt-3 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{s.value}</p>
              )}
              <p className="mt-1">{s.delta !== undefined ? <Delta value={s.delta} /> : <span className="text-xs text-slate-500">{s.foot}</span>}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Quick actions — the reference's violet / ember / white / white strip.
          Every card is a real destination with a real count; none of them is a
          decorative tile with a number invented to fill the shape. The two
          filled cards go to the two things that block a pipeline, so the loudest
          surfaces on the screen are also the most urgent. */}
      <section aria-labelledby="quick-actions">
        <h2 id="quick-actions" className="sr-only">
          Quick actions
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard
            tone="filled-brand"
            icon={Scale}
            title="Review queue"
            description={
              queue.length === 0
                ? "Nothing is waiting on a human right now."
                : `${queue.length} score${queue.length === 1 ? "" : "s"} the engine was not confident enough to call.`
            }
            action={
              <Button as={Link} to="/review-queue" variant="secondary" size="sm" className="w-full">
                Open queue
              </Button>
            }
          />
          {/* Ember goes on "Post a job", not on the rubric warning next to it.
              The rubric card reports a state — some jobs are still on the legacy
              engine — and the Ember Containment Rule keeps decorative orange off
              anything that reports state, because it sits one hue away from the
              reserved pending amber. "Post a job" is a pure action with no state
              attached, so it can carry the fill. The rubric card gets its urgency
              from a verdict-toned icon chip instead, which is the honest channel
              for it. */}
          <ActionCard
            tone="filled-ember"
            icon={FilePlus2}
            title="Post a job"
            description="Compile a job description into a versioned, approvable rubric."
            action={
              <Button as={Link} to="/jobs/new" variant="secondary" size="sm" className="w-full">
                New job
              </Button>
            }
          />
          <ActionCard
            icon={AlertTriangle}
            iconTone={model.unapprovedRubrics.length > 0 ? "negative" : "positive"}
            title="Rubrics to approve"
            description={
              model.unapprovedRubrics.length === 0
                ? "Every open job is scored by the evidence engine."
                : `${model.unapprovedRubrics.length} job${
                    model.unapprovedRubrics.length === 1 ? " is" : "s are"
                  } still on the legacy keyword engine.`
            }
            action={
              <Button as={Link} to="/jobs" variant="secondary" size="sm" className="w-full">
                Review rubrics
              </Button>
            }
          />
          <ActionCard
            icon={Bot}
            title="AI interviews"
            description="Sessions minted for candidates who cleared screening."
            action={
              <Button as={Link} to="/ai-interviews" variant="secondary" size="sm" className="w-full">
                View interviews
              </Button>
            }
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader
            icon={TrendingUp}
            title="Applications received"
            action={<p className="text-xs text-slate-500">Weekly, last 12 weeks</p>}
          />
          {loading ? <Skeleton className="mt-4 h-44 w-full" /> : <TrendChart buckets={model.buckets} />}
        </Card>

        <Card>
          <SectionHeader icon={Layers} title="Pipeline distribution" description="Where candidates currently sit" />
          {loading ? (
            <Skeleton className="mt-4 h-44 w-full" />
          ) : model.stages.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No candidates yet.</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {model.stages.map(([stage, count]) => (
                <li key={stage}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{stageLabel(stage)}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{count}</span>
                  </div>
                  {/* Width is the real proportion of the largest stage — the bar
                      is the number, not an illustration of it. */}
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${model.stageMax ? (count / model.stageMax) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader
            icon={UserCheck}
            title="Recent applicants"
            className="mb-3"
            action={
              <Link
                to="/candidates"
                className="inline-flex items-center gap-1 rounded-lg text-xs font-semibold whitespace-nowrap text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                View all <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            }
          />

          {!loading && model.recent.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No applicants yet"
              description="Applicants appear here as they apply to your published jobs."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {model.recent.map((c) => (
                <li key={c._id} className="flex items-center gap-3 py-3">
                  <Monogram name={c.basicDetails?.name} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/candidates/${c._id}`}
                      className="block truncate rounded-lg text-sm font-semibold text-slate-800 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      {c.basicDetails?.name}
                    </Link>
                    <p className="truncate text-xs text-slate-500">
                      {c.job?.title || "—"} · {timeAgo(c.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {c.ats?.overallScore != null && (
                      <span className="text-sm font-bold tabular-nums text-slate-700">{c.ats.overallScore}</span>
                    )}
                    <Badge tone={stageTone(c.status)}>{stageLabel(c.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Needs attention — the tile that replaces a decorative "insights"
            panel with the two states that actually block a recruiter. */}
        {/* Needs attention. Stays a plain white card on purpose — this panel is
            about work awaiting a human, which is precisely what the reserved
            amber channel means. Wrapping it in a decorative fill would put a
            brand colour in front of a queue state. */}
        <Card>
          <SectionHeader icon={Inbox} title="Needs a person" description="Nothing here resolves itself" />

          {/* The icon chips keep their verdict tones through IconTile rather
              than hand-mixed `amber-50`/`red-50`. These two rows are the only
              place on the dashboard where the reserved channel is spent, and
              they are spent correctly: both mean a person is owed something. */}
          <div className="mt-5 space-y-3">
            <ListRow
              as={Link}
              to="/review-queue"
              icon={Scale}
              iconTone="pending"
              title={`${queue.length} in the review queue`}
              meta="Scores the engine was not confident about"
            />

            {model.unapprovedRubrics.length > 0 && (
              <ListRow
                as={Link}
                to="/jobs"
                icon={AlertTriangle}
                iconTone="negative"
                title={`${model.unapprovedRubrics.length} job${
                  model.unapprovedRubrics.length === 1 ? "" : "s"
                } without an approved rubric`}
                meta="Scored by the legacy keyword engine, not the evidence engine"
              />
            )}

            {!loading && queue.length === 0 && model.unapprovedRubrics.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Clock className="h-4 w-4" aria-hidden="true" /> Nothing is waiting on you.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
