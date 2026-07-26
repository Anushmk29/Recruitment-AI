// Claim → Probe → Verdict loop (BUILD-PLAN Phase 8).
//
//   Pre-interview assessment computes unverifiedHighWeightClaims (Phase 6)
//     → generateProbesForSession: each becomes ONE neutral interview question
//       with precomputed verify/contradict conditions (probe_gen, capped)
//     → the interview plan treats probes as REQUIRED COVERAGE (Phase 8.2)
//     → after the interview, assessVerdicts judges each asked probe against
//       its stated conditions, with a code-verified verbatim answer quote
//     → verdicts write back to the ClaimGraph (verificationStatus)
//     → rescoreAfterInterview re-runs the PURE scorer: the verification
//       multiplier moves, so proof changes the number. Stored as a SECOND
//       assessment (stage post_interview) — never a mutation of the first.
//
// Hard rules:
//   - A `contradicted` verdict NEVER auto-rejects; it surfaces to a human
//     with both quotes. No pipeline transition happens here.
//   - Accusatory probe phrasing is dropped in code (probePhrasingIssues).
//   - Any failure anywhere ⇒ the interview runs exactly as today.

const AtsAssessment = require("../models/AtsAssessment");
const ClaimGraph = require("../models/ClaimGraph");
const RoleRubric = require("../models/RoleRubric");
const CompanySettings = require("../models/CompanySettings");
const llm = require("./llmService");
const usageService = require("./usageService");
const { resolveRole } = require("../config/models");
const {
  PROBE_PROMPT_VERSION,
  PROBE_SYSTEM,
  PROBE_SCHEMA,
  probePrompt,
  VERDICT_SYSTEM,
  VERDICT_SCHEMA,
  verdictPrompt,
  probePhrasingIssues,
  claimStatement,
} = require("../utils/probePrompts");
const { computeAssessment, reproducibilityHash, claimsStateHash, SCORER_VERSION } = require("../utils/evidenceScorer");
const { checkInvariants } = require("../utils/assessmentInvariants");

const PROVIDER = "openrouter";
const PROBE_CAP = 4; // probes are capped so the interview stays an interview

function isEnabled() {
  const v = process.env.PROBE_ENGINE_ENABLED;
  return v !== "false" && v !== "0";
}

// ---------------------------------------------------------------------------
// Pure sanitisers (exported for tests) — cite-or-drop for probes and verdicts
// ---------------------------------------------------------------------------

/**
 * Keep only probes that: reference a requested claim (no ghosts), carry a
 * non-empty question that passes the neutrality check, and state both verdict
 * conditions. One probe per claim; order follows the requested list.
 */
function sanitiseProbes(rawProbes, requestedClaims) {
  const byId = new Map(requestedClaims.map((c) => [c.id, c]));
  const seen = new Set();
  const kept = [];
  const dropped = [];
  for (const p of rawProbes || []) {
    const claim = byId.get(p?.claimId);
    if (!claim || seen.has(p.claimId)) {
      dropped.push({ claimId: p?.claimId, reason: "unknown_or_duplicate_claim" });
      continue;
    }
    const question = String(p.question || "").trim();
    const verify = String(p.whatWouldVerify || "").trim();
    const contradict = String(p.whatWouldContradict || "").trim();
    if (!question || !verify || !contradict) {
      dropped.push({ claimId: p.claimId, reason: "missing_fields" });
      continue;
    }
    const issues = probePhrasingIssues(question);
    if (issues.length > 0) {
      dropped.push({ claimId: p.claimId, reason: `accusatory_phrasing:${issues.join(",")}` });
      continue;
    }
    seen.add(p.claimId);
    kept.push({
      claimId: p.claimId,
      question: question.slice(0, 600),
      whatWouldVerify: verify.slice(0, 800),
      whatWouldContradict: contradict.slice(0, 800),
      resumeQuote: claim.spans?.[0]?.quote || "",
      status: "pending",
    });
  }
  return { probes: kept.slice(0, PROBE_CAP), dropped };
}

/**
 * Keep only verdicts that reference an assessed item; a verified/contradicted
 * verdict whose answerQuote is not a verbatim substring of the candidate's
 * answer is DOWNGRADED to inconclusive (cite-or-abstain — the same rule the
 * extractor lives under). Missing verdicts default to inconclusive.
 */
