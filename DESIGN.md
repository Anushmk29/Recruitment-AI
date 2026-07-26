---
name: HireFlow AI
description: Evidence-bound hiring intelligence — a ledger-grade interface for screening, interviewing, and defending hiring decisions.
colors:
  verification-blue: "#2563eb"
  verification-blue-deep: "#1d4ed8"
  verification-blue-pale: "#bfdbfe"
  verification-blue-tint: "#dbeafe"
  verification-blue-wash: "#eff6ff"
  ink: "#0f172a"
  ink-body: "#334155"
  slate-reading: "#475569"
  slate-muted: "#64748b"
  slate-faint: "#94a3b8"
  field-stroke: "#cbd5e1"
  hairline: "#e2e8f0"
  canvas: "#f8fafc"
  surface: "#ffffff"
  verdict-positive: "#059669"
  verdict-positive-tint: "#d1fae5"
  verdict-pending: "#b45309"
  verdict-pending-tint: "#fef3c7"
  verdict-negative: "#dc2626"
  verdict-negative-tint: "#fee2e2"
typography:
  display:
    fontFamily: "Lexend, Inter, system-ui, sans-serif"
    fontSize: "3.4rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Lexend, Inter, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Lexend, Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  3xl: "24px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.verification-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.verification-blue-deep}"
  button-primary-disabled:
    backgroundColor: "#93c5fd"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.verification-blue-deep}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.slate-reading}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  button-danger:
    backgroundColor: "{colors.verdict-negative}"
    textColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
    typography: "{typography.body}"
  badge:
    backgroundColor: "{colors.verification-blue-tint}"
    textColor: "{colors.verification-blue-deep}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    typography: "{typography.label}"
  nav-item-active:
    backgroundColor: "{colors.verification-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
  nav-item-rest:
    backgroundColor: "transparent"
    textColor: "#cbd5e1"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
---

# Design System: HireFlow AI

## Overview

**Creative North Star: "The Evidence Ledger"**

Every number this product shows is supposed to be traceable to a quoted line in a source document. The
interface has to behave the same way: it is a ledger, not a dashboard that asserts. Where a competitor's
screening tool shows a confident 78 and moves on, this one is obliged to show the criterion, the evidence,
and the confidence — and to look like it is *keeping a record* rather than *rendering an opinion*. The
visual system's job is to make that record legible under pressure and defensible under scrutiny.

The mood is **calm under pressure, efficiently modern, and quietly institutional**. Two of the three
audiences arrive stressed — a recruiter with a queue and a candidate with a job on the line — so the
surface lowers the temperature rather than raising it. It stays inside familiar SaaS conventions so nobody
has to learn a new visual language to do their job, and it carries enough weight to acknowledge that these
screens decide people's livelihoods. Restraint here is not timidity; it is the correct register for a
product whose entire claim is trustworthiness.

The implemented system is a light, cool, blue-accented SaaS environment: near-white slate canvas, white
cards on hairline borders, one blue accent, and a small semantic set for outcome. It is coherent and
disciplined — the same UI kit ships byte-identical in both frontends — but its accent ramp is **inherited,
not authored** (see The Inherited Palette Rule). Treat the structure as settled and the palette as the
open question.

**Key Characteristics:**

- Light, cool, near-white canvas (`#f8fafc`) with pure-white surfaces and hairline slate borders
- A single blue accent carrying navigation, primary action, and focus — restrained, never decorative
- Two-family type: Lexend for headings and the wordmark, Inter for everything else
- Soft radii (12px controls, 16px containers) with pill-shaped status badges
- A generous 4px focus ring — the single loudest element in the system, and deliberately so
- Outcome color is semantic and reserved: emerald, amber, red mean *stage and verdict*, never decoration

## Colors

A cool, low-chroma environment where one blue does all the work and three outcome hues are held in reserve
for meaning.

### Primary

- **Verification Blue** (`#2563eb`): The single accent. Carries the active navigation item, primary
  buttons, focus borders, link hovers, and the icon tiles on marketing cards. Named for the job it does in
  the product — pass, verified, proceed — not for what it looks like.
- **Verification Blue Deep** (`#1d4ed8`): Hover state for primary buttons; text color for secondary
  buttons and brand-toned badges where the flat accent would fail on a tint background.
