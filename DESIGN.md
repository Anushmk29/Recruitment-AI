---
name: HireFlow AI
description: Evidence-bound hiring intelligence — a ledger-grade interface for screening, interviewing, and defending hiring decisions.
colors:
  petrol: "#0f5a6b"
  petrol-deep: "#0b4353"
  petrol-bridge: "#5b8c98"
  greige: "#d3caba"
  greige-tint: "#e8e2d6"
  greige-wash: "#f5f2ec"
  clay: "#8a4824"
  clay-mid: "#c0703e"
  clay-tint: "#f7e6da"
  clay-wash: "#fdf6f1"
  text-ink: "#1a1815"
  text-ink-body: "#3a362f"
  slate-reading: "#4f4a42"
  slate-muted: "#6e675c"
  slate-faint: "#9c9384"
  field-stroke: "#cdc5b6"
  hairline: "#e3ddd1"
  canvas: "#f6f2ea"
  canvas-deep: "#ece5d8"
  surface: "#ffffff"
  verdict-positive: "#047857"
  verdict-positive-tint: "#d1fae5"
  verdict-pending: "#92400e"
  verdict-pending-tint: "#fbe8b8"
  verdict-negative: "#b91c1c"
  verdict-negative-tint: "#fee2e2"
  chart-positive: "#5fcfa0"
  chart-neutral: "#e0d9cc"
  chart-negative: "#fb8f8a"
  chart-brand: "#6ec3d8"
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
    backgroundColor: "{colors.petrol}"
    textColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.petrol-deep}"
  button-primary-disabled:
    backgroundColor: "{colors.petrol-bridge}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.petrol-deep}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text-ink-body}"
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
    textColor: "{colors.text-ink}"
    rounded: "{rounded.2xl}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-ink}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
    typography: "{typography.body}"
  badge:
    backgroundColor: "{colors.greige-tint}"
    textColor: "{colors.petrol-deep}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    typography: "{typography.label}"
  nav-item-active:
    backgroundColor: "{colors.petrol}"
    textColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
  nav-item-rest:
    backgroundColor: "transparent"
    textColor: "{colors.slate-reading}"
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

The implemented system is a warm paper environment: a bone canvas, white cards on hairline borders, a
deep petrol primary on a duotone ramp, one rationed clay secondary, and a small semantic set for outcome.
The same UI kit ships byte-identical in both frontends. The palette is **authored rather than
inherited** — it has now been swapped three times in single edits, Tailwind `blue` → Signal Violet → Ink
on Bone → Petrol on Bone, which is the whole argument for the One-Place Rule below.

**Key Characteristics:**

- Warm bone canvas (`#f6f2ea`) with pure-white surfaces and hairline greige borders
- A deep petrol primary on a **duotone ramp** — warm greige tints where status pills live, teal-blue where
  actions, navigation, links and filled panels live, so brand colour never lands beside a verdict tint
- One warm secondary (Clay) for emphasis and rhythm, structurally barred from every status surface
- Two-family type: Lexend for headings and the wordmark, Inter for everything else
- Soft radii (12px controls, 16px containers) with pill-shaped status badges
- A generous 4px focus ring — the single loudest element in the system, and deliberately so
- Outcome color is semantic and reserved: emerald, amber, red mean *stage and verdict*, never decoration —
  and the duotone split is what keeps that true while the brand is chromatic
- Chart marks are **pastel**, each ringed 1px in its own reserved verdict hue: soft enough that five bars
  in a column read as a measurement rather than an alarm, edged so they stay legible and CVD-separable

## Colors

**Petrol on Bone.** A warm paper environment, a deep teal-blue primary on a duotone ramp, one clay
secondary on a short leash, and three outcome hues that colour is never allowed to compete with.

*Repainted 2026-08-05: Signal Violet → Ink → Petrol.* Violet went first because violet-on-white is the
house style of every AI product shipped since 2023, and looking like the category is a bad trade for a
product whose whole claim is that a code path — not a vibe — computed the score.

Ink came next on the argument that green, amber and red are reserved for hiring outcomes, so *any*
chromatic primary must compete with one of them. That argument turned out to be **half right, and the
correct half is narrower than it looked.** A brand does not collide with a verdict because it is
chromatic; it collides at the **tint** end, where `bg-brand-100 text-brand-700` is the in-progress
`<Badge>` sitting on the same row as a mint pass-tint and a rose reject-tint. Three candidates were built
and looked at side by side to establish this: pale petrol read as the mint pass-tint beside it, pale
oxblood was very nearly the reject-tint, and only the dark end of any ramp was ever safe.

Hence the duotone. Steps 50–200 stay warm greige; 300–950 are petrol. The collision is designed out at
the ramp rather than by giving up colour, and the product keeps a real brand hue on every surface that
should carry one.

### Primary — Petrol (duotone)

