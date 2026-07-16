import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  UploadCloud,
  Send,
  ListChecks,
  Bot,
  MessageSquareText,
  TrendingUp,
  Mail,
  Phone,
} from "lucide-react";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import Button from "../components/ui/Button.jsx";
import { Card } from "../components/ui/Card.jsx";

const HELP_STEPS = [
  { icon: UploadCloud, title: "Upload Resume", desc: "Add your resume once and reuse it for every application, with a full version history." },
  { icon: Send, title: "Apply to Jobs", desc: "Browse open roles and apply in minutes with your saved details and resume." },
  { icon: ListChecks, title: "Track Applications", desc: "See exactly where every application stands — applied, in review, or interview-ready." },
  { icon: Bot, title: "AI Interview", desc: "Get invited automatically when you pass screening, and interview on your own schedule." },
  { icon: MessageSquareText, title: "Interview Feedback", desc: "Receive a structured report after your interview so you know exactly how you did." },
  { icon: TrendingUp, title: "Career Growth", desc: "Build a track record across applications and interviews as you grow your career." },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNavbar />

      <section className="relative overflow-hidden bg-grid">
        <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-brand-50 via-white to-white" />
        <div className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
          <motion.div initial="hidden" animate="show" variants={fadeUp}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">
              <Sparkles className="h-3.5 w-3.5" /> AI-Powered Hiring
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] text-slate-900 sm:text-5xl">
              Land Your Dream Job with AI-Powered Hiring.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
              Apply once, let AI interviews and resume analysis do the heavy lifting, and grow your career with
              feedback that actually helps.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button as={Link} to="/register" size="lg">
                Create Account <ArrowRight className="h-4 w-4" />
              </Button>
              <Button as={Link} to="/" variant="secondary" size="lg">
                Explore Jobs
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="tips" className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">How it helps you</h2>
          <p className="mt-3 text-slate-600">From first upload to your next offer — everything in one place.</p>
        </motion.div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {HELP_STEPS.map((f, i) => (
            <motion.div key={f.title} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={fadeUp} transition={{ delay: (i % 3) * 0.08 }}>
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

      <section id="about" className="bg-slate-50 py-24">
        <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">About HireFlow AI</h2>
          <p className="mt-4 text-slate-600">
            HireFlow AI connects candidates with companies using AI-driven resume screening and real-time interviews
            — so you spend less time waiting and more time showing what you can actually do.
          </p>
          <Button as={Link} to="/register" size="lg" className="mt-8">
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
