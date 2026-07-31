# Competitive Read: `interviewstreet/hiring-agent` — What It Means For Us

_2026-07-30. Analysis of [github.com/interviewstreet/hiring-agent](https://github.com/interviewstreet/hiring-agent)
(HackerRank's open-sourced intern-screening demo, MIT, 6.6k★) against the [Product Thesis](CLAUDE.md), run
through the mandatory three-question differentiation discipline. This is a decision-support document, not a
committed roadmap — anything under "Candidate additions" needs an owner call before it becomes a
[BUILD-PLAN.md](BUILD-PLAN.md) phase._

---

## 1. What was analyzed

HackerRank is explicit that this is a demo, not their production ATS and not used for their own hiring. That
makes it a fair, non-strawman specimen rather than a competitor to beat — but it's a popular, real-world
example of the exact pattern the Product Thesis argues against, and it's the kind of thing a buyer may have
already tried.

**Pipeline** (traced from source, not from the README):

1. `pdf.py` — PyMuPDF → Markdown, then six separate LLM calls fill a JSON-Resume Pydantic model. No
   character-offset tracking anywhere; extracted facts cannot be traced back to a source location.
2. `github.py` — resolves the candidate's GitHub username, pulls profile + repos via the REST API, classifies
   `open_source` vs `self_project` by contributor count, then fires **another** LLM call to pick the "best 7"
   projects.
3. `evaluator.py` — one LLM call per résumé, temperature 0.5, against a schema built at runtime from
   `role.json`. The response **is** the score: each category returns `{score: float, max: int, evidence: str}`
   — the model emits the number directly, already told its own ceiling.
4. `score.py` — sums category scores (capped in code), adds `bonus_points.total`, subtracts
   `deductions.total`, caps at `max_final_score`. That's the entire "code computes the score" story: an
   add-up, not a scorer.
5. Output — console report; CSV row in dev mode only. No persistence, no API, no audit trail.

`role.json` (categories + weights + bonus cap) is a hand-editable file with no version pinning, no approval
step, no freeze.

---

## 2. Findings — mapped to the non-negotiable rules

| # | Rule (CLAUDE.md) | hiring-agent | Evidence |
|---|---|---|---|
| 1 | Model never emits the score | **Violated** | `CategoryScore.score` is a bare LLM-written float, pre-told its own max via the schema |
| 2 | Cite or abstain | **Violated** | `evidence` / `reasons` / `breakdown` are free text; no span, no substring check anywhere — confirmed reading `pdf.py` and `models.py` directly |
| 3 | No generic evaluation | **Partially violated** | Rubric is per-role (good instinct) but unversioned, unapproved, hand-editable mid-round; GitHub star/follower counts function as a generic prior unrelated to the specific role |
| 4 | Disagreement = routing signal | **Absent** | Single call at temp 0.5 (non-zero by design), no ensemble, no agreement check, no review queue. Community write-ups the repo itself surfaces flag run-to-run score variance as a known, unresolved issue |
| 5 | Uncertainty visible | **Absent** | Only a console warning when a category score is capped |
| 6 | Human-in-the-loop for adverse action | **Met in spirit** | HackerRank states this only filters below a cutoff; most candidates still reach a human. Compatible with our default-off auto-reject |
| 7 | Hostile-input defense | **Violated** | Confirmed directly in `pdf.py`: no checks for prompt injection, hidden/invisible text, or tiny fonts — raw markdown flows unfiltered into every prompt |

**Compounding risk not on the checklist**: an employer relying on this for a real decision has no rubric
version, no reproducibility guarantee, no citation, and no bias probe attached to any given candidate's score
— the exact evidentiary gap NYC Local Law 144 and EU AI Act Annex III are built to catch. Weighting "open
source contributions" up to 35/120 points also structurally favors candidates with the free time and public
visibility to build a GitHub presence — a socioeconomic proxy, not a verified-skill signal — with nothing
watching for that bias, unlike our JD-quality detectors in `rubricEngine.js`.

---

## 3. The question this doc answers: does "more agentic" require any of this?

No. **Agentic** (a system that autonomously chains steps, calls tools, and decides what to do next from
intermediate results) and **the LLM being trusted as the final arbiter of a number** are different axes.
Conflating them is how "agentic" becomes cover for removing guardrails and rebuilding the incumbent pattern
under a new name.

We already have genuine agentic behavior with the score-computation boundary intact:

- The QA gate autonomously decides whether to run a self-consistency ensemble (score near a band boundary)
  or a counterfactual bias probe (sampled automatically) — `utils/qaPrompts.js` / `assessmentInvariants.js`.
- Probe generation autonomously decides which unverified claims are worth interview time and drafts the
  questions — `services/probeService.js`.
- The interview autonomously decides when it has enough coverage to close (`isClosing`, computed in code
  from live probe-coverage state, never the model's say-so).
- A contradicted verdict autonomously triggers a rescore that rewrites the `ClaimGraph` and produces a
  second, hash-pinned assessment.

If anything, citation and deterministic scoring are a **precondition** for safe multi-step autonomy, not a
tax on it: in an agent loop, an ungrounded score at step 1 silently contaminates every downstream decision
that reads it (which claims to probe, when to close, what to rescore), instead of contaminating one number.

---

## 4. Candidate additions — compatible with the rules

The one idea in hiring-agent worth taking seriously is the *instinct*, not the implementation: external
verifiable signal (GitHub activity, a live portfolio, published work) beyond the résumé's own claims. Done
their way it's a black-box LLM call picking "top projects" that feeds an ungoverned category score. Done our
way, it's **agentic evidence-gathering**:

- **Autonomous fetch** — given a candidate-provided URL (GitHub, portfolio, publication), the system
  autonomously calls the relevant API/fetch, no human step required.
- **New `ClaimGraph` nodes, not a new scoring path** — each fetched artifact becomes a claim with a citation
  that is *inherently* verifiable because it comes straight from the source API (e.g., "148 commits to
  `org/repo` over 11 months, 3 contributors" is a fact, not an opinion) — spans point at the fetched payload,
  not a model's paraphrase of it.
  - Reuses `spanVerifier.js`'s cite-or-drop discipline: uncitable facts are dropped, not trusted.
- **Same scorer, same rubric** — these claims flow into the existing `evidenceMatcher` /
  `evidenceScorer.js` pipeline like any résumé claim. No new scoring path, no LLM emitting a number for
  "GitHub quality."
- **Same hostile-input posture** — fetched READMEs/bios are also adversarial-input surfaces (a repo
  description can carry a prompt injection as easily as a résumé PDF can). Route through the
  `resumeDefenseService.js` detectors, don't special-case external content as trusted just because it came
  from an API.
- **Unverifiable-by-API claims become probes, not scores** — if a candidate claims deep contribution to a
  private/enterprise codebase with no public trace, that's exactly the "high-weight claim, no résumé-side
  proof" case `probeService.js` already exists to route to the interview — this closes hiring-agent's own
  named bias (candidates without public GitHub activity are structurally penalized) rather than reproducing
  it.

This is a real capability gap — nothing in [STATUS.md](STATUS.md) currently does external evidence fetching
— but it is **not scoped or scheduled**. It would need its own BUILD-PLAN phase (data-source consent,
per-tenant enablement, rate limits, what sources are in scope for v1) before implementation starts.

---

## 5. Must NOT be added — anti-patterns confirmed in hiring-agent

These are rejected outright, not "maybe later." Each is a direct violation of a numbered rule in
[CLAUDE.md](CLAUDE.md), not a stylistic preference:

1. **An LLM-emitted category/criterion score of any kind.** Even bounded-to-a-max, even alongside code-side
   summation — the arithmetic must start from a categorical judgment (`satisfied|partial|absent|contradicted`),
   never a number the model chose. This is rule 1, full stop.
2. **Free-text "evidence" without span verification.** Any evidence field must carry a verbatim span that
   `spanVerifier.js`-equivalent code confirms is a literal substring of its source (résumé or fetched
   artifact). An unverifiable claim is dropped, never displayed as support for a score.
3. **Rubric criteria/weights as a hand-editable, unversioned file.** Every rubric must go through the
   `RoleRubric.js` compile → recruiter-review → **approve & freeze** lifecycle. No score should ever be
   produced against a rubric that isn't a specific, immutable, versioned document.
4. **Raw external metrics (stars, followers, contributor count) used as a scoring input on their own.** They
   may become *evidence* for a specific rubric criterion (with a citation), but never a generic quality prior
   applied independent of what the role actually asks for. A criterion like "sustained open-source
   contribution" must exist in *this* role's approved rubric before GitHub data can affect *this* candidate's
   score.
5. **Non-deterministic single-shot scoring.** Temperature > 0 on a scoring call with no ensemble/agreement
   check and no reproducibility hash. If it can't be re-run to the same number, it doesn't ship as a score.
6. **Trusting fetched external content as safe by default.** Anything pulled from a GitHub bio, README, or
   portfolio page goes through the same injection/stuffing detectors as résumé text — "it came from an API"
   is not a trust boundary.
7. **Any auto-reject wired to this signal.** External evidence gathering, like résumé scoring, stays
   opt-in/default-off for adverse action — a missing or thin GitHub profile becomes a probe or a null signal,
   never an automatic decline.

---

## 6. Bottom line

hiring-agent validates the Product Thesis rather than challenging it: it's a real, popular, well-intentioned
tool that hits every failure mode the thesis exists to avoid (ungrounded scores, no citation, no versioned
rubric, no reproducibility, no injection defense), and even its own maintainers don't trust it enough to use
it on themselves. The one transferable idea — pull in verifiable external evidence — is worth pursuing, but
only through the existing Claim → Probe → Verdict architecture, not as a shortcut around it.
