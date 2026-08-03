import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  UploadCloud,
  Send,
  ScanSearch,
  Bot,
  MessageSquareText,
  ListChecks,
  Bell,
  Bookmark,
  Clock,
  ThumbsUp,
  Workflow,
  ShieldCheck,
  Video,
  DollarSign,
  Mail,
  Phone,
  CheckCircle2,
} from "lucide-react";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import Button from "../components/ui/Button.jsx";
import { Card, IconTile } from "../components/ui/Card.jsx";

const FEATURES = [
  { icon: UploadCloud, title: "One Resume, Every Job", desc: "Upload your resume once and reuse it for every application, with a full version history if you update it later." },
  { icon: ScanSearch, title: "See Your Match Score", desc: "AI screening scores your resume against each job's real requirements, so you know where you stand before you wait." },
  { icon: Send, title: "Apply in Minutes", desc: "Your saved profile and resume pre-fill every application — no retyping the same details job after job." },
  { icon: Bot, title: "AI Interviews On Your Schedule", desc: "Pass screening and get invited to a live AI interview you can take whenever suits you — no recruiter calendar tag." },
  { icon: MessageSquareText, title: "Structured Feedback", desc: "Every AI interview ends with a clear, evidence-based report so you actually know how you did." },
  { icon: ListChecks, title: "Real-Time Application Tracking", desc: "Follow every application's exact stage — applied, in ATS review, interview-ready, or decided — with no guessing." },
  { icon: Bell, title: "Instant Notifications", desc: "Get notified the moment your status changes, an interview is scheduled, or a recruiter responds." },
  { icon: Bookmark, title: "Saved & Recommended Jobs", desc: "Bookmark roles you're considering and get new openings recommended based on your skills and profile." },
];

const FLOW = [
  "Create Account",
  "Build Profile",
  "Apply to Jobs",
  "AI Resume Screening",
  "AI Interview",
  "Get Feedback",
  "Receive Decision",
];

const WHY_US = [
  { icon: Clock, title: "Faster Results", desc: "Know where you stand in days, not weeks of silence after hitting submit." },
  { icon: ThumbsUp, title: "Fair & Consistent", desc: "Every resume and interview is scored against the same criteria — not a recruiter's mood that day." },
  { icon: Workflow, title: "Apply Once, Reuse Everywhere", desc: "Save your details once and apply to any open role in minutes, not hours." },
  { icon: Video, title: "Interview On Your Time", desc: "No scheduling back-and-forth — take your AI interview whenever works for you." },
  { icon: ShieldCheck, title: "Transparent Feedback", desc: "Get a real, structured report after every interview instead of being ghosted." },
  { icon: DollarSign, title: "Always Free for Candidates", desc: "Creating an account, applying, and interviewing never costs you anything." },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNavbar />

      {/* Hero */}
      <section className="relative overflow-hidden bg-grid">
        <div className="absolute inset-x-0 top-0 -z-10 h-[560px] bg-aurora" />
        <div className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
          <motion.div initial="hidden" animate="show" variants={fadeUp}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">
              <Sparkles className="h-3.5 w-3.5" /> AI-Powered Hiring
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] text-slate-900 sm:text-5xl">
              Land Your Dream Job with AI-Powered Hiring.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
              Apply once, let AI resume screening and interviews do the heavy lifting, and grow your career with
              feedback that actually helps — every step tracked in one place.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button as={Link} to="/register" size="lg">
                Create Account <ArrowRight className="h-4 w-4" />
              </Button>
              <Button as={Link} to="/" variant="secondary" size="lg">
                Explore Jobs
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Free for candidates, always
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Apply in minutes
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Everything you need to land your next role</h2>
          <p className="mt-3 text-slate-600">From first upload to your next offer — everything in one place.</p>
        </motion.div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} transition={{ delay: (i % 4) * 0.06 }}>
              {/* Every fourth tile warms to ember. It is a rhythm device on a
                  decorative icon chip — the one job ember is allowed to do —
                  and it never touches the card body, so no feature reads as
                  "flagged" next to its neighbours. */}
              <Card interactive className="group h-full">
                <IconTile icon={f.icon} tone={i % 4 === 3 ? "ember" : "brand"} className="mb-4" />
                <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-canvas py-24">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">How it works</h2>
            <p className="mt-3 text-slate-600">From creating your account to hearing back — a fully connected journey.</p>
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
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Why candidates choose HireFlow AI</h2>
        </motion.div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {WHY_US.map((f, i) => {
            // The reference deck's rhythm: one violet block, one ember block,
            // the rest white. Two filled cards out of six is the entire budget —
            // a grid where everything is filled has no focal point left to
            // spend, and the eye just bounces.
            const tone = i === 0 ? "filled-brand" : i === 1 ? "filled-ember" : "default";
            const filled = tone !== "default";
            return (
              <motion.div key={f.title} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} transition={{ delay: (i % 3) * 0.08 }}>
                <Card tone={tone} className="h-full">
                  <IconTile icon={f.icon} tone={filled ? "on-fill" : "brand"} className="mb-4" />
                  <h3 className={`text-base font-semibold ${filled ? "text-white" : "text-slate-900"}`}>{f.title}</h3>
                  <p className={`mt-1.5 text-sm leading-relaxed ${filled ? "text-white/90" : "text-slate-500"}`}>
                    {f.desc}
                  </p>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* About */}
      <section id="about" className="bg-canvas py-24">
        <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">About HireFlow AI</h2>
          <p className="mt-4 text-slate-600">
            HireFlow AI connects candidates with companies using AI-driven resume screening and real-time interviews
            — so you spend less time waiting and more time showing what you can actually do. Every application you
            submit, interview you take, and piece of feedback you receive lives in one dashboard you control.
          </p>
          <Button as={Link} to="/register" size="lg" className="mt-8">
            Create Account <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <div className="rounded-3xl fill-brand px-8 py-16 text-center shadow-lift">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to start applying?</h2>
          {/* white/90 rather than brand-100: brand-100 on the gradient's
              lightest stop is 4.49:1, which rounds to "fails". */}
          <p className="mx-auto mt-3 max-w-xl text-white/90">
            Create your free account and apply to your first job in minutes.
          </p>
          <Button as={Link} to="/register" variant="secondary" size="lg" className="mt-8">
            Create Account <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

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
                AI-powered hiring for candidates who want a faster, fairer path to their next role.
              </p>
            </div>
            <div className="text-sm text-slate-600">
              <div className="font-semibold text-slate-800">Get in Touch</div>
              <a href="mailto:careers@hireflow.ai" className="mt-2 flex items-center gap-2 hover:text-brand-700">
                <Mail className="h-4 w-4" /> careers@hireflow.ai
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