function sanitiseVerdicts(rawVerdicts, items) {
  const byId = new Map(items.map((it) => [it.claimId, it]));
  const out = new Map();
  for (const v of rawVerdicts || []) {
    const item = byId.get(v?.claimId);
    if (!item || out.has(v.claimId)) continue;
    let verdict = ["verified", "contradicted", "inconclusive"].includes(v.verdict) ? v.verdict : "inconclusive";
    let answerQuote = String(v.answerQuote || "").trim();
    let reasoning = String(v.reasoning || "").slice(0, 1200);
    if (verdict !== "inconclusive") {
      if (!answerQuote || !String(item.answerText || "").includes(answerQuote)) {
        verdict = "inconclusive";
        answerQuote = "";
        reasoning = `Downgraded to inconclusive: the cited answer quote was not a verbatim part of the answer. Original reasoning: ${reasoning}`.slice(0, 1200);
      }
    } else {
      answerQuote = "";
    }
    out.set(v.claimId, { claimId: v.claimId, verdict, reasoning, answerQuote: answerQuote.slice(0, 600) });
  }
  // Every asked probe gets a verdict row — unanswered by the model ⇒ inconclusive.
  return items.map(
    (it) =>
      out.get(it.claimId) || {
        claimId: it.claimId,
        verdict: "inconclusive",
        reasoning: "No verdict returned by the assessor for this probe.",
        answerQuote: "",
      }
  );
}

/**
 * Apply verdicts to claim verificationStatus (pure; mutates the passed array
 * items). verified → verified_in_interview, contradicted →
 * contradicted_in_interview, inconclusive → unchanged. Returns changed count.
 */
