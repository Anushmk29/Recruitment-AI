/* Hallmark · genre: modern-minimal · macrostructure: Split Studio
 * design-system: DESIGN.md (locked) · designed-as-app
 * H2 hero knobs: ratio=7/5, right=proof column, divider=negative space
 * Split knobs: 4 movements, alternating direction, artifact per movement
 * nav: N1b (shared component, unchanged) · footer: Ft5 Statement
 * enrichment: Tier-A hand-built artifact panels (LoopArtifacts.jsx)
 * pre-emit critique: P5 H5 E5 S5 R4 V5
 * contrast: pass (40–41) · honest: pass (46) · chrome: pass (47) · tokens: pass (48)
 * responsive: pass (49–53) · icons: pass (30) · eyebrow/section-head: pass (54)
 *
 * Replaces: Narrative Workflow — six stacked text cards of equal weight, which
 * carried the right argument in the most monotonous form available. Each stage
 * now pairs with the artifact it actually produces, because a product whose
 * claim is "look at the evidence" should show the evidence rather than describe
 * it in a sixth consecutive paragraph.
 *
 * Deliberately NOT carried over from the supplied reference: the dark neural
 * backdrop and glow wave (DESIGN.md § Don't — looking futuristic undermines the
 * claim that a code path computed the score), the borrowed logo wall (gate 46 —
 * fabricated endorsement), and the three equal icon-above-heading-above-body
 * cards (a named critical tell in its own right). The reference's *structure* —
 * visual anchor, 3-up strip, visual-per-step — is what was worth taking.
 *
 * Motion is down from four revealed sections to one: the diptych halves
 * cross-fade in staggered, per the Split Studio reveal spec. Everything else on
 * the page is simply there.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Scale } from "lucide-react";
import api from "../api/client.js";
import EventNetwork from "../components/marketing/EventNetwork.jsx";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import { ClaimsPanel, LedgerPanel, ProbePanel, RubricPanel } from "../components/marketing/LoopArtifacts.jsx";
import Button from "../components/ui/Button.jsx";
import Reveal from "../motion/Reveal.jsx";
import Tilt from "../motion/Tilt.jsx";

// The honest replacement for the reference's "trusted by 99,000+ brands" logo
// wall. We have no customer logos to show, and inventing them is the fastest
// way to lose the argument this page is making. What we do have is the record
// the product leaves behind — which is the thing a buyer is actually shopping
// for when their legal team is in the room.
const EVIDENCE = [
  {
    title: "A record for a bias audit",
    body: "Every assessment can be re-run with identity signals removed and the two results compared. A divergence flags the assessment for human review rather than burying it.",
  },
  {
    title: "A decision you can re-derive",
    body: "Each assessment stores a hash of its inputs, its prompt versions, and its scorer version — so a decision made today can be reproduced, line for line, months from now.",
  },
  {
    title: "A person on every adverse action",
    body: "Automatic rejection is opt-in and off by default, and the deterministic fallback can never emit an adverse recommendation on its own.",
  },
];

// The Claim → Probe → Verdict loop, as four movements. Each one pairs with the
// artifact it produces — the sequence IS the differentiator, so the page's
// shape is the sequence.
const LOOP = [
  {
    stage: "1.0",
    title: "The rubric is frozen before anyone is scored",
    body: "A job description is compiled once into a versioned rubric — must-haves, nice-to-haves, disqualifiers, weights — and a recruiter approves it. Every candidate for that role is then measured against the identical frozen rubric, which is what makes comparing two of them legitimate and a bias audit possible at all.",
    Artifact: RubricPanel,
  },
  {
    stage: "2.0",
    title: "The résumé becomes cited claims, not keywords",
    body: "Each assertion is extracted as an individual claim carrying the verbatim span it came from, and code checks that the quoted span is a literal substring of the source document. A claim that cannot be quoted is dropped rather than trusted — which is how hallucination is removed structurally instead of hoped away.",
    Artifact: ClaimsPanel,
  },
  {
    stage: "3.0",
    title: "Code computes the score, from evidence it had to cite",
    body: "Each criterion becomes a line item: its weight, the evidence behind it, and the points it earned. The line items sum to the total by construction, and a criterion with no cited evidence scores zero instead of being estimated. No model is ever asked to produce a number.",
    Artifact: LedgerPanel,
  },
  {
    stage: "4.0",
    title: "Screening ends in a test plan, and the interview closes it",
    body: "High-weight claims the résumé asserts but cannot prove become interview probes, and the AI interview tests exactly those. Each one comes back marked verified, contradicted, or still unverified. This is the join competitors do not have: screening and interviewing stop being two disconnected products.",
    Artifact: ProbePanel,
  },
];

// Capability index. Each row maps to a shipped surface — nothing aspirational.
const CAPABILITIES = [
  ["Résumé screening", "Every application is parsed and scored against the role's approved rubric, with the evidence for each criterion attached to the result."],
  ["AI interviews", "Adaptive technical and behavioural interviews over a secure expiring link, targeted at the claims screening could not verify."],
  ["Candidate pipeline", "Fourteen stages from applied through to joined, updated live across every recruiter's view without a refresh."],
  ["Evidence reports", "Each report names the criterion, the quoted evidence, and the confidence behind every judgement it records."],
  ["Review queue", "Anything the engine is honestly unsure about is routed to a person, carrying the reason it was routed and the evidence behind it."],
  ["Automatic invitations", "Candidates who pass are invited automatically with a secure link, a schedule, and instructions. No manual scheduling thread."],
  ["Reproducibility", "Every assessment carries a hash of its inputs, prompt versions, and scorer version, so a decision can be re-derived months later."],
  ["Bias counterfactuals", "Assessments are re-run with identity signals removed and the two results compared. A divergence flags the assessment for human review."],
];

// The refusals. Stated plainly because they are the product position, and
// because each one is a constraint the codebase actually enforces.
const REFUSALS = [
  ["No number without a source", "Every fact behind a score carries the verbatim line it came from. Facts that cannot be cited are discarded, not estimated."],
  ["No automatic rejection", "Auto-reject is opt-in and off by default, and the deterministic fallback can never emit an adverse recommendation. A person signs every adverse action."],
  ["No generic benchmark", "Nobody is scored against a global average or a model's opinion of a good résumé — only against this role's approved rubric, naming the criterion that drove each judgement."],
  ["No borrowed confidence", "Degraded, fallback, and estimated results are labelled as such everywhere they surface — on screen, in the PDF, and in the API. A placeholder is never dressed as a measurement."],
];

function formatPrice(amount) {
  if (amount === 0) return "Free";
  return `₹${amount.toLocaleString("en-IN")}`;
}

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

      {/* Hero — H2 split diptych at 7/5. Never wrapped in Reveal: above-the-fold
          content paints immediately rather than waiting on an observer. */}
      {/* Bottom padding runs ≥1.4× the top so the hero pulls into the next
          section's rhythm rather than floating above it (gate 44a). */}
      <section className="mx-auto grid max-w-7xl items-center gap-x-12 gap-y-16 px-5 pt-20 pb-28 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:pt-24 lg:pb-36">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Scale className="h-4 w-4 text-brand-600" aria-hidden="true" />
            Evidence-bound hiring intelligence
          </p>
          {/* Two-tone display: the second line carries the accent. Solid colour,
              never a gradient fill — gradient text is the most-recognised AI
              headline tell there is. */}
          <h1 className="mt-5 text-4xl leading-[1.08] font-extrabold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-5xl lg:text-[3.4rem]">
            Every score traces
            <span className="block text-brand-600">to a quoted line.</span>
          </h1>
          <p className="mt-6 text-xl font-semibold text-slate-800 sm:text-2xl">
            The model never emits the score. Code computes it — from evidence it was required to cite.
          </p>
          <p className="mt-5 max-w-prose text-lg text-slate-600">
            HireFlow AI screens candidates against a frozen, recruiter-approved rubric for the role, then shows you
            the criterion, the quoted evidence, and the arithmetic behind every number it produces. The kind of
            record you can hand to a hiring manager, an auditor, or a candidate who asks why.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Button as={Link} to="/register-company" size="lg" className="whitespace-nowrap">
              Start free trial <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button as={Link} to="/demo" variant="secondary" size="lg" className="whitespace-nowrap">
              Request a demo
            </Button>
          </div>

          <p className="mt-6 text-sm text-slate-500">
            No credit card for the trial. Automatic rejection is off by default.
          </p>
        </div>

        {/* Hidden below lg: at phone widths the network has no room to read as a
            network, and a cramped illustration is worse than none. The hero is
            typographically complete without it. */}
        <div className="hidden lg:block">
          <EventNetwork />
        </div>
      </section>

      {/* Evidence strip — the honest occupant of the reference's logo-wall slot.
          Asymmetric tracks and hairline dividers, deliberately not three equal
          icon-tile cards. Tight vertical padding so it reads as a strip between
          two large sections rather than as a section of its own. */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:py-12">
          <p className="max-w-2xl text-lg font-semibold text-slate-800 [overflow-wrap:anywhere]">
            What you hand to the people who ask how a decision was made.
          </p>

          <div className="mt-8 grid gap-x-10 divide-y divide-slate-200 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.95fr)] lg:divide-x lg:divide-y-0">
            {EVIDENCE.map((item) => (
              <div key={item.title} className="py-5 first:pt-0 lg:py-0 lg:pl-10 lg:first:pl-0">
                <h2 className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{item.title}</h2>
                <p className="mt-2 max-w-prose text-sm text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 1.0 → 4.0 — the loop, as Split Studio diptychs. Each movement pairs the
          argument with the artifact it produces; the pairing alternates
          direction so the page has a gait instead of a stack. */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
        {/* Single-column section head. Never tag-left/heading-right — that
            two-column head is the most reliable templated-editorial tell. */}
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-4xl">
            One loop, from job description to defensible decision
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Most platforms bolt a language model onto an applicant tracker and return a number. This is the sequence
            that replaces it — and the artifact each stage leaves behind.
          </p>
          <p className="mt-4 text-sm text-slate-500">
            The panels show the shape of each artifact. They illustrate the format; none of them is a candidate
            record, and no figure on this page is a measurement of a real person.
          </p>
        </div>

        <ol className="mt-16 space-y-20 lg:mt-20 lg:space-y-28">
          {LOOP.map((step, i) => {
            const flip = i % 2 === 1;
            return (
              <li key={step.stage} className="grid items-center gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Reveal className={flip ? "lg:order-2" : undefined}>
                  {/* Stage number stacks above its heading in the same column —
                      it is genuinely ordinal here, and it is the only numbering
                      on the page. */}
                  <p className="text-sm font-semibold tabular-nums text-brand-700">{step.stage}</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere]">
                    {step.title}
                  </h3>
                  <p className="mt-4 max-w-prose text-slate-600">{step.body}</p>
                </Reveal>

                <Reveal delay={90} className={flip ? "lg:order-1" : undefined}>
                  <step.Artifact />
                </Reveal>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Capability index — F3 spec sheet. A dense tabular read, deliberately
          unlike the diptychs above it. */}
      <section id="features" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-5xl px-5 py-24 sm:px-8">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-4xl">
            What the platform does
          </h2>
          <p className="mt-4 max-w-prose text-lg text-slate-600">
            One workspace for jobs, candidates, interviews, and the record of how each decision was reached.
          </p>

          <dl className="mt-12 border-t border-slate-200">
            {CAPABILITIES.map(([name, behaviour]) => (
              <div
                key={name}
                className="grid gap-x-10 gap-y-1.5 border-b border-slate-200 py-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
              >
                <dt className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{name}</dt>
                <dd className="max-w-prose text-slate-600">{behaviour}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* The refusals — the position, stated plainly. */}
      <section id="why-us" className="mx-auto max-w-5xl px-5 py-24 sm:px-8">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-4xl">
          What this platform will not do
        </h2>
        <p className="mt-4 max-w-prose text-lg text-slate-600">
          These are constraints in the code, not promises in a brochure. They are also the reason the output holds up
          when someone asks how a decision was made.
        </p>

        <div className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {REFUSALS.map(([title, body]) => (
            <div key={title}>
              <h3 className="text-lg font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere]">{title}</h3>
              <p className="mt-2 max-w-prose text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing — real plan data from the API. */}
      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-4xl">
            Pricing
          </h2>
          <p className="mt-4 max-w-prose text-lg text-slate-600">Start free. Move up as your hiring volume grows.</p>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <Tilt key={plan.key} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
                <h3 className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{plan.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
                <p className="mt-5 text-2xl font-extrabold tabular-nums text-slate-900">
                  {formatPrice(plan.pricing.monthly)}
                  {plan.pricing.monthly > 0 && <span className="text-sm font-medium text-slate-500"> /mo</span>}
                </p>
                <ul className="mt-5 flex-1 space-y-2 border-t border-slate-100 pt-5 text-sm tabular-nums text-slate-600">
                  <li>{plan.limits.maxJobs.toLocaleString()} active jobs</li>
                  <li>{plan.limits.maxAiInterviews.toLocaleString()} AI interviews / month</li>
                  <li>{plan.limits.maxRecruiters.toLocaleString()} recruiter seats</li>
                </ul>
                <Button as={Link} to="/register-company" variant="secondary" className="mt-6 w-full whitespace-nowrap">
                  Get started
                </Button>
              </Tilt>
            ))}
            {plans.length === 0 && <p className="col-span-full text-sm text-slate-500">Loading plans…</p>}
          </div>
        </div>
      </section>

      {/* Closing CTA — one button. The repetition is the call to action. */}
      <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-4xl">
          Run one role through it and read the record.
        </h2>
        <p className="mt-4 max-w-prose text-lg text-slate-600">
          Register your company, publish a job, and look at what comes back — the criteria, the quoted evidence, and
          the points behind the number.
        </p>
        <Button as={Link} to="/register-company" size="lg" className="mt-8 whitespace-nowrap">
          Start free trial <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </section>

      {/* Ft5 Statement — a closing line, not a sitemap. */}
      <footer id="contact" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
          <p className="max-w-[38ch] text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-3xl">
            Hiring decisions are about people. They should be defensible in writing.
          </p>

          <div className="mt-12 flex flex-col justify-between gap-6 border-t border-slate-200 pt-6 text-sm sm:flex-row sm:items-end">
            <div>
              <span className="flex items-center gap-2 font-display font-bold text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs text-white">
                  H
                </span>
                HireFlow AI
              </span>
              <p className="mt-3 text-slate-500">© {new Date().getFullYear()} HireFlow AI. All rights reserved.</p>
            </div>

            <div className="flex flex-col gap-1.5 text-slate-600 sm:items-end">
              <a
                href="mailto:sales@hireflow.ai"
                className="rounded-lg whitespace-nowrap hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                sales@hireflow.ai
              </a>
              <a
                href="tel:+911140001234"
                className="rounded-lg whitespace-nowrap tabular-nums hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                +91 11 4000 1234
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