A single ramp made of two materials, split exactly where the product's meaning changes: neutral where the
system reports **state**, chromatic where it offers **action**.

- **Greige Wash** (`#f5f2ec`, `brand-50`): `surface-brand` card faces, secondary-button hover, nav hover
  pills, row hover.
- **Greige Tint** (`#e8e2d6`, `brand-100`): Badge and avatar backgrounds, empty-state icon tiles. *This is
  the step that must never be tinted petrol* — see the note above.
- **Greige** (`#d3caba`, `brand-200`): Secondary-button borders, field focus ring, `::selection`.
- **Petrol Bridge** (`#5b8c98`, `brand-300`): The focus-ring value and the disabled primary. Deliberately
  darker than a tint-weight 300, because a ring is only an affordance if it is visible against the surface
  BEHIND it: 3.37:1 on bone, clearing the 3:1 floor WCAG 2.2 sets for focus indicators. A pale 300
  measured 1.4:1 and made the loudest treatment in the system invisible.
- **Petrol** (`#0f5a6b`, `brand-600`): Primary buttons, the active navigation pill, filled panels, chart
  marks, field focus borders. 7.81:1 against white.
- **Petrol Deep** (`#0b4353`, `brand-700`): Primary-button hover; text colour for links, secondary buttons,
  icon glyphs and brand-toned badges. 10.8:1 on white, 8.39:1 on `brand-100`.
- **900 / 950** (`#082935` / `#04181f`): The far stop of `fill-brand`, doing depth rather than contrast.

**Why petrol specifically.** Hue 197° is the furthest workable point from all three verdict hues (red 28°,
amber 55°, emerald 165°) — the answer-run chart's brand-vs-degraded pair separates at ΔE 11.6 under
protanopia where the ink pair managed 5.3. It is also not the category's colour: HR tech's blue is
azure/royal at 230–250° (Indeed, LinkedIn, Lever, Naukri) and this is half that lightness and
green-leaning. It reads as gauge, calibration and instrument, which is the literal claim the product makes
about itself, and it is cool — which matters, because two of the three audiences arrive stressed and the
stated mood is *calm under pressure*.

### Secondary — Clay

One warm hue, rationed. Clay exists so the system has a second voice for *emphasis and rhythm* — the
filled block in a row of white cards, the icon tile that breaks up a grid of eight. Retuned from the
previous vivid coral, which on a bone canvas was the loudest thing on screen: the one colour forbidden
from meaning anything does not get to shout over the three that do.

- **Clay** (`#8a4824`, `accent-700`): 6.93:1 — the value anything with small white text must use. The
  marketing CTA, the "Most Popular" pricing flag. Against petrol it is now a true complementary secondary
  rather than a lone warm note: cool primary, warm secondary, warm paper ground.
- **Clay Mid** (`#c0703e`, `accent-500`): Borders, tints, focus rings, the darkest stop of `fill-ember`.
- **Clay Tint** (`#f7e6da`, `accent-100`) / **Clay Wash** (`#fdf6f1`, `accent-50`): Icon-tile fills and
  `surface-ember` card faces.

### Canvas

- **Bone** (`#f6f2ea`): The app background behind all cards, and the marketing sections' alternating band.
  Warm paper rather than near-white, so a white card reads as lifted off a tinted plane.
- **Bone Deep** (`#ece5d8`): The second band.

### Neutral — Bone greys

Tailwind's `slate` is **remapped** in `@theme` from cold blue-grey to warm greige. This is an override
rather than a new ramp, and that is the point: 1596 `slate-*` utilities across the two apps are the
product's actual neutral, so the only way to change the temperature of the whole system in one place is
to change what `slate` means. Nothing else had to move.

Lightness is held within a step of Tailwind's original at every stop, so every contrast figure documented
here still holds — most improve, because a warm grey at the same lightness carries slightly more ink.

- **Ink** (`#1a1815`, `slate-900`): Primary text.
- **Ink Body** (`#3a362f`, `slate-700`): Secondary headings and outline-button text.
- **Slate Reading** (`#4f4a42`, `slate-600`): Body copy on marketing surfaces; form labels. 8.80:1.
- **Slate Muted** (`#6e675c`, `slate-500`): Supporting copy, descriptions, inactive icons. 5.61:1 —
  was 4.76:1.
- **Slate Faint** (`#9c9384`, `slate-400`): Placeholder text, timestamps, the quietest tier, and the
  neutral midpoint of the evidence-coverage chart. 3.04:1 — decorative and disabled only, as before.
- **Field Stroke** (`#cdc5b6`, `slate-300`): Input and select borders; dashed borders on empty states.
- **Hairline** (`#e3ddd1`, `slate-200`): Card borders, dividers, header underlines.
- **Surface** (`#ffffff`): Cards, inputs, popovers, sticky headers (at 90% with backdrop blur).

### Tertiary — Outcome

