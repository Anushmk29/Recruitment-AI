import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  ScanSearch,
  Bot,
  Users,
  BarChart3,
  MailCheck,
  Video,
  LineChart,
  LayoutDashboard,
  Clock,
  ThumbsUp,
  Workflow,
  DollarSign,
  Cpu,
  Mail,
  Phone,
  CheckCircle2,
} from "lucide-react";
import api from "../api/client.js";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import Button from "../components/ui/Button.jsx";
import { Card } from "../components/ui/Card.jsx";

const FEATURES = [
  { icon: ScanSearch, title: "AI Resume Screening", desc: "Every resume is parsed and scored against the job's real requirements in seconds — not skimmed by a tired recruiter." },
  { icon: Bot, title: "AI Technical Interviews", desc: "A live conversational AI runs adaptive technical and behavioral interviews, no scheduling back-and-forth required." },
  { icon: Users, title: "Live Candidate Tracking", desc: "See every applicant's stage — applied, screened, queued, interviewed — updated in real time across your pipeline." },
  { icon: BarChart3, title: "AI Reports", desc: "Structured, evidence-based interview reports for every candidate, ready to share with hiring managers." },
  { icon: MailCheck, title: "Automatic Email Invitations", desc: "Passing candidates are invited automatically with a secure link, schedule, and instructions — zero manual emails." },
  { icon: Video, title: "Real-Time Interview Monitoring", desc: "Watch interview status live: device checks, identity verification, and session progress as it happens." },
  { icon: LineChart, title: "Interview Analytics", desc: "Track pass rates, time-to-hire, and score distributions to keep improving your hiring bar." },
  { icon: LayoutDashboard, title: "Hiring Dashboard", desc: "One workspace for jobs, candidates, interviews, and reports — built for teams that hire on repeat." },
];

const FLOW = [
  "Company Registers",
  "Creates Job",
  "Candidates Apply",
  "ATS Analysis",
  "AI Interview",
  "Evaluation",
  "Hiring Decision",
];

const WHY_US = [
  { icon: Clock, title: "Reduce Hiring Time", desc: "Cut weeks of manual screening down to hours with automated ATS scoring and instant interview scheduling." },
  { icon: ThumbsUp, title: "Better Candidate Quality", desc: "Structured AI evaluation surfaces the candidates who actually match the role — not just the loudest resume." },
  { icon: Workflow, title: "Automated Recruitment", desc: "From application to interview invite to report, the pipeline runs itself so your team can focus on decisions." },
  { icon: Users, title: "Scalable Hiring", desc: "Run one interview or ten thousand concurrently — the platform is built to scale with your hiring volume." },
  { icon: DollarSign, title: "Cost Effective", desc: "Replace hours of recruiter screening time with automated, consistent evaluation at a fraction of the cost." },
  { icon: Cpu, title: "AI Powered", desc: "Every stage — resume, interview, report — is backed by purpose-built AI, not generic keyword matching." },
];