- **Verification Blue Pale** (`#bfdbfe`): Borders on secondary buttons and the `::selection` background.
- **Verification Blue Tint** (`#dbeafe`): Badge and avatar backgrounds, the icon-tile fill in empty
  states.
- **Verification Blue Wash** (`#eff6ff`): The lightest surface tint — hero gradient origin, secondary
  button hover, feature icon tiles.

### Neutral

- **Ink** (`#0f172a`): Primary text, and the dashboard sidebar's full-bleed background. The one place the
  system goes genuinely dark.
- **Ink Body** (`#334155`): Secondary headings and outline-button text.
- **Slate Reading** (`#475569`): Body copy on marketing surfaces; form labels.
- **Slate Muted** (`#64748b`): Supporting copy, descriptions, inactive icons.
- **Slate Faint** (`#94a3b8`): Placeholder text, timestamps, metadata, the quietest tier.
- **Field Stroke** (`#cbd5e1`): Input and select borders; dashed borders on empty states.
- **Hairline** (`#e2e8f0`): Card borders, dividers, header underlines. The primary structural line.
- **Canvas** (`#f8fafc`): App background behind all cards; alternating marketing section bands.
- **Surface** (`#ffffff`): Cards, inputs, popovers, sticky headers (at 90% with backdrop blur).

### Tertiary — Outcome

Reserved. These three hues are the system's only semantic color and they carry the pipeline's meaning.

- **Verdict Positive** (`#059669`, tint `#d1fae5`): Shortlisted, selected, offer accepted, joined; passing
  ATS scores; success toasts.
- **Verdict Pending** (`#b45309`, tint `#fef3c7`): Under review, offer sent — anything awaiting a human.
- **Verdict Negative** (`#dc2626`, tint `#fee2e2`): Rejected, destructive actions, field errors.

### Named Rules

**The Inherited Palette Rule.** The `--color-brand-*` ramp in `src/index.css` is unmodified Tailwind
`blue`, and both apps ship it identically. It is recorded here as the current truth and named for its
function, but it is **provisional** — the product has no owned accent yet. Any future brand work should
replace the eleven ramp values in one place and expect the entire system to follow. Do not build new
surfaces that depend on this specific hue being permanent.

**The Reserved Verdict Rule.** Emerald, amber, and red mean *pipeline stage or evaluation outcome*.
Nothing else. A green button that merely means "continue", an amber banner that merely means "note", or a
red accent chosen for emphasis all corrupt the one channel the recruiter reads fastest.

**The Honest Reading Rule.** Product truth constrains this palette: a degraded, fallback, or no-key result
must never be styled identically to a real measurement. If a score is not a measurement, it does not get
the confident emerald/amber/red treatment — it gets a neutral, explicitly labelled one.

## Typography

**Display Font:** Lexend (with Inter, system-ui, sans-serif)
**Body Font:** Inter (with system-ui, -apple-system, Segoe UI, sans-serif)

Both are loaded from Google Fonts in each app's `index.html` — Inter at 400–900, Lexend at 500–800.

**Character:** Lexend's slightly wider, rounder forms give headings warmth without softness; Inter's
neutral, dense body sizes keep dashboards scannable at 14px. The pairing is quiet and contemporary — it
carries no editorial or institutional signal of its own, which suits a product that wants its *evidence*
to be the memorable part.

`h1`–`h4` receive Lexend and `tracking-tight` automatically from the base layer; the `font-display` class
is only needed for the wordmark and other non-heading display text.

### Hierarchy

- **Display** (Lexend 800, 3.4rem, 1.1, `-0.025em`): Marketing hero headline only. Steps down responsively
  — 2.25rem on mobile, 3rem at `sm`, 3.4rem at `lg`.
- **Headline** (Lexend 700, 2.25rem, 1.2): Marketing section headings. 1.875rem below `sm`.
- **Title** (Lexend 600, 1rem): Card titles, section headers, dashboard page titles. The workhorse
  heading inside the app — deliberately close to body size, because dashboards nest headings densely.
- **Body** (Inter 400, 0.875rem, 1.6): All in-app text. Marketing body steps up to 1.125rem for reading
  comfort at hero and section-intro scale.