Reserved, and after the repaint this is the *entire* chromatic vocabulary of the product. These three hues
carry the pipeline's meaning and nothing else may borrow them.

- **Verdict Positive** (`#047857`, tint `#d1fae5`): Shortlisted, selected, offer accepted, joined; passing
  ATS scores; proven rubric criteria; success toasts.
- **Verdict Pending** (`#92400e`, tint `#fbe8b8`): Under review, offer sent — anything awaiting a human.
  The tint deepened from `#fef3c7` with the repaint: cream on cold slate was an obvious tint, cream on a
  bone canvas was very nearly the canvas, and a badge that does not read as a badge is the worst possible
  home for "a human is owed something here".
- **Verdict Negative** (`#b91c1c`, tint `#fee2e2`): Rejected, failed criteria, destructive actions, field
  errors. The `danger` button reads this token rather than a raw `red-600`, which had drifted brighter
  than the spec and was louder on bone than an actual rejection badge.

### Quaternary — Chart fills

Chart **marks only**: bars, stacked segments, plot areas. Never text, never a badge, never a border alone.

A chart mark and a status pill have different jobs and now have different weights. A pill is small and
carries a word, so it wants the saturated verdict ink. A bar is a large field the eye rests on, and five of
them in a column at verdict weight read as an alarm rather than as a measurement. These are the same three
meanings, pastel.

- **Chart Positive** (`#5fcfa0`) — proven criteria, verified claims.
- **Chart Neutral** (`#e0d9cc`) — untested. The diverging midpoint, deliberately the palest mark on the
  page: no evidence should look like the least ink.
- **Chart Negative** (`#fb8f8a`) — failed criteria, contradicted claims, degraded audio turns.
- **Chart Brand** (`#6ec3d8`) — the single-series magnitude mark: competency bars, the answer run, the
  score-movement pair.

**Every mark carries a 1px inset ring in its own reserved verdict hue** (`ring-verdict-positive/70` and so
on). The ring is not decoration and removing it breaks the chart — see The Pastel-Needs-An-Edge Rule.

### Named Rules

**The One-Place Rule.** The `--color-brand-*`, `--color-accent-*` and `--color-slate-*` ramps in
`src/index.css` are the only place a colour is decided, and both apps ship them identically. This is not
aspirational — it is how the palette was swapped three times, blue → violet → ink → petrol, each time in a
single edit, because all ~433 brand surfaces read `brand-*` and all 1596 neutral surfaces read `slate-*`
rather than a raw Tailwind hue. Never write a raw `blue-600` / `violet-500` / `orange-500` / `teal-700`
into a component. The one permitted exception is documented at its call site: the Razorpay checkout modal
is a third-party iframe that cannot read our tokens, so `Checkout.jsx` carries a hardcoded hex.

Note that `slate` is an **override**, not a ramp of its own — the bone repaint changed what `slate-*`
means rather than introducing `stone-*` and rewriting 1596 call sites. Anyone reaching for Tailwind's
`stone` or `neutral` because "slate is cold" is looking at stale knowledge of this codebase.

**The Duotone Rule.** *Added 2026-08-05.* `brand-50`…`brand-200` are warm greige and carry no hue.
`brand-300`…`brand-950` are petrol. The split is not a gradient that someone forgot to finish — it is the
enforcement point for the Reserved Verdict Rule while the brand is chromatic.

The tint end of a brand ramp is precisely where status lands: `bg-brand-100 text-brand-700` is the
in-progress `<Badge>`, sitting on the same row as a mint pass-tint and a rose reject-tint. Give that end a
hue and it competes with them — this was built and looked at, and pale petrol read as the mint tint while
pale oxblood was very nearly the reject-tint. Colour therefore lives on **action** (buttons, nav, links,
icon glyphs, filled panels, chart marks) and never on **state**. Tinting `brand-100` petrol to "complete"
the ramp reintroduces the exact bug the split was designed around.

**The Redundant-Link Rule.** *Added 2026-08-05, generalised at the petrol repaint.* Links inside running
text are underlined by a base-layer `p a` rule. This began as a necessity under the ink primary, where
`text-brand-700` was indistinguishable from the sentence around it; it stays under petrol because colour
alone is not a signal for the ~8% of men with a colour-vision deficiency, and a product whose posture is
"never let one channel carry a claim" does not get to make an exception for its own navigation. The scope
is the trick: links that ARE a surface (nav rows, card titles, chips, buttons-as-links) live in `<h*>`,
`<li>` or a flex row, never in a paragraph, so they are untouched and need no opt-out. A one-off
`no-underline` utility still wins over the base layer.

**The Bring-Your-Own-Surface Rule.** *Added 2026-08-05.* Tailwind resolves two competing `bg-*` utilities
by its **own stylesheet order**, not by the order they appear in a class string — and `bg-white` sorts
after every `bg-<hue>-<shade>`. Every `<Card className="bg-amber-50">`-style call site in the repo was
therefore silently rendering white; six of them existed, including a red alert panel in the candidate app
and a "Recommended action" card that was white-on-white and had been invisible in production.

