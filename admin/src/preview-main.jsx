/**
 * THROWAWAY design preview — not part of the app, not imported by it.
 *
 * Renders the real InterviewReport page and the real UI kit against fixture
 * data, with no backend, no database and no login: the axios adapter is swapped
 * for a stub below, so every api.get() resolves to the fixture.
 *
 * Run:     cd admin && npm run dev   →  http://localhost:5173/preview.html
 * Delete:  rm admin/preview.html admin/src/preview-main.jsx
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Routes, Route, Link, NavLink } from "react-router-dom";
import api from "./api/client.js";
import InterviewReport from "./pages/InterviewReport.jsx";
import { ToastProvider } from "./components/ui/Toast.jsx";
import { Card, Badge, Avatar, StatCard, EmptyState } from "./components/ui/Card.jsx";
import { RecordRow, RecordList, PageHero, Chip, ChipRow } from "./components/ui/Panels.jsx";
import { Input, Select, Label, FormGroup } from "./components/ui/Field.jsx";
import Button from "./components/ui/Button.jsx";
import StageMenu from "./components/ui/StageMenu.jsx";
import { stageLabel, stageTone } from "./lib/pipeline.js";
import { Briefcase, Users, AlertTriangle } from "lucide-react";
import "./index.css";

const REPORT = {
  candidate: { id: "c1", name: "Vijendra Pratap Singh", email: "v@example.com" },
  job: { title: "AI Innovation Lead / Senior AI/ML Consultant", department: "Engineering" },
  stage: "interview_scheduled",
  stageLabel: "Interview Scheduled",
  allowedNextStages: [
    { stage: "ai_interview_completed", label: "AI Interview Completed" },
    { stage: "under_review", label: "Under Review" },
    { stage: "shortlisted", label: "Shortlisted" },
    { stage: "rejected", label: "Rejected" },
  ],
  decisionTrail: { stage: "interview_scheduled", stageLabel: "Interview Scheduled", by: "system", at: "2026-08-02T16:30:00Z", note: "Assessment completed — AI interview invitation sent" },
  hasInterview: true,
  coverage: {
    rubricVersion: 1,
    // Flat, weight-descending, exactly as buildCoverageMatrix emits it.
    rows: [
      { criterionId: "c3", label: "Generative AI expertise", kind: "must_have", weight: 0.4, claimed: true, resume: "partial", assessment: "contradicted", assessmentDetail: { correctCount: 1, itemCount: 5 }, interview: "contradicted", probeCount: 1, bucket: "failed", evidence: "1 of 5 assessment items · contradicted in the interview", underpowered: false, decidingProbe: { question: "How was that system evaluated?", answerQuote: "We mostly eyeballed the outputs.", turnIndex: 3 } },
      { criterionId: "c1", label: "Python & ML tooling", kind: "must_have", weight: 0.2, claimed: true, resume: "verified", assessment: "verified", assessmentDetail: { correctCount: 6, itemCount: 6 }, interview: "verified", probeCount: 1, bucket: "proven", evidence: "6 of 6 assessment items · verified in the interview", underpowered: false, decidingProbe: null },
      { criterionId: "c2", label: "Team leadership", kind: "nice_to_have", weight: 0.15, claimed: true, resume: "partial", assessment: "untested", assessmentDetail: null, interview: "verified", probeCount: 1, bucket: "proven", evidence: "verified in the interview", underpowered: false, decidingProbe: null },
      { criterionId: "c4", label: "MLOps / deployment", kind: "must_have", weight: 0.15, claimed: false, resume: "absent", assessment: "partial", assessmentDetail: { correctCount: 2, itemCount: 5 }, interview: "untested", probeCount: 0, bucket: "insufficient", evidence: "2 of 5 assessment items · never probed in the interview", underpowered: true, decidingProbe: null },
      { criterionId: "c5", label: "Stakeholder communication", kind: "nice_to_have", weight: 0.1, claimed: true, resume: "partial", assessment: "untested", assessmentDetail: null, interview: "untested", probeCount: 0, bucket: "insufficient", evidence: "never probed in the interview", underpowered: true, decidingProbe: null },
    ],
    buckets: {
      proven: { weight: 0.35, rows: [{ criterionId: "c1", label: "Python & ML tooling", weight: 0.2, evidence: "6 of 6 assessment items · probed and confirmed" }, { criterionId: "c2", label: "Team leadership", weight: 0.15, evidence: "Probed in interview — concrete example given" }] },
      failed: { weight: 0.4, rows: [{ criterionId: "c3", label: "Generative AI expertise", weight: 0.4, evidence: "1 of 5 assessment items · probed, no verdict reached" }] },
      insufficient: { weight: 0.25, rows: [{ criterionId: "c4", label: "MLOps / deployment", weight: 0.15, evidence: "2 items only — too thin to call" }, { criterionId: "c5", label: "Stakeholder comms", weight: 0.1, evidence: "Never probed" }] },
    },
    totals: { insufficientWeight: 0.25, criteria: 5, underpoweredCriteria: 2, minItemsForCall: 4 },
  },
  interview: {
    status: "completed",
    engine: "ai",
    modality: "voice",
    questionCount: 6,
    maxQuestions: 8,
    startedAt: "2026-08-02T16:40:00Z",
    substance: { responsiveCount: 4, totalAnswers: 6, declinedCount: 1 },
    competencyTriplet: { communication: 72, technicalKnowledge: 48, problemSolving: 61 },
    competencyTable: [
      { competency: "backend", score: 55, evidence: "I'd probably use a queue there, but I haven't set one up myself." },
      { competency: "system_design", score: 64, evidence: "Split reads and writes, cache the hot path." },
    ],
    sessionQuality: {
      degraded: false,
      degradedCount: 2,
      total: 6,
      perTurn: [
        { index: 0, answerScore: 71, words: 84, audioMs: 42000, flags: [], degraded: false },
        { index: 1, answerScore: 55, words: 61, audioMs: 30000, flags: [], degraded: false },
        { index: 2, answerScore: 18, words: 4, audioMs: 51000, flags: ["stalled"], degraded: true },
        { index: 3, answerScore: 64, words: 77, audioMs: 38000, flags: [], degraded: false },
        { index: 4, answerScore: 12, words: 2, audioMs: 22000, flags: ["mostly_silence"], degraded: true },
        { index: 5, answerScore: 48, words: 40, audioMs: 26000, flags: [], degraded: false },
      ],
    },
    verdict: { verdict: "REVIEW", confidence: "Medium", reason: "Two answers were recorded on a degraded audio path and the highest-weight requirement is unproven." },
    recommendedAction: { action: "Send to a human technical round", justification: "40% of the role rests on generative AI expertise, which the interview did not settle either way.", suppressed: false },
    evaluation: {
      overallScore: 58,
      generatedBy: "ai",
      generatedAt: "2026-08-02T17:10:00Z",
      questionsAsked: 6,
      questionsAnswered: 5,
      questionsDeclined: 1,
      summary: "Solid delivery on tooling questions; the generative-AI line of questioning did not produce a concrete example.",
      strengths: ["Named the exact libraries and versions used", "Distinguished what they had shipped from what they had read about"],
      weaknesses: ["No first-hand example of a deployed LLM system", "Answers on evaluation methodology stayed abstract"],
      missingSkills: ["RAG evaluation", "Prompt regression testing"],
      delivery: 68,
      confidence: 74,
      spokenCommunication: { answersScored: 5, justification: "This role presents findings to non-technical executives weekly." },
    },
    transcript: [
      { role: "ai", text: "Tell me about a generative AI system you took to production." },
      { role: "candidate", text: "I've worked mostly on the evaluation side rather than shipping one end to end.", answerScore: 41, inputMode: "voice", wordCount: 14, durationSec: 22, responsive: true },
    ],
  },
  claimVerification: {
    probes: [
      { claimId: "p1", verdict: "verified", status: "asked", question: "Which model did you fine-tune?", resumeQuote: "Fine-tuned Llama-2 for internal search", answerQuote: "Llama-2 7B, LoRA, about 40k pairs.", verdictReasoning: "Specific and consistent with the résumé." },
      { claimId: "p2", verdict: "contradicted", status: "asked", question: "How was that system evaluated?", resumeQuote: "Built an eval harness for RAG quality", answerQuote: "We mostly eyeballed the outputs.", verdictReasoning: "The résumé claims a harness; the answer describes manual review." },
      { claimId: "p3", verdict: null, status: "asked", question: "Who owned the deployment?", resumeQuote: "Owned deployment end to end" },
    ],
    scoreDelta: { pre: { overallScore: 71 }, post: { overallScore: 63 }, delta: -8 },
  },
  proctoring: {
    displayRiskBand: "low",
    displayRiskScore: 12,
    visionEnabled: true,
    totalEvents: 2,
    identityMatch: { status: "match", distance: 0.217 },
    consent: { given: true },
    breakdown: [{ type: "tab_blur", label: "Left the tab", count: 2, severity: "low", scored: true }],
  },
  evidenceClips: [],
  assessment: {
    decision: { action: "sent" },
    session: {
      status: "scored",
      difficultyTier: { value: "medium", source: "claim_derived", basis: "senior claims on résumé" },
      result: {
        totalCorrect: 9,
        totalItems: 16,
        completedBy: "candidate",
        scoredAt: "2026-08-02T16:20:00Z",
        scorerVersion: "det-v3",
        reproducibilityHash: "9f2c4ab7710e55d3a1",
        perCriterion: [
          { criterionId: "c1", correctCount: 6, itemCount: 6 },
          { criterionId: "c3", correctCount: 1, itemCount: 5 },
          { criterionId: "c4", correctCount: 2, itemCount: 5 },
        ],
        claimVerdicts: [{ claimId: "p1", criterionId: "c1", verdict: "verified", correctCount: 6, itemCount: 6 }],
      },
    },
  },
};

api.defaults.adapter = async (config) => ({ data: REPORT, status: 200, statusText: "OK", headers: {}, config });

const ROWS = [
  { _id: "1", name: "Priya Sharma", email: "priya.sharma@example.com", score: 82, decision: "pass", engine: "evidence", status: "interview_scheduled" },
  { _id: "2", name: "Marcus Bell", email: "m.bell@example.com", score: 64, decision: "review", engine: "legacy", status: "ats_passed" },
  { _id: "3", name: "Aisha Khan", email: "aisha@example.com", score: 91, decision: "pass", engine: "evidence", status: "technical_interview" },
  { _id: "4", name: "Tom Reyes", email: "tom.reyes@example.com", score: null, decision: null, engine: null, status: "rejected" },
];

function CandidatesPreview() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Candidates</h1>
        <p className="mt-1 text-sm text-slate-500">
          List form with the stage control. Click <strong>Advance</strong> for the one-click move, or the chevron for the
          grouped menu — try <em>Aisha Khan</em> for the sideways-round group and <em>Reject</em> for the confirm step.
        </p>
      </div>
      <RecordList label="Candidates">
        {ROWS.map((c) => (
          <RecordRow
            key={c._id}
            avatar={<Avatar name={c.name} size="sm" />}
            title={c.name}
            subtitle={c.email}
            link={{ as: Link, to: "/candidates" }}
            meta={[{ label: "Applied", value: "12/07/2026" }]}
            trailing={
              <>
                {c.score != null ? (
                  <Badge tone={c.decision === "pass" ? "green" : c.decision === "fail" ? "red" : "slate"}>{c.score}%</Badge>
                ) : (
                  <Badge tone="slate">Not scored</Badge>
                )}
                <Badge tone={stageTone(c.status)}>{stageLabel(c.status)}</Badge>
              </>
            }
            note={
              c.score != null && c.engine !== "evidence" ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Legacy keyword match — rubric not approved
                </span>
              ) : null
            }
            actions={<StageMenu status={c.status} name={c.name} onMove={(s) => window.alert(`would move ${c.name} → ${s}`)} />}
          />
        ))}
      </RecordList>
    </div>
  );
}

function PalettePreview() {
  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Petrol on Bone"
        eyebrowIcon={Briefcase}
        title="Palette"
        description="Every surface, control and status pill after the repaint."
        points={["Colour on action", "Neutral on state", "Verdicts uncontested"]}
        action={<Button variant="accent">Clay CTA</Button>}
      />
      <Card>
        <p className="mb-3 text-xs font-semibold text-slate-500">Buttons</p>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="accent">Accent</Button>
          <Button disabled>Disabled</Button>
        </div>
        <p className="mt-6 mb-3 text-xs font-semibold text-slate-500">
          Badges — brand stays neutral so the three verdict tones own the channel
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="slate">Neutral</Badge>
          <Badge tone="brand">In progress</Badge>
          <Badge tone="green">Advanced</Badge>
          <Badge tone="amber">Awaiting a human</Badge>
          <Badge tone="red">Rejected</Badge>
        </div>
        <p className="mt-6 mb-3 text-xs font-semibold text-slate-500">Chips</p>
        <ChipRow label="filters">
          <Chip active>All stages</Chip>
          <Chip>Shortlisted</Chip>
          <Chip>Rejected</Chip>
        </ChipRow>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Applications" value="1,284" note="last 30 days" />
        <StatCard label="Interviews run" value="312" tone="brand" note="last 30 days" />
        <StatCard label="Offers out" value="19" tone="filled-brand" note="last 30 days" />
      </div>
      <Card>
        <p className="mb-3 text-xs font-semibold text-slate-500">Fields — tab into them to see the focus treatment</p>
        <FormGroup>
          <Label required>Job title</Label>
          <Input placeholder="Senior Backend Engineer" />
        </FormGroup>
        <FormGroup>
          <Label>Stage</Label>
          <Select>
            <option>Applied</option>
            <option>Shortlisted</option>
          </Select>
        </FormGroup>
        <p className="text-sm text-slate-600">
          A sentence with <Link to="/palette">an inline link</Link> in it — petrol, and underlined, because colour alone
          is never the only cue.
        </p>
      </Card>
      <EmptyState icon={Users} title="Empty state" description="Dashed border on a brand wash — the one place dashed is allowed." />
    </div>
  );
}

const TABS = [
  { to: "/candidates/c1/interview-report", label: "1 · Interview report" },
  { to: "/candidates", label: "2 · Candidate list + stage menu" },
  { to: "/palette", label: "3 · Palette" },
];

function Shell() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-3">
          <span className="mr-3 text-sm font-bold text-slate-900">Design preview</span>
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <Routes>
          <Route path="/candidates/:id/interview-report" element={<InterviewReport />} />
          <Route path="/candidates" element={<CandidatesPreview />} />
          <Route path="/palette" element={<PalettePreview />} />
          <Route path="*" element={<CandidatesPreview />} />
        </Routes>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <MemoryRouter initialEntries={["/candidates/c1/interview-report"]}>
    <ToastProvider>
      <Shell />
    </ToastProvider>
  </MemoryRouter>
);