function applyVerdictsToClaims(claims, verdicts) {
  const byId = new Map((claims || []).map((c) => [c.id, c]));
  let changed = 0;
  for (const v of verdicts || []) {
    const claim = byId.get(v.claimId);
    if (!claim) continue;
    const next =
      v.verdict === "verified" ? "verified_in_interview" : v.verdict === "contradicted" ? "contradicted_in_interview" : null;
    if (next && claim.verificationStatus !== next) {
      claim.verificationStatus = next;
      changed += 1;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// 8.1 — probe generation (at interview start; failure ⇒ no probes, no error)
// ---------------------------------------------------------------------------

async function generateProbesForSession(session, candidate) {
  if (!isEnabled() || !llm.isEnabled()) return { probes: [], engine: "none" };
  try {
    const assessment = await AtsAssessment.findOne({
      candidate: candidate._id,
      company: session.company,
      stage: "pre_interview",
    }).sort({ createdAt: -1 });
    if (!assessment || !(assessment.unverifiedHighWeightClaims || []).length) return { probes: [], engine: "none" };

    const graph = await ClaimGraph.findById(assessment.claimGraph);
    if (!graph) return { probes: [], engine: "none" };
    const claimsById = new Map(graph.claims.map((c) => [c.id, c]));
    const targets = assessment.unverifiedHighWeightClaims
      .map((u) => ({ claim: claimsById.get(u.claimId), criterionId: u.criterionId }))
      .filter((t) => t.claim)
      .slice(0, PROBE_CAP);
    if (!targets.length) return { probes: [], engine: "none" };

    const settings = await CompanySettings.findOne({ company: session.company }).select("ai");
    const resolved = resolveRole("reasoning", settings);
    const t0 = Date.now();
    const { data, usage, model, cached } = await llm.generateJSON({
      system: PROBE_SYSTEM,
      prompt: probePrompt(targets.map((t) => t.claim)),
      schema: PROBE_SCHEMA,
      maxTokens: 1200,
      model: resolved.model,
      temperature: 0,
      promptVersion: PROBE_PROMPT_VERSION,
    });
    await usageService.recordUsage({
      company: session.company,
      session: session._id,
      candidate: candidate._id,
      kind: "probe_gen",
      provider: PROVIDER,
      model,
      usage,
      latencyMs: Date.now() - t0,
      engine: "ai",
      promptVersion: PROBE_PROMPT_VERSION,
      cached,
    });

    const { probes, dropped } = sanitiseProbes(data.probes, targets.map((t) => t.claim));
    if (dropped.length) {
      console.warn(`[probes] dropped ${dropped.length} probe(s) for session ${session._id}: ${dropped.map((d) => d.reason).join("; ")}`);
    }
    const criterionByClaim = new Map(targets.map((t) => [t.claim.id, t.criterionId]));
    for (const p of probes) p.criterionId = criterionByClaim.get(p.claimId) || "";
    return { probes, engine: "ai", model };
  } catch (err) {
    // Guardrail: probe-generation failure means the interview runs exactly as today.
    console.error("[probes] generation failed — interview proceeds without probes:", err.message);
    return { probes: [], engine: "none" };
  }
}

// ---------------------------------------------------------------------------
// 8.4 — verdict assessment (at finalisation, off the candidate request path)
// ---------------------------------------------------------------------------

function answerTextForProbe(turns, probe) {
  if (probe.turnIndex == null) return "";
  for (let i = probe.turnIndex + 1; i < turns.length; i += 1) {
    if (turns[i].role === "candidate") return turns[i].text || "";
  }
  return "";
}

/**
 * Assess all asked probes on a completed session, write verdicts to the
 * session AND back to the ClaimGraph. Returns the verdict rows (empty when
 * nothing to assess or the LLM is unavailable).
 */
async function assessVerdicts(session, candidate) {
  const ai = session.aiInterview;
  const asked = (ai.probes || []).filter((p) => p.status === "asked");
  if (!asked.length) return [];
  if (!isEnabled() || !llm.isEnabled()) return [];

  const graph = await ClaimGraph.findOne({
    candidate: candidate._id,
    company: session.company,
  }).sort({ createdAt: -1 });
  const claimsById = new Map((graph?.claims || []).map((c) => [c.id, c]));

  const items = asked
    .map((p) => {
      const claim = claimsById.get(p.claimId);
      return {
        claimId: p.claimId,
        statement: claim ? claimStatement(claim) : p.resumeQuote || p.claimId,
        question: p.question,
        whatWouldVerify: p.whatWouldVerify,
        whatWouldContradict: p.whatWouldContradict,
        answerText: answerTextForProbe(ai.turns, p),
      };
    })
    .filter((it) => it.answerText.trim());
  if (!items.length) return [];

  try {
    const settings = await CompanySettings.findOne({ company: session.company }).select("ai");
    const resolved = resolveRole("reasoning", settings);
    const t0 = Date.now();
    const { data, usage, model, cached } = await llm.generateJSON({
      system: VERDICT_SYSTEM,
      prompt: verdictPrompt(items),
      schema: VERDICT_SCHEMA,
      maxTokens: 1600,
      model: resolved.model,
      temperature: 0,
      promptVersion: PROBE_PROMPT_VERSION,
    });
    await usageService.recordUsage({
      company: session.company,
      session: session._id,
      candidate: candidate._id,
      kind: "verdict",
      provider: PROVIDER,
      model,
      usage,
      latencyMs: Date.now() - t0,
      engine: "ai",
      promptVersion: PROBE_PROMPT_VERSION,
      cached,
    });

    const verdicts = sanitiseVerdicts(data.verdicts, items);

    // Write verdicts onto the session's probes…
    const byId = new Map(verdicts.map((v) => [v.claimId, v]));
    for (const p of ai.probes) {
      const v = byId.get(p.claimId);
      if (!v || p.status !== "asked") continue;
      p.status = "assessed";
      p.verdict = v.verdict;
      p.verdictReasoning = v.reasoning;
      p.answerQuote = v.answerQuote;
      p.assessedAt = new Date();
    }
    await session.save();

    // …and back into the ClaimGraph (the write-back that makes rescoring real).
    if (graph) {
      const changed = applyVerdictsToClaims(graph.claims, verdicts);
      if (changed > 0) {
        graph.markModified("claims");
        await graph.save();
      }
    }
    return verdicts;
  } catch (err) {
    console.error("[probes] verdict assessment failed — claims stay unverified:", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 8.5 — post-interview rescore (pure scorer re-run; a SECOND assessment)
// ---------------------------------------------------------------------------

/**
 * Re-run the deterministic scorer over the (now verdict-updated) ClaimGraph
 * using the pre-interview assessment's own matcher findings. Zero LLM spend:
 * only the verification multipliers move. Persists stage "post_interview";
 * never overwrites anything. Returns { pre, post } or null when no rescore
 * is possible.
 */
async function rescoreAfterInterview(candidate, { session } = {}) {
  const pre = await AtsAssessment.findOne({
    candidate: candidate._id,
    company: candidate.company,
    stage: "pre_interview",
    engine: "evidence",
  }).sort({ createdAt: -1 });
  if (!pre) return null;

  const graph = await ClaimGraph.findById(pre.claimGraph);
  const rubric = await RoleRubric.findById(pre.rubric);
  if (!graph || !rubric) return null;

  const claims = graph.claims.map((c) => (c.toObject ? c.toObject() : c));
  const stateHash = claimsStateHash(claims);

  // Idempotent: if the latest post_interview assessment already reflects this
  // exact claim-verification state, don't append a duplicate.
  const existingPost = await AtsAssessment.findOne({
    candidate: candidate._id,
    company: candidate.company,
    stage: "post_interview",
  }).sort({ createdAt: -1 });

  const findings = pre.criterionFindings.map((f) => ({
    criterionId: f.criterionId,
    status: f.status,
    supportingClaimIds: f.supportingClaimIds,
    reasoning: f.reasoning,
    confidence: f.confidence,
  }));

  const computed = computeAssessment({ rubric, claims, findings });

  const violations = checkInvariants({ assessment: computed, rubric, claims, canonicalText: candidate.resumeText || "" });
  if (violations.length > 0) {
    console.error(`[probes] post-interview rescore FAILED invariants for candidate ${candidate._id}: ${violations.join(" · ")}`);
    return null;
  }

  const hash = reproducibilityHash({
    rubricId: String(rubric._id),
    rubricVersion: rubric.version,
    resumeHash: pre.resumeHash,
    promptVersions: pre.promptVersions,
    modelId: pre.model,
    claimsStateHash: stateHash,
  });
  if (existingPost && existingPost.reproducibilityHash === hash) return { pre, post: existingPost };

  const post = await AtsAssessment.create({
    candidate: candidate._id,
    job: pre.job,
    company: candidate.company,
    rubric: rubric._id,
    rubricVersion: rubric.version,
    claimGraph: graph._id,
    resumeHash: pre.resumeHash,
    stage: "post_interview",
    mode: pre.mode,
    thresholds: pre.thresholds,
    overallScore: computed.overallScore,
    band: computed.band,
    decision: computed.decision,
    reviewReason: computed.reviewReason,
    criterionFindings: computed.criterionFindings,
    topEvidence: computed.topEvidence,
    unverifiedHighWeightClaims: computed.unverifiedHighWeightClaims,
    qa: { mode: "off", outcome: "passed", reasons: [], counterfactual: { ran: false } },
    engine: "evidence",
    model: pre.model,
    promptVersions: pre.promptVersions,
    scorerVersion: SCORER_VERSION,
    reproducibilityHash: hash,
    scoredAt: new Date(),
  });
  if (session) console.log(`[probes] post-interview rescore for candidate ${candidate._id}: ${pre.overallScore} → ${post.overallScore}`);
  return { pre, post };
}

/**
 * The whole post-interview leg in one call (used by interview finalisation):
 * verdicts → write-back → rescore. Never throws — a failure here must never
 * block interview completion.
 */
async function finalizeProbes(session, candidate) {
  try {
    const verdicts = await assessVerdicts(session, candidate);
    const rescore = await rescoreAfterInterview(candidate, { session });
    return { verdicts, rescore };
  } catch (err) {
    console.error("[probes] finalisation failed:", err.message);
    return { verdicts: [], rescore: null };
  }
}

module.exports = {
  isEnabled,
  PROBE_CAP,
  generateProbesForSession,
  assessVerdicts,
  rescoreAfterInterview,
  finalizeProbes,
  // pure, for tests
  sanitiseProbes,
  sanitiseVerdicts,
  applyVerdictsToClaims,
  answerTextForProbe,
};