`<Card>` now stands down: if `className` carries a `bg-` / `surface-` / `fill-` utility, the tone's own
surface is not emitted, so there is nothing left to lose the race to. The same applies one property over —
a `className` carrying a border **colour** suppresses the tone's border, while width, side and style
(`border-2`, `border-t`, `border-dashed`) still compose. That second half was added after a card asked for
a greige border and rendered a hairline one; the border case is detected by a token scan rather than a
regex, because the first regex quietly failed on the two-segment `border-verdict-pending/50`.

This is the same trap that made padding a prop (§ Cards). The general lesson is the rule: **never rely on
class-string order to override a component's own utility** — either the component exposes a prop, or it
detects the override and yields.

**The Pastel-Needs-An-Edge Rule.** *Added 2026-08-05.* Chart fills are pastel, and pastel costs two
things that have to be bought back explicitly. Both were measured, not judged.

*Contrast.* A pastel cannot clear the 3:1 non-text contrast floor against a white card — that needs a
relative luminance of 0.30 or less, which is not a pastel by definition. These sit at 1.4–2.2:1. The relief
the rule allows is a visible label, and every mark in this product has one: the role map prints the
percentage, the verdict word and the evidence sentence on every row; the stacked bar's legend carries the
glyph, the word, the share and the criterion count. Colour is the fourth redundant channel here, never the
carrier. **A chart that cannot label its marks does not get these fills.**

*Colour-vision deficiency.* Pastel mint against pastel rose separates at ΔE 3.6 under deuteranopia — below
even the ΔE 6 floor that secondary encoding can excuse. No tuning fixes it; red and green at this lightness
are the same colour to a deuteranope. So every mark is drawn with a 1px inset ring in its own **reserved
verdict hue**, and those separate at ΔE 8.4. The ring is what makes the mark legible against the surface
and what makes the family obvious: legend chip, ring, and fill are one hue at three weights. "Cleaning up"
the bars by dropping the ring removes the accessibility of the chart, not a flourish.

The legend chip stays saturated for a third reason: it holds a white glyph at 9px, and a pastel cannot.

**The Role-Map Rule.** *Added 2026-08-05.* The interview report's hero chart is a **table**: one row per
rubric criterion, sorted heaviest first, with a bar whose width is that criterion's **weight in the role**,
coloured by what the evidence supports, and one column per evidence source (Résumé · Assessment ·
Interview). Three constraints are load-bearing and none is a style preference:

- **Bars never normalise to the widest criterion.** Width is share of the rubric, so a 40% requirement
  fills 40% of the track and the empty remainder is the rest of the role. Normalising makes every role
  look equally concentrated and destroys the only comparison that matters.
- **The label, the bar, the percentage and the verdict sit on one row.** An early build put the label at
  the far left and its value a thousand pixels away at the right; a bar chart whose label cannot be
  connected to its value by the eye is not a chart.
- **The evidence sources are columns with headers, not a trail of unlabelled squares.** They were three
  bare chips needing a sentence underneath to explain what the positions meant. As `<th>`s they explain
  themselves, and the sentence is gone. The Requirement column is `sticky left-0` so it stays on screen
  while the matrix scrolls on a narrow viewport — without it a 390px screen showed that column and
  nothing else.

This is the chart the product exists to draw. Any competitor can render "78% match"; none can render "40%
of what this role actually requires is the one thing we could not prove" — which is the sentence a
recruiter owes a hiring manager and an employer owes a tribunal. The aggregate stack sits directly beneath
it as the same artefact at a lower altitude, and is captioned as the total of the bars rather than as a
second chart of the same data.

**The Ember Containment Rule.** Ember is decorative. It may appear on filled feature cards, icon tiles,
marketing CTAs, and chart series. It may **never** appear on a badge, a status pill, a score tile, a
verdict, or any surface that reports state — and `<Badge>` deliberately ships no `ember` tone so the rule
has an enforcement point rather than a convention.

The reason is adjacency: orange's neighbour in this system is the reserved `verdict-pending` amber, which
means *awaiting a human / not yet verified*. Pending is the fastest thing a recruiter reads and the one
the product's own honesty rules lean on hardest. The moment a decorative orange can appear next to a
pending amber, the recruiter has to stop and work out which one they are looking at — and the channel
stops being worth anything. The two ramps are hue-separated on purpose (amber is gold, ~45°; ember is
red-orange, ~14°) so that when both are legitimately on screen they do not read as the same signal.

There is exactly one pill-shaped ember element in the system — the "Most Popular" flag on `Pricing.jsx` —
and it is permitted only because the marketing pricing page renders no pipeline status anywhere on it, so
there is nothing for it to be confused with. It is not a precedent. An ember pill on any screen that also
shows a candidate, a stage, or a score is a bug.