- **Label** (Inter 600, 0.75rem): Badges, metadata, form labels, table headers, stat-tile captions.
  Semibold, sentence case, never uppercase-tracked.

### Named Rules

**The Two-Face Rule.** Lexend for headings and the wordmark, Inter for everything else. There is no third
family and no mono face — even in report transcripts and code-adjacent contexts, which currently use Inter.
Introducing a mono is a system-level decision, not a per-screen one.

**The Sentence-Case Rule.** Labels are semibold small text, not uppercase tracked-out microcopy. The
system's smallest text is already dense; adding letter-spacing and caps to it costs legibility for a
recruiter scanning a queue.

## Layout

Two distinct spatial models, sharing one token set.

**App (Operate).** The admin dashboard is a fixed 256px (`w-64`) ink sidebar plus a fluid main column. A
sticky 64px (`h-16`) header sits on white at 90% opacity with a backdrop blur, underlined by a single
hairline. Main content is padded 16px → 24px (`sm`) → 32px (`lg`) horizontally, 24px vertically, and is
otherwise unconstrained — it fills the viewport. The sidebar collapses below `lg` (1024px) into an overlay
drawer behind a scrim of ink at 50%.

The candidate app has no sidebar: a top navbar over a centered 64rem (`max-w-5xl`) column padded 20px →
32px (`sm`) horizontally, 32px vertically.

**Marketing (Persuade).** A centered 80rem (`max-w-7xl`) container padded 20px → 32px (`sm`), with
sections on a 96px (`py-24`) vertical rhythm and alternating canvas/white bands to separate them. The hero
runs a two-column grid at `lg` and stacks below. The "how it works" band narrows to 64rem (`max-w-5xl`).

**Rhythm.** Spacing follows Tailwind's 4px base. The recurring steps are 8px (inline gaps), 12–16px
(component padding), 24px (card padding and block separation), 32px (major group separation), and 96px
(marketing section separation).

**Breakpoints.** Tailwind defaults, unmodified: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px,
`2xl` 1536px. `lg` is the meaningful one — it flips the dashboard from drawer to persistent sidebar and
the hero from stacked to two-column.

### Named Rules

**The Two-Model Rule.** Marketing centers and constrains; the app fills and flows. Don't apply a
`max-w-7xl` centering container to a dashboard screen — a pipeline board and a candidate table need the
full viewport, and the recruiter's monitor is the reason.

## Elevation & Depth

The system is **layered**: distinct planes sit above one another, and shadow is what separates them. Two
shadow tokens exist and they are the entire vocabulary — both are low-contrast and cool-tinted
(`rgba(15, 23, 42, …)`), so layering reads as lift rather than as drop shadow.

In the current implementation the planes lean heavily on hairline borders and background tone shifts to do
the separating, and the shadows are subtle enough to be nearly subliminal — cards carry both a `#e2e8f0`
border *and* `shadow-card`. Where a plane needs to read as genuinely above its neighbor, strengthen the
shadow rather than adding a heavier border; the border strategy is already at its legible limit.

### Shadow Vocabulary

- **Card** (`box-shadow: 0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)`): The resting plane
  for cards and containers. Barely there by design — it separates white-on-canvas without adding weight.
- **Soft** (`box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.08)`): The lifted
  plane. Primary buttons, popovers, toasts, the active sidebar item, floating marketing panels, and cards
  on hover. The `-8px` spread is what makes it read as hovering rather than outlined.

### Named Rules

**The Two-Shadow Rule.** `shadow-card` and `shadow-soft` are the only shadows. No ad-hoc `box-shadow`
values, no `shadow-lg`/`shadow-xl` utilities, no colored glows. A new plane picks one of the two; if
neither fits, the plane count is wrong.

**The Lift-on-Intent Rule.** Movement between planes is a response to intent — hover raises a card from
`shadow-card` to `shadow-soft` with a `-translate-y-1`; a press drops it via `active:scale-[0.98]`.
Elevation animates; it does not sit and pulse.

## Shapes

Soft, consistent, and rounded on a tight four-step scale. Nothing in the system has a sharp 0px corner and
nothing is fully squared off — the form language is uniformly gentle.

- **8px** (`rounded-lg`): Small inline elements — icon tiles, skeletons, compact list rows, the wordmark
  mark.
