// Agentic item generation with the blind-solve QA gate (ASSESSMENT-ENGINE-PLAN
// A1.3). The gate is the assessment version of cite-or-abstain: a generated item
// is only trustworthy if N independent solvers — WHO NEVER SEE THE KEY — converge
// on it. Unanimous agreement with the key ⇒ active; any disagreement means the
// item is ambiguous or wrong ⇒ one revision cycle, then `flagged` with the
// solver split stored and shown to the recruiter. Disagreement is a routing
// signal (rule 4), applied to our OWN generated content.
//
// Cost shape (§7): everything here runs ONCE per paper version, at authoring
// time, metered (`item_gen` / `item_solve`) and capped — per-paper call ceiling
// plus the tenant's monthly AI budget. Zero marginal LLM cost per candidate.
// The run is resumable: items persist as they pass.

const AssessmentPaper = require("../models/AssessmentPaper");
const CompanySettings = require("../models/CompanySettings");
const RoleRubric = require("../models/RoleRubric");
const llm = require("./llmService");
const usageService = require("./usageService");
const { resolveRole } = require("../config/models");
const {
  ITEM_GEN_PROMPT_VERSION,
  ITEM_GEN_SYSTEM,
  ITEM_GEN_SCHEMA,
  itemGenPrompt,
  SOLVER_PROMPT_VERSION,
  SOLVER_SYSTEM,
  SOLVER_SCHEMA,
  buildSolverPrompt,
} = require("../utils/assessmentPrompts");

const PROVIDER = "openrouter";
const OPTION_IDS = ["a", "b", "c", "d", "e"];
const SOLVER_N = Number(process.env.ASSESSMENT_SOLVER_N) || 3;

// Per-paper hard ceilings (§A1 guardrails). Tiered pools are the one authoring
// cost multiplier — these caps keep the one-time cost bounded.
function maxItemsPerPaper() {
  return Number(process.env.ASSESSMENT_MAX_ITEMS_PER_PAPER) || 60;
}
function maxLlmCallsPerPaper() {
  return Number(process.env.ASSESSMENT_MAX_GEN_CALLS_PER_PAPER) || 400;
}
function poolCapPerTier() {
  return Number(process.env.ASSESSMENT_POOL_CAP_PER_TIER) || 8; // per section per tier
}

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

// --- Spec building (deterministic) -------------------------------------------

// Round-robin item types per criterion so a section isn't 100% mcq_single.
// numeric/ordering appear sparsely — they're harder to generate unambiguously.
const TYPE_CYCLE = ["mcq_single", "mcq_single", "mcq_multi", "mcq_single", "ordering", "mcq_single", "mcq_multi", "numeric"];

/**
 * Expand a paper's sections into concrete item specs.
 * fixed mode        → one pool per section following the section's difficultyMix,
 *                     scaled to poolItemCount.
 * claim_tiered mode → one pool PER TIER per section (all items of that tier's
 *                     difficulty), each capped at poolCapPerTier().
 */
function buildSpecs(paper, rubric) {
  const criteriaById = new Map(rubric.criteria.map((c) => [c.id, c]));
  const specs = [];
  let typeCursor = 0;

  const pushSpec = (section, criterionId, difficulty) => {
    const criterion = criteriaById.get(criterionId);
    if (!criterion) return;
    specs.push({
      sectionId: section.id,
      criterionId,
      criterion,
      difficulty,
      type: TYPE_CYCLE[typeCursor++ % TYPE_CYCLE.length],
      probeHint: criterion.probeHint || "",
    });
  };

  for (const section of paper.sections) {
    if (paper.difficultyPolicy?.mode === "claim_tiered") {
      const perTier = Math.min(section.poolItemCount, poolCapPerTier());
      for (const tier of ["easy", "medium", "hard"]) {
        for (let i = 0; i < perTier; i++) {
          pushSpec(section, section.criterionIds[i % section.criterionIds.length], tier);
        }
      }
    } else {
      const mix = section.difficultyMix || {};
      const total = Math.max(1, (mix.easy || 0) + (mix.medium || 0) + (mix.hard || 0));
      const scale = section.poolItemCount / total;
      const counts = {
        easy: Math.round((mix.easy || 0) * scale),
        medium: Math.round((mix.medium || 0) * scale),
        hard: Math.round((mix.hard || 0) * scale),
      };
      let i = 0;
      for (const difficulty of ["easy", "medium", "hard"]) {
        for (let n = 0; n < counts[difficulty]; n++) {
          pushSpec(section, section.criterionIds[i++ % section.criterionIds.length], difficulty);
        }
      }
    }
  }
  return specs.slice(0, maxItemsPerPaper());
}