**Worked example**, because the line is finer than it first looks. On the recruiter dashboard's quick-action
row, "Post a job" is filled ember and "Rubrics to approve" — sitting directly beside it — is not. Both are
cards, both are the same size, both are urgent. The difference is that "Post a job" is a pure action with
no state attached, whereas "Rubrics to approve" *reports* something ("3 jobs are still on the legacy
keyword engine"). The reporting card takes a plain white surface and a verdict-toned `IconTile` instead,
which is the honest channel for it. Ember decorates; it does not inform.

The same call goes the other way on the candidate dashboard, where the hero panel is brand rather than
ember: "applications still open" is a state, and the list immediately beneath it renders per-application
stages in the reserved pending amber. Adjacency is the whole risk.

**The Lightest-Stop Rule.** Any gradient carrying text is contrast-checked at its **lightest** stop, not
its average — a gradient gives the text no single background to be measured against. This is why
`fill-brand` starts at `brand-600` and not the prettier `brand-500` (4.17:1), and `fill-ember` starts at
`accent-700` and not `accent-500` (3.04:1). For the same reason, secondary text on a filled card is
`white/90`, not the `white/70` that looks correct in a mock and lands at 3.8:1.

**The Tinted-Ground Rule.** *Added 2026-08-03.* `slate-500` (`#64748b`) is the muted-text default **on
white only**. It clears AA there by 0.26 (4.76:1), which means it fails on every tinted ground in the
system the moment it is moved onto one:

| Ground | `slate-500` | `slate-600` |
| --- | --- | --- |
| White | 4.76:1 ✅ | 8.6:1 ✅ |
| Canvas `#f6f5fb` | **4.39:1 ❌** | 6.99:1 ✅ |
| `brand-50` | **4.30:1 ❌** | 6.85:1 ✅ |
| `verdict-positive-tint` | **4.20:1 ❌** | 6.68:1 ✅ |

So: **muted text on any tint is `slate-600`.** This is not a rounding argument — the failing cases are
timestamps, file sizes, and step dates at 11–12px, which is exactly the copy someone leans in to read.
The rule is easy to break by accident, because the fix looks like a no-op in a mock: the two slates are
close enough that the eye reads the substitution as unchanged and the contrast ratio moves by 60%.

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

**App (Operate).** The admin dashboard is a fixed 256px (`w-64`) white sidebar, separated from the content
by a single hairline right border rather than by a change in value, plus a fluid main column. A
sticky 64px (`h-16`) header sits on white at 90% opacity with a backdrop blur, underlined by a single
hairline. Main content is padded 16px → 24px (`sm`) → 32px (`lg`) horizontally, 24px vertically, and is
otherwise unconstrained — it fills the viewport. The sidebar collapses below `lg` (1024px) into an overlay
drawer behind a scrim of ink at 50%.

The candidate app uses the same two-part model — rail plus header — but its rail is **collapsible**, and
the content column stays centered at 64rem (`max-w-5xl`) padded 20px → 32px (`sm`) horizontally, 32px
vertically. Until 2026-08-06 this app had no rail at all, on the grounds that a candidate visits four
screens over several weeks and a fixed 256px of mostly-irrelevant links would spend a quarter of a
phone-sized viewport saying so. That reasoning is answered by collapsibility rather than abandoned: the
rail is off-canvas below `lg`, and above it a reader can drop it to a 72px (`w-[4.5rem]`) icon-only strip
whose state persists in `localStorage` under `candidateNavCollapsed`. Candidate screens still open with a
`PageHero`; the rail orients *between* screens, the hero orients *within* one.

The two apps also differ in **what the rail contains**. The admin rail is a fixed list — a recruiter's
destinations do not change. The candidate rail is a function of session state: signed out it is Careers +
How it Works, signed in it is Careers + Dashboard + My Resumes. "How it Works" is the explainer for
someone deciding whether to trust an AI screen, and it lives on the marketing landing page; once the
candidate is inside a process with state, sending them back out to the pitch costs a row and tells them
nothing about their own application.

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
- **Lift** (`box-shadow: 0 2px 4px rgba(15,23,42,0.04), 0 18px 40px -12px rgba(15,23,42,0.13)`): The
  addressed plane — a surface the pointer is currently on. Pointer-tilted cards, scroll-raised panels.
- **Deep** (`box-shadow: 0 4px 8px rgba(15,23,42,0.05), 0 36px 64px -20px rgba(15,23,42,0.18)`): The
  overlay plane. Modals, sheets, anything that sits above a scrim.

### Named Rules

**The Four-Plane Rule.** `shadow-card`, `shadow-soft`, `shadow-lift`, and `shadow-deep` are the only
shadows, and they are a *ladder*: resting → lifted → addressed → overlaying. No ad-hoc `box-shadow`
values, no `shadow-lg`/`shadow-xl` utilities, no coloured glows. A new plane picks one of the four; if
none fits, the plane count is wrong.

*Amended 2026-08-02.* This was the Two-Shadow Rule. Planes 3 and 4 were added when the platform took on
scroll-led depth — two planes could not express "resting" and "addressed" and "overlaying" at once, so
components were reaching for one-off shadows. Depth still comes from **lightness and layering first**;
the ladder exists so that when a shadow is the right answer, it is drawn from the system.

**The Lift-on-Intent Rule.** Movement between planes is a response to intent — hover raises a card from
`shadow-card` to `shadow-soft` with a `-translate-y-1`; a press drops it via `active:scale-[0.98]`.
Elevation animates; it does not sit and pulse.

## Motion & Scroll

Motion is a **surface-scoped** system: the marketing pages are read top-to-bottom and earn scroll
choreography; the app is scanned and must not have its scroll position interpolated. The primitives live
in `admin/src/motion/` and are consumed by name, never re-implemented per page.

**Easing.** Three curves, tokenised in `src/index.css`. The browser default `ease` is never used and
nothing overshoots — bounce reads as a toy on a product that decides livelihoods.

- `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` — entering elements. The default.
- `--ease-in` `cubic-bezier(0.7, 0, 0.84, 0)` — exiting elements.
- `--ease-in-out` `cubic-bezier(0.65, 0, 0.35, 1)` — symmetrical state toggles.

**Primitives.**

- **`<SmoothScroll>`** — headless Lenis controller mounted once in `App.jsx`. Active only on `/welcome`,
  `/demo`, `/pricing`, and on `/` while signed out. Never on the dashboard.
- **`<Reveal>`** — one-shot IntersectionObserver reveal (18px rise + fade, 620ms `--ease-out`, optional
  stagger `delay`). One-shot is the point: content that re-animates on every re-entry means the page never
  settles.
- **`<Tilt>`** — pointer-tracked perspective, capped at 3.5°, fine-pointer only. Pairs with `shadow-lift`.
- **`useReducedMotion()`** — every primitive above is gated on it, with a CSS backstop.

### Named Rules

**The Native-Scroll Rule.** Smooth scrolling stops at the dashboard door. Interpolated scroll desyncs the
scrollbar from the wheel, which is a pleasant effect on a page you read and a defect on a queue you scan.
A recruiter must land exactly where they aimed.

**The Reduced-Motion Floor.** Every animation defines its reduced-motion behaviour explicitly, and the
resting state under `prefers-reduced-motion: reduce` is the *revealed* state. Content is never withheld
behind an animation someone asked not to see — and never behind a JS capability the browser might lack.

**The Anchored-Depth Rule.** Depth must attach to something real: a card the pointer is addressing, a
plane that holds while content passes it. Ambient 3D — floating orbs, drifting spheres, WebGL props the
user cannot manipulate, glassmorphism as decoration — is banned. It is the fastest way to look generated,
and it contradicts the claim that a code path rather than a vibe produced the score.

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

### Composite panels (`components/ui/Panels.jsx`)

Shared byte-identical by both apps.

- **`PageHero`** — the banner that opens a screen: eyebrow pill, title, one line of orientation, optional
  supporting points and an action. Runs on `fill-brand`, because the reference deck puts these on
  near-black and this system has no dark surface left (see § Neutral). Two contrast facts are baked in and
  must not be "simplified": the body line is `white/90`, not the `/70` a mock uses, which lands at 3.8:1;
  and the eyebrow is a **white pill with ink text**, not the `white/15` chip used behind icons on a
  fill — white text on that chip measures 4.12:1, under AA at 12px. A translucent chip is fine behind a
  glyph and wrong behind a word.
- **`StepTrack`** — the numbered pipeline stepper. Takes `steps`, `currentKey`, and a `reached` set;
  green marks a completed stage, which is the reserved positive channel used for exactly what it is for.
  Renders the whole ordered pipeline rather than a status word, because "Under Review" is equally true on
  day 1 and day 60 and never says what comes next. Scrolls rather than wraps.
- **`TokenList`** — the wrapped skill/requirement chips with a `+N more` overflow. Always slate, never
  brand or verdict tinted: a skill token is a fact about the posting, not a judgement about the reader, and
  a row of brand-toned pills beside a match score reads as "these are the ones you have". The overflow keeps
  the remainder in an `sr-only` span — truncation is a layout decision, not an editorial one.
- **`MetaItem`** — one icon-and-text fact in a card's meta line. Returns `null` on an empty value rather
  than rendering a lone icon, since every field it displays is optional on the underlying document.
- **`Chip` / `ChipRow`** — the pill rail. Renders as `<button>` by default; pass `as={Link}` when it
  navigates, and it sets `aria-pressed` or `aria-current` accordingly. The row scrolls rather than wraps,
  because a filter bar that reflows to three lines pushes the content it filters below the fold on a phone.
- **`HeroStat`** — the headline figure. **`basis` is a required prop**, and that is the entire reason the
  component exists rather than being page markup: the reference this is modelled on leads with a giant
  `4248%` naming no unit, no period, and no denominator, which is the exact shape of claim this product is
  built to refuse. A number that large is the most persuasive thing on the page and does not get to be the
  least accountable. If you cannot say what a figure is measured over, it is not ready to be a hero stat.
- **`ActionCard`** — the 4-up feature card: icon chip, title, one line of copy, action pinned to the bottom
  with `mt-auto` so buttons align across a stretched grid row without a hardcoded height. `iconTone`
  overrides the tone-derived chip so a white card can still carry a verdict colour.
- **`ListRow`** — the stacked chevron row. The chevron is `aria-hidden`; the row's text is its accessible
  name, since "chevron right" announced after every item in a list of eight is noise.
- **`RecordCard`** / **`RecordGrid`** — the compact record card and the grid it sits in. This is the app's
  **list primitive**: every list screen renders one card per record instead of a `<tr>`. The slots are
  fixed — `avatar`/`icon`, `title` (optionally a stretched link), `subtitle`, `trailing` for the one
  headline figure, a `meta` grid for the old columns, and a hairline-separated `footer` strip. Cards take
  the compact 16px padding, and `link` is passed as `{ as: Link, to }` so the shared kit still never
  imports the router.

  The footer strip is the reason the component exists. A table cell has nowhere to say *"this score came
  from the legacy keyword engine, not the evidence engine"* — that caveat had degenerated into a bare
  amber triangle with a `title` tooltip, invisible on touch and to a screen reader, which is precisely the
  failure The Honest Reading Rule exists to prevent. The card gives the caveat a sentence.
- **`RecordRow`** / **`RecordList`** — the same fixed slots as `RecordCard`, laid out as one line, inside a
  real `<ul>`. Same information, same order; a density choice, not a second set of rules. `note` is the
  row's answer to the card's footer strip and takes its own full-width line, because a caveat that only
  fits when the viewport is wide is a caveat that silently disappears. The `meta` columns are the first
  thing dropped below `xl` — if a column carries a caveat, the row must restate it in `note`, at the
  same breakpoint (`CandidatesAll`'s legacy-engine sentence is `xl:hidden`; raise one without the other
  and there is a viewport width where the caveat is in neither place).

  The slots are fixed in **width** as well as in order, which is the half of The Record-Card Rule that
  rows exist to deliver and that the first cut did not: a `meta` column is a fixed `w-32` track and the
  `trailing` band a fixed `xl:w-72`, so a heading sits at the same x in row one and row eighteen. Sized
  to content they did not — each row's columns slid by however wide the *next* row's engine name or stage
  label happened to be, which is a staircase, not a table, and it gives back exactly the column-aligned
  scanning the card grid was abandoned to recover. Values truncate rather than widen a track. Where a
  call site puts two things in `trailing` (score + stage), the numeric one takes its own right-aligned
  `xl:min-w-24` sub-column: `min-w` not `w`, because an unscored row says "Not scored" in words and a
  fixed track would clip the sentence to make room for a number.

### Components — admin only

Not part of the shared kit; these read from `lib/pipeline.js` and exist only in `admin/`.

- **`Menu`** (`components/ui/Menu.jsx`) — the action menu: a trigger plus a `role="menu"` popover with
  roving focus, arrow/Home/End navigation, Escape-to-close with focus restore, outside-click and
  scroll dismissal. Rendered through a portal with fixed positioning off the trigger's rect, for a reason
  worth keeping: the Hiring Pipeline board is an `overflow-x-auto` rail, and `overflow-x: auto` computes
  `overflow-y` to `auto` as well, so an absolutely-positioned panel would be clipped by the kanban column
  it opened from. Two details are load-bearing — the pre-measure commit hides the panel with `opacity-0`
  and **not** `invisible`, because a `visibility: hidden` subtree is not focusable and the menu opened
  with the keyboard stranded on the trigger; and `footer` renders *outside* the scroll area, so a long
  menu cannot bury its destructive last item.
- **`StageMenu`** (`components/ui/StageMenu.jsx`) — the candidate stage control, used by the candidate
  lists and the pipeline board. Split button: the next stage in pipeline order is a one-click primary
  action, everything else is in the menu. See The Consequence-Before-Click Rule.

### Named Rules

**The Consequence-Before-Click Rule.** *Added 2026-08-05.* A control that fires an irreversible or
candidate-visible action states what it will do **before** it is used, not after. Concretely, in
`StageMenu`: destinations carry their pipeline ordinal so a menu of twelve reads as an ordered pipeline;
an envelope marks every move that puts mail in the candidate's inbox, with a legend naming the glyph;
the terminal stages (`joined`, `rejected` — `canTransition` refuses to leave either) are separated by a
rule, pinned out of the scroll area, and confirmed in a dialog that says the move cannot be undone.

Every incumbent ATS ships this as a bare `<select>` of legal statuses, which makes rejecting a candidate
exactly as cheap a gesture as promoting one, one line apart, with the side effects discovered afterwards
from the sent folder. The rule is CLAUDE.md's *"every automated adverse action needs a human"* expressed
at the click: a human owning a decision means a human who could see what the decision does.

**The Menu-Not-Select Rule.** *Added 2026-08-05.* A `<select>` chooses a **value inside a form**. A list
of **commands** is a `Menu`. A select announces as a combobox, cannot group, annotate, or mark an option
as destructive, and renders as an undifferentiated column of strings — so an inline action select is both
a semantic mismatch and, at twelve options, an unusable one. The remaining stage `<select>` on the
candidate profile page is correct and stays: it sits in a form beside a note field and an offer message,
and it is choosing a value that a separate submit button then acts on.

**The Record-Card Rule.** *Added 2026-08-03. Amended 2026-08-05.* App list screens present records as
`RecordCard`s or `RecordRow`s, not tables. `DataTable.jsx`'s table primitives are retained but unused;
reaching for them to build a list screen is a regression. The trade is deliberate and it is not free — a
card grid gives up some column-aligned scanning, which is why the slots are fixed: if every card puts the
score in the same top-right corner and the state in the same bottom-right corner, the eye still gets its
columns.

The amendment: **a queue being scanned uses rows, not a card grid.** Fixed slots recover the columns
*within* a card, but three-up cards still put the third record's score in a different screen position
than the first's, and across forty candidates the eye loses the column entirely. The candidate lists
(`CandidateList`, `CandidatesAll`) are rows. Screens where a record is a subject in its own right, or
where the grid is genuinely 2-D, keep the card.

The exception is a genuine 2-D matrix, where one axis is not "records" — and `DataTable.jsx` exists for
exactly that case, having been kept unused until one arrived. The live example is the interview report's
**role map**: criterion × evidence source, rendered as a real `<table>` with a `<th>` per source. The
Evidence Ledger card is the other: It became one card per criterion with the round cells side by side
*inside* it, because the comparison that matters there runs along the row, and a card per cell would have
destroyed it.

**The Row-Doesn't-Jump Rule.** A record card hovers to a tinted border and `shadow-soft` and does not
translate — the one documented exception to The Lift-on-Intent Rule. Lift-on-Intent is written for panels
a pointer addresses one at a time; a queue of forty cards that jump under the cursor is harder to track
with the eye than one that holds still, which is the same call `<TR>` already made for table rows.

### Cards / Containers

- **Corner Style:** 16px (`rounded-2xl`)
- **Background:** Surface white on the canvas
- **Border:** 1px Hairline (`#e2e8f0`)
- **Shadow Strategy:** `shadow-card` at rest, `shadow-soft` plus `-translate-y-1` on interactive cards
- **Internal Padding:** 24px default, 16px `compact`, 0 `none` — selected with the `padding` prop, never
  with a `className="p-4"` override. Tailwind decides which of two competing `p-*` utilities wins by its
  own stylesheet order, not by the order they appear in a JSX string, so an override is a coin flip that
  happens to be landing right. `compact` exists for `RecordCard`: a record card is a *row*, not a panel,
  and 24px of padding on a list of forty candidates costs most of a screenful of queue.

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

- **App sidebar:** 256px, **white with a hairline right border** — not the Ink slab this line described
  until 2026-08-03, which contradicted § Neutral for a release. Items are 12px-radius rows with a 18px
  icon and a 0.875rem medium label. Rest is Slate Reading (`#475569`) on transparent; hover is
  `brand-700` on `brand-50`; active is white on a filled `brand-600` pill with `shadow-soft`. The wordmark
  sits in a 64px header above.
- **App header:** 64px, sticky, white at 90% with a backdrop blur and a hairline underbar. Company name
  and code on the left, notification bell and an avatar-plus-chevron profile menu on the right.
- **Candidate rail:** same rows and states as the app sidebar, but collapsible — 256px expanded, 72px
  icon-only collapsed, toggled from a `PanelLeftClose`/`PanelLeftOpen` control at the header's left edge.
  Collapsed rows keep their label as `sr-only` text plus a `title`, so an icon-only rail is still a list
  of *named* links rather than a column of glyphs.
- **Marketing navbar:** Anchor links in slate, ending in a primary CTA button.
- **Mobile:** Below `lg` the sidebar becomes an overlay drawer over an `rgba(15,23,42,0.5)` scrim.
- **The One-Home Rule.** A destination appears in the rail or in the header, never both. The rail holds
  *where you can go*; the header holds *who you are* — notifications, account, sign in/out. Both apps
  follow this, which is why the candidate account link is not also a rail row.

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