- **12px** (`rounded-xl`): **The control radius.** Every button, input, select, textarea, nav item,
  popover, and toast. This is the most load-bearing value in the system.
- **16px** (`rounded-2xl`): **The container radius.** Cards, panels, empty states.
- **24px** (`rounded-3xl`): Reserved for the full-bleed marketing CTA panel.
- **Pill** (`rounded-full`): Status badges, avatars, stage chips, step markers, and dots. The most-used
  radius in the codebase by count, because status is everywhere.

Borders are uniformly 1px and structural, never decorative: `#e2e8f0` for containers, `#cbd5e1` for form
fields, dashed `#cbd5e1` exclusively for empty states.

### Named Rules

**The 12/16 Rule.** Controls are 12px, containers are 16px. A control that adopts the container radius
reads as a card and stops looking pressable; a container at control radius reads as an oversized button.

**The Pill-Means-Status Rule.** Fully-rounded shapes signal *state* — a stage, a count, a person. A pill
that is actually a button, or a pill used for a section header, breaks the fastest read in the product.

## Components

### Buttons

Refined and restrained — the goal is a control that is unmistakably actionable without demanding
attention. Five variants, three sizes, one shared shell.

- **Shape:** The control radius, 12px (`rounded-xl`), with semibold labels and a 8px icon gap.
- **Sizes:** Small (`6px 12px`, 0.875rem) · Medium (`10px 16px`, 0.875rem) · Large (`14px 24px`, 1rem).
- **Primary:** Verification Blue on white text with `shadow-soft`; hover deepens to `#1d4ed8`; disabled
  flattens to `#93c5fd` (not opacity — a real color change, so the label stays legible).
- **Secondary:** White with `#1d4ed8` text on a `#bfdbfe` border; hover washes to `#eff6ff`.
- **Outline:** Transparent with `#334155` text on a `#cbd5e1` border; hover fills `#f8fafc`.
- **Ghost:** Transparent with `#475569` text; hover fills `#f1f5f9`. For toolbar and inline actions.
- **Danger:** Verdict Negative on white text. Reserved for destructive, irreversible actions.
- **Focus:** A 4px ring (`focus-visible:ring-4`) in the variant's own tint, with the native outline
  removed. This is the loudest single treatment in the system and it should stay that way — it is the only
  affordance a keyboard-only candidate has mid-interview.
- **Press:** `active:scale-[0.98]` over 150ms. Restrained direction: this is the one place where the
  current implementation is louder than the stated character, and it is the first knob to dial back if the
  system should read quieter.
- **Loading:** A spinning 16px `Loader2` prepends the label and the control disables itself.

### Cards / Containers

- **Corner Style:** 16px (`rounded-2xl`)
- **Background:** Surface white on the canvas
- **Border:** 1px Hairline (`#e2e8f0`)
- **Shadow Strategy:** `shadow-card` at rest, `shadow-soft` plus `-translate-y-1` on interactive cards
- **Internal Padding:** 24px, uniform

### Inputs / Fields

- **Style:** White fill, 1px `#cbd5e1` border, 12px radius, `10px 14px` padding, 0.875rem Inter,
  `#94a3b8` placeholder, plus a subtle `shadow-sm`. Inputs, textareas, and selects share one class
  verbatim — deviation between them is a bug.
- **Focus:** Border shifts to `#3b82f6` and a 4px `#dbeafe` ring appears; the native outline is removed.
- **Error:** Border `#f87171`, focus border `#ef4444`, focus ring `#fee2e2`. The message below is 0.75rem
  semibold in `#dc2626`.
- **Disabled:** `#f1f5f9` fill with `#94a3b8` text.
- **Labels:** 0.75rem…0.875rem semibold `#334155`, 6px above the field, with a `#ef4444` asterisk when
  required.

### Navigation

- **App sidebar:** 256px on Ink (`#0f172a`). Items are 12px-radius rows with a 18px icon and a 0.875rem
  medium label. Rest is `#cbd5e1` on transparent; hover lifts to white on `rgba(255,255,255,0.05)`; active
  is white on Verification Blue with `shadow-soft`. The wordmark sits in a 64px header above.
- **App header:** 64px, sticky, white at 90% with a backdrop blur and a hairline underbar. Company name
  and code on the left, notification bell and an avatar-plus-chevron profile menu on the right.