// --- Shape validation (code, not the model) ----------------------------------

/** Map the model's index-based key onto stable option ids; null = malformed. */
function normaliseGenerated(spec, data) {
  const stem = typeof data.stem === "string" ? data.stem.trim() : "";
  if (!stem) return null;
  const optionTexts = (Array.isArray(data.options) ? data.options : []).map((t) => String(t || "").trim()).filter(Boolean);
  const keyIndexes = Array.isArray(data.keyIndexes) ? data.keyIndexes.filter((n) => Number.isInteger(n)) : [];

  const options = optionTexts.slice(0, OPTION_IDS.length).map((text, i) => ({ id: OPTION_IDS[i], text }));
  const validIndex = (i) => i >= 0 && i < options.length;

  let key;
  switch (spec.type) {
    case "mcq_single":
      if (options.length !== 4 || keyIndexes.length !== 1 || !validIndex(keyIndexes[0])) return null;
      key = { optionIds: [options[keyIndexes[0]].id] };
      break;
    case "mcq_multi": {
      if (options.length < 4 || keyIndexes.length < 2 || keyIndexes.length > 3) return null;
      const unique = [...new Set(keyIndexes)];
      if (unique.length !== keyIndexes.length || !unique.every(validIndex)) return null;
      key = { optionIds: unique.map((i) => options[i].id).sort() };
      break;
    }
    case "numeric": {
      const value = Number(data.keyValue);
      if (!Number.isFinite(value)) return null;
      const tolerance = Number.isFinite(Number(data.keyTolerance)) ? Math.abs(Number(data.keyTolerance)) : 0;
      key = { value, tolerance };
      return { stem, options: [], key };
    }
    case "ordering": {
      if (options.length !== 4 || keyIndexes.length !== 4) return null;
      const unique = [...new Set(keyIndexes)];
      if (unique.length !== 4 || !unique.every(validIndex)) return null;
      key = { order: keyIndexes.map((i) => options[i].id) };
      break;
    }
    default:
      return null;
  }
  return { stem, options, key };
}

/** Compare one blind solver's answer with the key — pure code, exported for tests. */
function solverAgreesWithKey(type, key, answer) {
  const ids = (Array.isArray(answer?.answerOptionIds) ? answer.answerOptionIds : [])
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean);
  switch (type) {
    case "mcq_single":
      return ids.length === 1 && ids[0] === key.optionIds[0];
    case "mcq_multi": {
      if (ids.length !== key.optionIds.length) return false;
      const set = new Set(ids);
      return key.optionIds.every((id) => set.has(id));
    }
    case "numeric": {
      const value = Number(answer?.answerValue);
      if (!Number.isFinite(value)) return false;
      return Math.abs(value - key.value) <= (key.tolerance || 0);
    }
    case "ordering":
      return ids.length === key.order.length && ids.every((id, i) => id === key.order[i]);
    default:
      return false;
  }
}

// --- LLM calls ---------------------------------------------------------------

async function callGen(spec, settings, companyId, revisionNote) {
  const resolved = resolveRole("reasoning", settings);
  const t0 = Date.now();
  const { data, usage, model, cached } = await llm.generateJSON({
    system: ITEM_GEN_SYSTEM,
    prompt: itemGenPrompt({ ...spec, revisionNote }),
    schema: ITEM_GEN_SCHEMA,
    maxTokens: 1024,
    model: resolved.model,
    temperature: 0,
    promptVersion: ITEM_GEN_PROMPT_VERSION,
  });
  await usageService.recordUsage({
    company: companyId,
    kind: "item_gen",
    provider: PROVIDER,
    model,
    usage,
    latencyMs: Date.now() - t0,
    engine: "ai",
    promptVersion: ITEM_GEN_PROMPT_VERSION,
    cached,
  });
  return { data, model };
}

// Presents the options to solver #i in a rotated order — a cheap perturbation so
// three solvers don't share position bias. The struct passed to
// buildSolverPrompt contains stem + options ONLY; the key cannot leak because
// this function never receives it (unit-pinned).
async function callSolver({ type, stem, options }, solverIndex, settings, companyId) {
  const rotated = options.length
    ? options.slice(solverIndex % options.length).concat(options.slice(0, solverIndex % options.length))
    : [];
  const resolved = resolveRole("cheap", settings);
  const t0 = Date.now();
  const { data, usage, model, cached } = await llm.generateJSON({
    system: SOLVER_SYSTEM,
    prompt: buildSolverPrompt({ type, stem, options: rotated }),
    schema: SOLVER_SCHEMA,
    maxTokens: 256,
    model: resolved.model,
    temperature: 0,
    // Solver index in the promptVersion keeps the N calls from collapsing into
    // one cache entry (the deterministic cache keys on the full request shape).
    promptVersion: `${SOLVER_PROMPT_VERSION}#s${solverIndex}`,
  });
  await usageService.recordUsage({
    company: companyId,
    kind: "item_solve",
    provider: PROVIDER,
    model,
    usage,
    latencyMs: Date.now() - t0,
    engine: "ai",
    promptVersion: SOLVER_PROMPT_VERSION,
    cached,
  });
  return data;
}