function formatPrice(amount) {
  if (amount === 0) return "Free";
  return `₹${amount.toLocaleString("en-IN")}`;
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Landing() {
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/subscriptions/plans")
      .then((res) => !cancelled && setPlans(res.data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <MarketingNavbar />

      {/* Hero */}
      <section className="relative overflow-hidden bg-grid">
        <div className="absolute inset-x-0 top-0 -z-10 h-[560px] bg-gradient-to-b from-brand-50 via-white to-white" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:py-28">
          <motion.div initial="hidden" animate="show" variants={fadeUp}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">
              <Sparkles className="h-3.5 w-3.5" /> AI-Native Recruitment Platform
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] text-slate-900 sm:text-5xl lg:text-[3.4rem]">
              Automate Your Entire Recruitment Process with AI.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              AI interviews, ATS screening, resume analysis, and candidate tracking — all wired into one workspace
              so your team hires faster, with less manual work at every step.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button as={Link} to="/register-company" size="lg">
                Start Free Trial <ArrowRight className="h-4 w-4" />
              </Button>
              <Button as={Link} to="/demo" variant="secondary" size="lg">
                Request Demo
              </Button>
            </div>
            <div className="mt-8 flex items-center gap-6 text-sm text-slate-500">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> No credit card for trial
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Setup in minutes
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative"
          >
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <div className="flex items-center gap-1.5 border-b border-slate-100 pb-3">
                <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                <span className="ml-3 text-xs font-medium text-slate-400">Hiring Dashboard</span>
              </div>
              <div className="grid grid-cols-3 gap-3 py-4">
                {[
                  ["Open Jobs", "12"],
                  ["In ATS Review", "48"],
                  ["AI Interviews", "23"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-3 text-center">
                    <div className="text-xl font-bold text-brand-700">{value}</div>
                    <div className="text-[11px] text-slate-500">{label}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2.5">
                {[
                  ["Priya Sharma", "Backend Engineer", 92],
                  ["Aman Verma", "Product Designer", 81],
                  ["Ritika Rao", "Data Analyst", 74],
                ].map(([name, role, score]) => (
                  <div key={name} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{name}</div>
                      <div className="text-xs text-slate-500">{role}</div>
                    </div>
                    <div className="text-sm font-bold text-emerald-600">{score}%</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-6 -left-6 hidden rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-soft sm:block">
              <div className="text-xs text-slate-500">AI Interview Live</div>
              <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> In progress
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Everything hiring teams need, in one place</h2>
          <p className="mt-3 text-slate-600">Purpose-built tools that replace a dozen disconnected spreadsheets and inboxes.</p>
        </motion.div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              transition={{ delay: (i % 4) * 0.06 }}
            >
              <Card className="group h-full transition hover:-translate-y-1 hover:shadow-soft">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                  <f.icon className="h-5.5 w-5.5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-slate-50 py-24">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">How it works</h2>
            <p className="mt-3 text-slate-600">From registration to hiring decision — a fully connected flow.</p>
          </motion.div>
          <div className="mt-16 flex flex-col gap-0 lg:flex-row lg:items-center lg:justify-between">
            {FLOW.map((step, i) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ delay: i * 0.08 }}
                className="relative flex flex-1 items-center gap-4 lg:flex-col lg:gap-3 lg:text-center"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white shadow-soft">
                  {i + 1}
                </div>
                <p className="text-sm font-semibold text-slate-800 lg:mt-1">{step}</p>
                {i < FLOW.length - 1 && (
                  <div className="hidden h-px flex-1 bg-gradient-to-r from-brand-300 to-brand-100 lg:block" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Why choose us */}
      <section id="why-us" className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Why choose HireFlow AI</h2>
        </motion.div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {WHY_US.map((f, i) => (
            <motion.div key={f.title} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} transition={{ delay: (i % 3) * 0.08 }}>
              <Card className="h-full">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
                  <f.icon className="h-5.5 w-5.5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Simple, transparent pricing</h2>
            <p className="mt-3 text-slate-600">Start free. Upgrade as your hiring volume grows.</p>
          </motion.div>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan, i) => (
              <motion.div key={plan.key} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} transition={{ delay: i * 0.06 }}>
                <Card className="flex h-full flex-col">
                  <h3 className="text-base font-semibold text-slate-900">{plan.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">{plan.description}</p>
                  <div className="mt-4 text-2xl font-extrabold text-slate-900">
                    {formatPrice(plan.pricing.monthly)}
                    {plan.pricing.monthly > 0 && <span className="text-sm font-medium text-slate-400"> /mo</span>}
                  </div>
                  <ul className="mt-4 flex-1 space-y-1.5 text-xs text-slate-500">
                    <li>{plan.limits.maxJobs.toLocaleString()} active jobs</li>
                    <li>{plan.limits.maxAiInterviews.toLocaleString()} AI interviews / mo</li>
                    <li>{plan.limits.maxRecruiters.toLocaleString()} recruiter seats</li>
                  </ul>
                  <Button as={Link} to="/register-company" variant="secondary" className="mt-5 w-full">
                    Get Started
                  </Button>
                </Card>
              </motion.div>
            ))}
            {plans.length === 0 && (
              <p className="col-span-full text-center text-sm text-slate-400">Loading plans…</p>
            )}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <div className="rounded-3xl bg-brand-600 px-8 py-16 text-center shadow-soft">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to hire smarter?</h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-100">
            Register your company and have a fully working AI hiring pipeline running in minutes.
          </p>
          <Button as={Link} to="/register-company" variant="secondary" size="lg" className="mt-8">
            Start Free Trial <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer / contact */}
      <footer id="contact" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
          <div className="flex flex-col justify-between gap-8 sm:flex-row">
            <div>
              <div className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <Sparkles className="h-4.5 w-4.5" />
                </span>
                HireFlow AI
              </div>
              <p className="mt-3 max-w-xs text-sm text-slate-500">
                The AI-native recruitment platform for teams who want to hire faster, without hiring worse.
              </p>
            </div>
            <div className="text-sm text-slate-600">
              <div className="font-semibold text-slate-800">Contact Sales</div>
              <a href="mailto:sales@hireflow.ai" className="mt-2 flex items-center gap-2 hover:text-brand-700">
                <Mail className="h-4 w-4" /> sales@hireflow.ai
              </a>
              <a href="tel:+911140001234" className="mt-2 flex items-center gap-2 hover:text-brand-700">
                <Phone className="h-4 w-4" /> +91 11 4000 1234
              </a>
            </div>
          </div>
          <p className="mt-10 text-xs text-slate-400">© {new Date().getFullYear()} HireFlow AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