- **Marketing navbar:** Anchor links in slate, ending in a primary CTA button.
- **Mobile:** Below `lg` the sidebar becomes an overlay drawer over an `rgba(15,23,42,0.5)` scrim.

### Badges

The system's status primitive: a pill (`rounded-full`, `4px 10px`) with 0.75rem semibold text on a tint
fill. Five tones — slate (neutral/default), brand (in-progress), green (positive), amber (awaiting a
human), red (terminal negative).

### Empty States

A dashed-border panel on a 60%-opacity canvas fill, 16px radius, 24px × 56px padding, centered: a 48px
circular Verification Blue Tint icon tile, a 1rem semibold title, a `max-w-sm` 0.875rem muted description,
and an optional action 20px below. The one place dashed borders are permitted.

### Toasts

Bottom-right stack, 24rem max width, 12px radius, `shadow-soft`, with a tone-matched border/fill/text trio
(emerald, red, or brand). They spring in from `y: 12, scale: 0.96` and fade out on scale, auto-dismissing
at 4s with a manual close affordance.

### Signature Component — The Stage Pipeline

The product's most distinctive pattern: a **14-stage** candidate lifecycle (`applied` → `ats_passed` →
`interview_scheduled` → `ai_interview_completed` → `under_review` → `shortlisted` → `hr_interview` →
`technical_interview` → `manager_interview` → `selected` → `offer_sent` → `offer_accepted` → `joined`,
plus the terminal `rejected` off-ramp), rendered as a board of columns and as badges everywhere a
candidate appears.

Its color logic is centralized in `admin/src/lib/pipeline.js` and is the single source of stage tone:
in-flight stages are brand-toned, human-decision stages are amber, advancing stages are green, and
`rejected` is red. Stage labels and tones must be read from `stageLabel()` / `stageTone()` — never
re-derived in a component. The file mirrors `backend/utils/pipeline.js` and the two must stay in sync.

## Do's and Don'ts

### Do:

- **Do** use the 12px control radius and 16px container radius. They are the system's most recognizable
  measurement — see The 12/16 Rule.
- **Do** keep the 4px focus ring. It is the accessibility floor of a product that assesses people who may
  be navigating by keyboard under stress, and it is deliberately the loudest treatment in the system.
- **Do** read stage labels and tones from `pipeline.js`. Hard-coding a stage color anywhere else guarantees
  drift between the board, the badges, and the backend.
- **Do** reserve emerald, amber, and red for pipeline stage and evaluation outcome — The Reserved Verdict
  Rule.
- **Do** label degraded, fallback, and estimated values distinctly from measured ones. A placeholder styled
  as a measurement is the one failure this product cannot absorb.
- **Do** keep the two frontends' UI kits identical. `Button.jsx`, `Card.jsx`, and `Field.jsx` are currently
  byte-identical across `admin/` and `user/`; a change to one is a change to both.
- **Do** treat the accent ramp as replaceable — The Inherited Palette Rule. Style against `brand-*` tokens,
  never a literal `#2563eb`.

### Don't:

- **Don't** reach for AI-hype visual clichés — purple-to-blue gradients, glowing orbs, dark "neural"
  backdrops, or sparkle icons scattered as decoration. The product's credibility rests on looking measured;
  looking futuristic actively undermines the claim that a code path, not a vibe, computed the score.
- **Don't** gamify evaluation. No celebratory percentage rings, no confetti, no leaderboard framing. A
  number on these screens is a hiring decision about a person, and styling it like a game score is both a
  taste failure and a liability.
- **Don't** apply surveillance aesthetics to proctoring — no red alert framing, no crosshairs, no
  threat-dashboard styling. Integrity signals are reported as observations with their confidence, not as
  accusations. The candidate consented to monitoring; they did not consent to being framed as a suspect.
- **Don't** introduce a third font family or a mono face without a system-level decision — The Two-Face
  Rule.
- **Don't** add new shadow values. Two exist; pick one — The Two-Shadow Rule.
- **Don't** use pills for anything that isn't status — The Pill-Means-Status Rule.
- **Don't** center-constrain dashboard screens with a marketing container. The app fills; marketing
  centers — The Two-Model Rule.
- **Don't** use uppercase tracked-out microcopy for labels. The system's smallest text is already dense.