async function blindSolve(spec, generated, settings, companyId, budget) {
  const answers = [];
  let agreed = 0;
  for (let i = 0; i < SOLVER_N; i++) {
    budget.spendCall();
    const answer = await callSolver({ type: spec.type, stem: generated.stem, options: generated.options }, i, settings, companyId);
    answers.push(answer);
    if (solverAgreesWithKey(spec.type, generated.key, answer)) agreed += 1;
  }
  return { n: SOLVER_N, agreedWithKey: agreed, solverAnswers: answers };
}

function describeDisagreement(spec, generated, solve) {
  const wrong = solve.solverAnswers
    .filter((a) => !solverAgreesWithKey(spec.type, generated.key, a))
    .map((a) => (spec.type === "numeric" ? String(a?.answerValue) : (a?.answerOptionIds || []).join(",")));
  return `${solve.agreedWithKey}/${solve.n} solvers agreed with the key; dissenting answers: [${wrong.join(" | ")}]`;
}

// --- One item through the full gate ------------------------------------------

async function produceItem(spec, itemId, settings, companyId, budget) {
  budget.spendCall();
  let { data, model } = await callGen(spec, settings, companyId);
  let generated = normaliseGenerated(spec, data);
  if (!generated) return null; // malformed shape — counted as failed, never kept

  let solve = await blindSolve(spec, generated, settings, companyId, budget);
  let revisions = 0;

  if (solve.agreedWithKey !== solve.n) {
    // One revision cycle with the disagreement fed back, then re-solve.
    revisions = 1;
    budget.spendCall();
    const revision = await callGen(spec, settings, companyId, describeDisagreement(spec, generated, solve));
    const revised = normaliseGenerated(spec, revision.data);
    if (revised) {
      generated = revised;
      model = revision.model;
      solve = await blindSolve(spec, generated, settings, companyId, budget);
    }
  }

  const passed = solve.agreedWithKey === solve.n;
  return {
    id: itemId,
    sectionId: spec.sectionId,
    criterionId: spec.criterionId,
    targetsProbeHint: Boolean(spec.probeHint),
    type: spec.type,
    stem: generated.stem,
    options: generated.options,
    key: generated.key,
    difficulty: spec.difficulty,
    rationale: typeof data.rationale === "string" ? data.rationale : "",
    generation: {
      model,
      promptVersion: ITEM_GEN_PROMPT_VERSION,
      at: new Date(),
      blindSolve: { ...solve, revisions },
    },
    status: passed ? "active" : "flagged",
  };
}

// --- The run (async, resumable, budget-capped) -------------------------------

function makeBudget(alreadySpent = 0) {
  const ceiling = maxLlmCallsPerPaper();
  let calls = alreadySpent;
  return {
    spendCall() {
      calls += 1;
      if (calls > ceiling) {
        throw httpError(429, `Per-paper generation ceiling reached (${ceiling} LLM calls) — the partial pool is kept`, "PAPER_GEN_CEILING");
      }
    },
    get calls() {
      return calls;
    },
  };
}

/**
 * Generate the item pools for a draft paper. Long-running: callers fire this
 * without awaiting and poll paper.generationRun. Items persist as they pass, so
 * a crash or budget stop resumes where it left off (specs already covered by
 * existing items are skipped).
 */
