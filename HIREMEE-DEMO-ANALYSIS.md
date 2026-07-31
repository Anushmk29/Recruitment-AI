# HireMee Pro — Demo Call Analysis (13 July 2026)

Source: 50-minute recorded demo call (Google Drive). Presenter: **Shon Sajan Philips (HireMee)**.
Attendees: **Ajay Krishnan** and **Vijendra Pratap Singh** (us, as prospects/partners).
Platform demoed: **HireMee Pro** — `pro.hiremee.co.in` (admin console) and `assess.hiremee.co.in`
(candidate test portal). Tagline: *"Discover Your Diamond"*.

Purpose of this doc: full record of what HireMee's assessment platform does, how their
assessment test + proctoring works, what their UI/UX looks like, and what we should copy,
improve on, or deliberately reject for Recruitment-AI.

---

## 1. Who HireMee is / business model

- ~**9 years** running assessments; positioned as a **social enterprise**: they maintain a
  **pre-assessed talent pool** of tier-2/3/4 city students, assessed with a standardized test.
  Clients can hire from that pool or run their own assessments for any tier/industry.
- Markets: **India + Middle East**.
- **Revenue model: "test pins" (test credits).** Every client org is credited a number of test
  pins; each candidate assessment consumes pins. The dashboard shows remaining pin balance
  (a usage widget sits bottom-left of the admin sidebar, e.g. "You have used 88.08% of your
  available testpins").
- **Per-contract feature gating.** Which assessment types a client can run (coding,
  psychometric, speech, typing simulator…) is enabled at the backend *per contract*. Nothing is
  self-serve; a sales conversation precedes every capability.
- **No trial platform logins** — stated explicitly on the call ("we don't usually give a trial
  login… everyone has seen these assessment engines"). They only share candidate-side test
  links as the demo. Platform access is protected as IP.
- Proctoring AI is **not in-house**: they use **AWS Rekognition** for image analysis and send
  feedback images back to AWS for retraining. Claimed accuracy after false-positive tuning:
  **"94–96%"** (their own number, unaudited).

## 2. Two content-creation modes (their core operating model)

1. **Self-serve**: client uses the **Questions** module → create **Question Pools** → add
   questions (single or bulk upload) → assemble **test papers** in **My Assessments**.
   Config choices at creation: web-based vs app-based delivery, overall time limit vs
   section-wise time limits.
2. **Managed service (the default in practice)**: client shares a **JD** (hiring) or **training
   modules** (L&D). HireMee's **in-house SMEs + content team** produce a **blueprint** — section
   names, question counts per section, difficulty level per section (e.g. 20 questions under
   "Key Skills", plus Logical Reasoning, Quantitative Aptitude, Verbal, etc.). Client **signs off
   on the blueprint**, then the paper is built. Custom assessments are **paid**; off-the-shelf
   inventory papers are take-as-is with **no customization unless paid**.

> **Explicitly confirmed on the call: nothing is auto-generated.** "Can the system adapt or
> change based on the client's request?" → "Not as such… the question paper will not be
> immediately created for them." No JD→assessment automation, no adaptive testing, no AI
> question generation. This is the single biggest gap we exploit.

## 3. Admin console (pro.hiremee.co.in) — structure & UX

**Design language:** dark charcoal left sidebar with bright green (#~00B140) accents and the
HireMee logo; white content area; green primary buttons; status pills (orange "Premium",
green "Schedule" links); donut charts for status overview. Clean but dated-corporate; tables
everywhere; noticeable loading spinners between pages (several multi-second "Processing…"
waits happened live on the call, plus one full screen-share stall around 33:30).

**Sidebar navigation:** Dashboard · Questions · My Assessments / Assessments · Candidates ·
Reports · Settings · CSR.

### Dashboard (00:00, 44:47)
- **Live Assessment Tracker** (marked "Live"): Total Candidates, Started (count + %),
  Not Started, Completed (count + %), Terminated, Expired; filter by schedule; date range.
- Assessment-type breakdown list: Assessment Inventory, Advanced Coding, Psychometrics,
  Forms, General Settings, Exam Management, Speech, Subjective Type — each with counts.
- **Status Distribution Overview** donut: Completed / Started / Not Started / Terminated /
  Expired legend.
- Test-pin usage widget (bottom of sidebar).

### Questions (01:00)
- Tabs: **Questions** (n) | **Question Pool** (n). Search, filter, green "+ Add question".
- Table columns: Question, Type, Pool, Difficulty Level, Action.
- Single or bulk question upload.

### Assessment Inventory (02:31, 42:28)
Off-the-shelf papers assigned to the tenant. Seen in the list:
- HireMee Aptitude Test (00:20, 4 sections)
- HireMee Storyboard
- HireMee Coding Test
- HireMee Mechanical Engg Test
- HireMee Sales Test – FMCG General Trade
- HireMee Personal Effectiveness Inventory
- HireMee Sales Test – Pharmaceutical Industry – Level 2 (level 2 = medium difficulty)
- HireMee – Sales Mastery Matrix (psychometric)
Columns: Assessment Name, Total Duration, Status (orange "Premium" pill), No. of Sections,
Test Pin Taken, Action → **Schedule**.

### Scheduling flow (02:31–13:10, 24:45–27:00, 42:28–43:11)
- Assessment Type: **Single** | (bulk) ; Schedule Type: **Invite** | **shareable link**
  (link+password for orgs running daily/weekly drives — no per-candidate invitations).
- Start/End date-time window (validity, e.g. 24h). **Deadline-to-start** option separate from
  link validity ("must start by 2:00 PM on the 14th").
- **Settings panel (per schedule)** — every proctoring toggle lives here:
  - Image Proctoring (default 3 images/minute)
  - ID Proof capture
  - Live Proctoring – Image / Live Proctoring – **Streaming** (video)
  - Video – Camera / Video – Screen (recording)
  - Audio Proctoring
  - Window / Screen restrictions (tab-switch discipline)
  - **Mandatory Web Cam**
  - **Auto Termination** (threshold N flags — opt-in, off by default)
  - Enable Finish/Submit button
  - Unique email address enforcement
  - **Pre-data collection** (registration form: national ID, college, stream, CGPA… —
    minimum data needed is only name + email)
- Add candidates (name/email/phone), invite via **Mail | SMS** toggle, or "copy test invite"
  to send the test pin yourself outside the platform.
- Confirmation modal: "Do you want to send the invites to the candidates? Yes (invite with
  test pin) / No (share later)". Success toast: "Assessment scheduled successfully" +
  pointer to **Schedule Log**.
- **Schedule Log**: all past schedules — Schedule Name, Type, Start/End, No. of Candidates.
- Per-schedule **Candidates tab**: Candidate Name, Email, Phone, Status ("Created"), Category,
  Assessment Name, **Testpin** (e.g. E645378), Action.

### Reports (57:26 area / 40:12)
- **Assessment Reports** list: S.No, Candidate Name, Email ID, Assessment, Testpin,
  Test Taken On, Status, Action; Invite/Event filter toggle.
- Report itself opens as a long-form branded web/PDF report (see §6).

## 4. Candidate experience (assess.hiremee.co.in) — the part we care most about

**Entry** (13:37): "Welcome Back..!" page — split layout, lifestyle photo left, form right.
Enter **Test Pin** → checkbox "I agree to the Privacy Policy and Terms of Use" → prominent
privacy note: *"For proctored assessments, your photos/videos will be captured to ensure the
integrity of the evaluation"* → green **Start Assessment**. Google Play / App Store badges
(mobile app exists for taking tests). Footer "2026 Powered by HireMee".

**Time-window enforcement** (33:30): logging in before the scheduled slot → red "Login Failed —
Your assessment will be available at Jul 13 2026 3:53PM".

**System Check** (14:09, 35:03): stepper with two steps (System Check → Assessment
Instructions):
- Device Compatibility — detects OS (Windows 11) + browser version (Chrome 149.x), pass/fail.
- Device Internet Speed — live check against required **512 kbps**, with Recheck button.
- Location Permission.
- Right rail: "To successfully make your system compatible for this test" checklist (latest
  Chrome/Firefox/Safari/Edge, genuine copy of Windows, no firewall blocks) + support email
  (support@hiremee.co.in).

**Instructions page** (14:33): custom-editable per assessment. Defaults include: turn off all
chat applications; do not navigate away from the test window; **on power/network failure,
re-enter the same credentials and resume from where you stopped**; pin is one-time use;
click End Test when done; no negative marking (configurable).

**Full-screen enforcement**: test runs full-screen; browser shows "assess.hiremee.co.in — to
exit full screen, press Esc" (exits are what Window/Screen proctoring flags).

**Section hub** (15:08): table of sections — e.g. Logical Reasoning, Quantitative Aptitude,
Data Interpretation, Verbal Aptitude — columns: Questions Answered (0/10), Marked for Review,
Time Spent, Section Status (Yet To Start / InProgress / Completed) with per-section **Start /
Resume / Revisit** buttons; global countdown timer top-right; **Exit Assessment** button.

**In-question layout** (15:30–18:30) — the screen worth studying closely:
- Header: logo | assessment title + test pin | countdown timer (green pill).
- Sub-header right: live counters — **Answered / Unanswered / Flagged**.
- Left rail: candidate name + email; **Question Palette** — numbered chips; **Legends**:
  Not Visited (white), Current (green outline), Answered (green), Not Answered, Marked for
  Review (dark blue); **Exit Section**.
- Center: question text (supports **text, image, video, audio** stimuli — image example: pie
  chart "Fuel Consumption in a Month per User", data-table questions).
- Right column: answer choices as full-width selectable cards (green border when selected).
- Footer: **Mark for Review** · Reset · Previous · **Next** (green); final question shows
  **Submit**.
- Direct navigation: click any palette chip to jump to that question; revisit and change
  answers freely within a section.
- Confirmation modals everywhere: "Confirm Question for Review", section submit ("Are you sure
  you want to submit the section?" with counts: Total 10 / Answered / Not answered / Marked for
  review / Not visited), "Are you sure you want to exit this section?", "Confirm End
  Assessment". Candidate can end early without starting remaining sections.
- Section summary after each section: questions answered, time spent, status.
- Completion: "Thank you — read the company's instructions… Thank you for taking the
  assessment." + Proceed.

**Psychometric variant** (34:59–36:00): same shell; 126 Likert items ("I can effectively
communicate insights from trend analysis to my team" — Strongly Disagree → Strongly Agree
cards); large palette grid; no right/wrong framing in the instructions; 45 min in demo but
they **recommend <30 min deliberately so gut answers outrun impression management**.

## 5. Proctoring system (their main pitch)

- **Image proctoring**: N images/minute (default 3) captured from webcam; each image is
  processed by **AWS Rekognition** server-side.
- **Flag taxonomy** (each occurrence = one flag):
  1. Eyes/face looking away from screen
  2. Multiple people in frame
  3. **Another person present** (candidate replaced — impersonation)
  4. Mobile phone detected
  5. Away from system / nobody in frame
- **Auto-termination**: if enabled with threshold N (e.g. 3), the (N+1)th violation
  auto-terminates the test. If not enabled, flags are recorded and surfaced to the recruiter
  but never terminate. **Recruiter's choice, off by default.**
- Candidates are told the do's & don'ts up front (procedural fairness framing).
- **False-positive history admitted on the call**: AC units and switchboards flagged as mobile
  phones; calendar portraits flagged as a second person. They claim tuning has reached
  94–96% and describe it as "work in progress", "not foolproof".
- **ID proof capture** and **live streaming proctoring** (human watching video feed) are
  separate toggles; audio proctoring exists too.
- **Safe Exam Browser (SEB)** — premium feature: candidate downloads an .exe (or .apk);
  locks the machine — all chat apps, screen sharing, HDMI/USB ports, Bluetooth, other
  browsers disabled; only the assessment runs; exits only after submission. Positioned for
  high-stakes tests; acknowledged as high-friction (install required), so it's opt-in.
- Mobile-phone test-takers (tier-2/3 candidates without laptops): supported via app; chat
  apps must be closed; same flag rules.

## 6. Scoring & the psychometric report (Sales Mastery Matrix)

- Psychometric built by an in-house **psychometrician + team on the Big Five model**;
  **126 questions → 42 facets → 21 competencies → clustered into 5 pillars**:
  1. Sales Innovation & Adaptability
  2. Sales Performance & Execution
  3. Sales Influence & Engagement
  4. Customer Centricity
  5. Resilience & Emotional Agility
- **Scale 0–10; ≥6.6 = High/Very High (good); below = flagged as development area.**
- Report (long-form branded document, green cover "SALES MASTERY MATRIX REPORT",
  served at `hiremee.co.in/get-psychometric-result-report?test_pin=<JWT>`):
  - Competency list up front (achievement drive, bargaining power, client retention, closing
    techniques, competitive awareness, persistence, …)
  - Pillar definitions + key indicators
  - **Top 3 strengths and top 3 areas of development** (narrative paragraphs with
    illustrations — e.g. "Excels in Curiosity, particularly Inquisitiveness and Proactivity…")
  - Per-competency breakdown: score bar (e.g. Attention To Detail 5.3, Time Management 5.2,
    Goal Orientation 5.3), overview text, versatility & learning agility notes
  - 1–10 red→yellow→green gauge per competency with pointer (e.g. 5.4 = "Moderate")
- Honesty handling is **procedural only**: short time limits + "answer honestly or the report
  will be false". They concede an AI/MCQ cannot detect lying. **No verification loop.**
- Aptitude/MCQ scoring: standard right/wrong; no negative marking by default (configurable);
  per-section time and status tracked.

## 7. Sales-call observations (how they sell, their admissions)

- Demo is **tailored per prospect** ("we understand what the client requires… I don't want to
  show something irrelevant for a pharmaceutical company").
- They **refused platform trial access** — only candidate test links (sales + Python papers
  promised to Ajay and Vijendra with all proctoring flags enabled, to experience flagging).
- Positioning tension surfaced by Ajay: NCAPE(?) is simulation-based, HireMee is
  application/platform-based; HireMee's sourcing pool is tier-2/3/4 focused, which leaves a
  tier-1 gap they answer only weakly ("clients can use it for any tier").
- Repeated admissions: no adaptivity, no auto-generation, custom = paid + SME + sign-off
  turnaround, trial-hostile, proctoring accuracy "work in progress".

## 8. Feature checklist (for quick comparison)

| Capability | HireMee | Notes |
|---|---|---|
| MCQ/aptitude tests | ✅ | text/image/video/audio stimuli |
| Coding assessments | ✅ | separate "Advanced Coding" module (not shown in depth) |
| Psychometric | ✅ | Big Five, 126q, human-built |
| Speech / typing simulator / subjective / forms | ✅ | enabled per contract |
| Question pools + bulk upload | ✅ | |
| Sections, per-section timers, difficulty levels | ✅ | |
| Off-the-shelf test library | ✅ | "Premium" inventory items |
| JD → assessment | ⚠️ manual | SME blueprint + client sign-off, paid |
| Adaptive testing | ❌ | confirmed on call |
| AI question generation | ❌ | confirmed on call |
| Image proctoring + flag taxonomy | ✅ | AWS Rekognition, 3 img/min |
| Auto-termination (opt-in) | ✅ | threshold N flags |
| Live video streaming proctoring | ✅ | toggle |
| ID proof capture | ✅ | toggle |
| Safe Exam Browser lockdown | ✅ | premium, .exe/.apk install |
| Resume-after-crash | ✅ | same credentials, continue |
| Shareable link + password mode | ✅ | for recurring drives |
| Email + SMS invites | ✅ | SMS is a differentiator in India |
| Pre-data collection forms | ✅ | configurable fields |
| Mobile app for candidates | ✅ | Play Store + App Store |
| System compatibility check | ✅ | OS/browser/speed/location |
| Candidate status tracker (live) | ✅ | started/completed/terminated/expired |
| Narrative competency reports | ✅ | psychometric only |
| Evidence/citations in reports | ❌ | scores are unexplained numbers |
| Outcome calibration | ❌ | absolute 0–10 scale, fixed 6.6 threshold |
| Interview loop integration | ❌ | assessment-only product |

---

## 9. What this means for Recruitment-AI

### The three differentiation questions (per CLAUDE.md)

**1. What does everyone else (HireMee) do here?**
Static, human-authored test papers delivered through a proctored MCQ engine. JD→test is a
manual SME service with a sign-off loop measured in days. Proctoring = off-the-shelf AWS
Rekognition image flags with an opt-in kill switch. Reports are template narratives around
uncalibrated 0–10 numbers with a hardcoded 6.6 "good" threshold. Screening and interviewing
are entirely separate worlds — their product ends at the test report.

**2. Why is that approach weak?**
- The content loop doesn't scale and can't personalize: every custom role costs SME time and
  money, so most clients settle for generic off-the-shelf papers → same test for every Java
  developer everywhere → gameable, leaks, and tells you nothing about *this* role.
- Scores are unexplained and uncalibrated: "Attention to Detail 5.3" has no evidence trail,
  no tenant baseline, no legal defensibility. Their threshold (6.6) is arbitrary and global.
- Honesty/faking is handled by time pressure and hope; the report itself admits nothing is
  verified.
- The assessment result is a dead end — nothing feeds an interview; no claim from the résumé
  is ever tested; nothing closes a loop.
- Trial-hostile, contract-gated sales motion adds friction we can undercut with self-serve.

**3. What do we do instead, and what value does the buyer feel?**
The assessment is not a standalone product — it is the **Probe** stage of our
Claim → Probe → Verdict loop. The RoleRubric (compiled from the JD, versioned,
recruiter-approved) decides *what to test*; the candidate's ClaimGraph decides *what to test
for this specific person* (high-weight, low-evidence claims become probes); the interview
and/or assessment tests exactly those; the report closes the loop marking each claim
verified / contradicted / unverified, with citations. The buyer feels: zero SME wait, a test
that is *about this role and this candidate*, and a report they can defend in an audit.
HireMee cannot ship this without rebuilding their product.

### Worth adopting (proven UX patterns, commodity table stakes)

These are execution patterns HireMee has validated over 9 years — adopt the *pattern*, not
the architecture:

1. **Candidate test-shell UX** (highest immediate value for our assessment feature):
   question palette with color legend (not visited / current / answered / marked-for-review),
   mark-for-review + revisit, per-section timers and status hub, live answered/unanswered/
   flagged counters, confirmation modals with counts before submit, section summary screens,
   full-screen mode. This is the NTA/TCS-iON-style exam grammar Indian candidates already
   know — familiarity reduces test anxiety and support load.
2. **Pre-flight system check**: browser/OS detection, bandwidth check (≥512 kbps), webcam/
   location permission, with a "how to fix" rail. Cheap to build, kills the #1 support ticket.
3. **Resume-after-crash**: re-enter credentials, continue from last answered question.
   Non-negotiable for tier-2/3 connectivity.
4. **Recruiter proctoring config as per-schedule toggles** with auto-termination **opt-in and
   off by default** — this matches our "every automated adverse action needs a human" rule.
   Their flag taxonomy (looking away, multiple people, impersonation, phone, absent) is a
   sensible starting vocabulary; our proctoring pipeline already logs events — map to this
   taxonomy for recruiter familiarity.
5. **Shareable link + password** scheduling mode for recurring drives (in addition to
   per-candidate magic links) and **SMS invites** alongside email for the India market.
6. **Status tracker dashboard**: Not Started / Started / Completed / Terminated / Expired with
   percentages per schedule — recruiters clearly live in this view.
7. **Report presentation ideas**: top-3 strengths / top-3 development areas, per-competency
   gauge + narrative. Steal the *layout*; replace the substance with cited evidence and
   calibrated numbers.
8. **Blueprint sign-off as a UX concept**: their manual "blueprint → client sign-off → build"
   flow is exactly our RoleRubric approval gate — except ours is compiled in minutes by the
   rubric engine and versioned. Keep the sign-off moment; delete the SME queue.

### Deliberately reject

- **LLM/generic scoring of psychometrics with fixed global thresholds** (6.6 = good) — violates
  our no-generic-evaluation rule; our numbers must be calibrated per tenant.
- **Uncited narrative reports** — every sentence in our reports names the criterion and the
  evidence span.
- **Auto-termination as the integrity story** — with 4–6% false positives on their own
  numbers, an auto-kill is an automated adverse action on flaky evidence. Ours: flags are
  routing signals to a human, surfaced with the captured frame as evidence.
- **Contract-gated features + no self-serve trial** — our subscription/provisioning flow is
  already self-serve; that's a sales-motion advantage, keep it.
- **Test pins as the billing atom** — we already bill by subscription/plan; pins add friction.
  (Optionally: usage metering per assessment for enterprise tiers, but not candidate-visible
  pin codes.)

### Where it plugs into our build plan

- The assessment engine is a **Probe executor**: given the RoleRubric + a candidate's
  unproven claims, select/generate probe items (MCQ, coding task, scenario) that target those
  claims; deterministic code scores responses; results write back into the ClaimGraph as
  verified/contradicted/unverified with evidence.
- The candidate test shell (palette/timers/review/system-check/resume) is a frontend work
  package for the `user/` app, independent of the AI engine — it can be built in parallel.
- Proctoring flags feed the existing pipeline as **routing signals** (Disagreement/ambiguity →
  human), never as auto-reject inputs. Auto-termination, if we ever ship it, stays opt-in and
  default-off per CLAUDE.md rule 6.

---

## 10. Timestamp index (for re-watching)

| Time | What's shown |
|---|---|
| 00:00–02:30 | Dashboard, test pins, Questions module, two creation modes |
| 02:31–08:10 | Scheduling + proctoring settings, flag taxonomy Q&A, auto-termination |
| 08:37–10:05 | False positives history, AWS Rekognition, 94–96% claim |
| 10:14–13:10 | Deadlines, pre-data collection, invite flow, test pin |
| 13:37–15:05 | Candidate portal entry, system check, instructions |
| 15:08–18:20 | Aptitude test-taking UX (palette, review, sections) |
| 18:53–20:40 | Safe Exam Browser (SEB) premium lockdown |
| 21:01–24:20 | Per-contract enablement, "nothing is auto-generated" |
| 24:27–28:40 | Inventory papers, Sales Test (Pharma L2), scheduling more tests |
| 29:29–31:15 | SME blueprint → sign-off → build; custom = paid |
| 31:17–36:00 | Sales Mastery Matrix psychometric (126q, 42 competencies), Likert UX |
| 36:47–39:40 | Faking/honesty discussion, Big Five, <30-min rationale |
| 39:42–44:47 | Reports module + full Sales Mastery Matrix report walkthrough |
| 42:39–47:00 | Trial policy (no platform access; test links only) |
| 47:03–50:13 | Sales process, India + Middle East, tier-1 gap discussion |

Working files (video, all 100 frames, transcript) kept at:
`C:\Users\ABC\AppData\Local\Temp\claude\d--Autonoetic-edge-Vijendra-pratap-Recruitment-AI\54a9d32d-4a8c-4f98-a27f-65761a8e1bb3\scratchpad\watch-pitch\`