async function runGeneration(paperId, companyId) {
  const paper = await AssessmentPaper.findOne({ _id: paperId, company: companyId });
  if (!paper) throw httpError(404, "Assessment paper not found");
  if (paper.status !== "draft") throw httpError(409, "Items can only be generated on a draft paper");
  if (paper.generationRun?.status === "running") throw httpError(409, "Generation is already running for this paper");
  if (!llm.isEnabled()) {
    throw httpError(503, "Assessment generation needs the AI engine (no LLM key configured) — there is no template fallback", "ASSESSMENT_LLM_UNAVAILABLE");
  }

  const settings = await CompanySettings.findOne({ company: companyId }).select("ai assessments");
  if (await usageService.isOverBudget(companyId, settings?.ai)) {
    throw httpError(429, "Monthly AI budget exhausted — item generation blocked", "AI_BUDGET_EXHAUSTED");
  }
  const rubric = await RoleRubric.findById(paper.rubric);
  if (!rubric) throw httpError(409, "The paper's rubric no longer exists — recompile the paper");

  const specs = buildSpecs(paper, rubric);

  // Resume support: count how many items already exist per (section, difficulty)
  // and skip that many specs.
  const have = new Map();
  for (const item of paper.items) {
    const k = `${item.sectionId}|${item.difficulty}`;
    have.set(k, (have.get(k) || 0) + 1);
  }
  const pending = [];
  const consumed = new Map();
  for (const spec of specs) {
    const k = `${spec.sectionId}|${spec.difficulty}`;
    const used = consumed.get(k) || 0;
    if (used < (have.get(k) || 0)) consumed.set(k, used + 1);
    else pending.push(spec);
  }

  paper.generationRun = {
    status: "running",
    startedAt: new Date(),
    generated: paper.items.filter((i) => i.status === "active").length,
    flagged: paper.items.filter((i) => i.status === "flagged").length,
    failed: 0,
    target: specs.length,
    message: "",
  };
  await paper.save();

  const budget = makeBudget();
  let itemSeq = paper.items.length;

  try {
    for (const spec of pending) {
      // Re-check the tenant budget between items — a long run must not blow
      // through a cap that filled up while it was running.
      if (await usageService.isOverBudget(companyId, settings?.ai)) {
        paper.generationRun.message = "Stopped: monthly AI budget exhausted mid-run. The partial pool is kept — resume after raising the cap.";
        break;
      }
      let item = null;
      try {
        item = await produceItem(spec, `it${++itemSeq}`, settings, companyId, budget);
      } catch (err) {
        if (err.code === "PAPER_GEN_CEILING") {
          paper.generationRun.message = err.message;
          break;
        }
        console.warn(`[itemGen] item generation failed (${spec.sectionId}/${spec.criterionId}): ${err.code || err.message}`);
        paper.generationRun.failed += 1;
        continue;
      }
      if (!item) {
        paper.generationRun.failed += 1;
        continue;
      }
      paper.items.push(item);
      if (item.status === "active") paper.generationRun.generated += 1;
      else paper.generationRun.flagged += 1;
      paper.markModified("items");
      await paper.save(); // persist as we go — the run is resumable by design
    }
    paper.generationRun.status = "completed";
  } catch (err) {
    paper.generationRun.status = "failed";
    paper.generationRun.message = err.message;
  }
  paper.generationRun.finishedAt = new Date();
  await paper.save();
  return paper;
}

/**
 * Regenerate ONE item on a draft (recruiter reviewed it and wants a fresh take).
 * The old item is replaced in place; provenance and the blind-solve result are
 * fresh. Draft-only — post-freeze regeneration means a new paper version.
 */
async function regenerateItem(paperId, companyId, itemId) {
  const paper = await AssessmentPaper.findOne({ _id: paperId, company: companyId });
  if (!paper) throw httpError(404, "Assessment paper not found");
  if (paper.status !== "draft") throw httpError(409, "Items can only be regenerated on a draft paper — approve creates a frozen version");
  const idx = paper.items.findIndex((i) => i.id === itemId);
  if (idx === -1) throw httpError(404, "Item not found on this paper");
  if (!llm.isEnabled()) throw httpError(503, "Assessment generation needs the AI engine (no LLM key configured)", "ASSESSMENT_LLM_UNAVAILABLE");

  const settings = await CompanySettings.findOne({ company: companyId }).select("ai");
  if (await usageService.isOverBudget(companyId, settings?.ai)) {
    throw httpError(429, "Monthly AI budget exhausted — regeneration blocked", "AI_BUDGET_EXHAUSTED");
  }
  const rubric = await RoleRubric.findById(paper.rubric);
  const old = paper.items[idx];
  const criterion = rubric?.criteria.find((c) => c.id === old.criterionId);
  if (!criterion) throw httpError(409, "The item's criterion no longer exists on the rubric");

  const spec = {
    sectionId: old.sectionId,
    criterionId: old.criterionId,
    criterion,
    difficulty: old.difficulty,
    type: old.type,
    probeHint: criterion.probeHint || "",
  };
  const budget = makeBudget();
  const fresh = await produceItem(spec, old.id, settings, companyId, budget);
  if (!fresh) throw httpError(502, "Regeneration produced a malformed item — try again");

  paper.items[idx] = fresh;
  paper.markModified("items");
  await paper.save();
  return paper;
}

module.exports = { runGeneration, regenerateItem, buildSpecs, normaliseGenerated, solverAgreesWithKey };
