/**
 * Composite dashboard surfaces — the chip row, hero stat, action card, and
 * chevron list row.
 *
 * These are the shapes the reference deck is built from, and they exist as
 * components rather than as per-page markup for the same reason <Card> does:
 * the moment a second screen hand-rolls "a pill with an icon in it", the two
 * drift and the product starts looking assembled rather than designed.
 *
 * Kept in step with admin/src/components/ui/Panels.jsx — see DESIGN.md § Do's
 * ("keep the two frontends' UI kits identical").
 */

import { ChevronRight, CircleCheck, CircleDot } from "lucide-react";
import { Card, IconTile, toneText } from "./Card.jsx";

/**
 * The banner that opens a screen: an eyebrow pill, the page title, one line of
 * orientation, and optionally a few supporting points or a primary action.
 *
 * The reference deck runs these on near-black. This system deliberately has no
 * dark surface left (DESIGN.md § Neutral — the dashboard sidebar gave the last
 * one up), so the emphasis comes from the ink fill instead. White on brand-600
 * is 15.66:1, and the body line still drops to white/90 rather than the /70 a
 * mock would use — on the previous violet fill that measured 3.8:1, and keeping
 * it is what makes the treatment survive the next repaint too.
 *
 * The eyebrow inverts to a white pill with ink text rather than the `white/15`
 * chip used behind icons elsewhere on a fill: white text on that chip measured
 * 4.12:1 on the old fill, under AA for 12px. A translucent chip is fine behind
 * a glyph and wrong behind a word.
 */
export function PageHero({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  description,
  points = [],
  action,
  as: Component = "header",
  className = "",
  ...props
}) {
  return (
    <Component
      className={`fill-brand overflow-hidden rounded-2xl px-6 py-8 shadow-card sm:px-8 sm:py-10 ${className}`}
      {...props}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700">
              {EyebrowIcon && <EyebrowIcon className="h-3.5 w-3.5" aria-hidden="true" />}
              {eyebrow}
            </span>
          )}
          <h1
            className={`font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl ${
              eyebrow ? "mt-4" : ""
            }`}
          >
            {title}
          </h1>
          {description && <p className="mt-3 max-w-prose text-sm leading-relaxed text-white/90">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {points.length > 0 && (
        <ul className="mt-7 flex flex-wrap gap-x-7 gap-y-2.5">
          {points.map((point) => (
            <li key={point} className="inline-flex items-center gap-2 text-sm font-medium text-white/90">
              {/* White ticks, not the reference's green/blue/purple ones. A
                  green check is the reserved positive-outcome mark; spending it
                  on a marketing bullet is exactly how "green means this stage
                  passed" stops being readable at a glance. */}
              <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>
      )}
    </Component>
  );
}

/**
 * A filter / segment pill.
 *
 * Renders as a <button> by default. Pass `as={Link}` for navigation — the
 * distinction matters to a screen reader far more than it does visually, and a
 * div with an onClick is neither.
 */
export function Chip({
  children,
  icon: Icon,
  trailing: Trailing,
  active = false,
  as: Component = "button",
  className = "",
  ...props
}) {
  return (
    <Component
      // `aria-current` rather than relying on the fill alone: "which segment am
      // I on" is not information a colour change conveys to anyone not looking
      // at it.
      aria-current={active && Component !== "button" ? "page" : undefined}
      aria-pressed={active && Component === "button" ? "true" : undefined}
      className={`tap-target inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 ${
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-soft focus-visible:ring-brand-300"
          : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-brand-200"
      } ${className}`}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      {children}
      {Trailing && <Trailing className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />}
    </Component>
  );
}

/**
 * The horizontal rail the chips sit in. Scrolls rather than wraps on narrow
 * viewports — a filter bar that reflows to three lines pushes the content it
 * filters below the fold on a phone.
 */
export function ChipRow({ children, label, className = "" }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The headline figure panel.
 *
 * `basis` is a REQUIRED prop, and that is the whole point of this component
 * existing. The reference this is modelled on leads with a giant "4248%" that
 * names no unit, no period, and no denominator — which is exactly the shape of
 * claim this product is built to refuse. A number this large on screen is the
 * most persuasive thing on the page; it does not get to be the least
 * accountable. If you cannot say what the figure is measured over, it is not
 * ready to be a hero stat.
 *
 * `tone` defaults to brand. Ember is permitted here ONLY for volume and
 * throughput counts — applications received, invitations sent — never for a
 * score, a stage count, or anything a candidate is evaluated by. See DESIGN.md
 * § The Ember Containment Rule.
 */
export function HeroStat({ label, value, basis, tone = "brand", badge, action, tiles = [], className = "", ...props }) {
  return (
    <Card tone={tone} className={`p-7 ${className}`} {...props}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs font-semibold text-slate-600">{label}</p>
        {badge}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-0">
          <p className="font-display text-4xl font-extrabold tabular-nums tracking-tight text-slate-900 sm:text-5xl">
            {value}
          </p>
          <p className="mt-1.5 max-w-prose text-xs text-slate-600">{basis}</p>
          {action && <div className="mt-5">{action}</div>}
        </div>

        {tiles.length > 0 && (
          <ul className="flex flex-wrap gap-4">
            {tiles.map((t) => (
              <li key={t.label} className="flex w-16 flex-col items-center gap-1.5 text-center">
                <IconTile icon={t.icon} tone={t.tone || "brand"} />
                <span className="text-[11px] leading-tight font-medium text-slate-600">{t.label}</span>
                {t.value != null && (
                  <span className="text-xs font-bold tabular-nums text-slate-900">{t.value}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * The 4-up feature card from the reference: icon chip, title, one line of
 * supporting copy, and an action pinned to the bottom.
 *
 * `mt-auto` on the action rather than a fixed height — the cards sit in a grid
 * row and stretch to the tallest, so the buttons line up without anyone
 * hardcoding a height that a longer description would then break.
 */
export function ActionCard({
  icon,
  iconTone,
  title,
  description,
  tone = "default",
  action,
  className = "",
  ...props
}) {
  const t = toneText(tone);
  return (
    <Card tone={tone} className={`flex h-full flex-col ${className}`} {...props}>
      {/* `iconTone` overrides the tone-derived default so a plain white card can
          still carry a verdict-coloured chip — which is how an urgent item stays
          urgent without the card itself reaching for a decorative fill. */}
      <IconTile icon={icon} tone={iconTone || t.tile} />
      <h3 className={`mt-4 text-base font-semibold ${t.strong}`}>{title}</h3>
      {description && <p className={`mt-1.5 text-sm leading-relaxed ${t.soft}`}>{description}</p>}
      {action && <div className="mt-auto pt-5">{action}</div>}
    </Card>
  );
}

/**
 * A tappable row in a stacked list — the right-rail pattern in the reference.
 *
 * The chevron is decorative and marked as such: the row's own text is the
 * accessible name, and "chevron right" announced after every item in a list of
 * eight is noise.
 */
export function ListRow({
  icon,
  iconTone = "brand",
  title,
  meta,
  trailing,
  as: Component = "button",
  className = "",
  ...props
}) {
  return (
    <Component
      className={`group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors duration-150 hover:border-brand-200 hover:bg-brand-50/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${className}`}
      {...props}
    >
      {icon && <IconTile icon={icon} tone={iconTone} size="sm" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800">{title}</span>
        {meta && <span className="block truncate text-xs text-slate-500">{meta}</span>}
      </span>
      {trailing}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-brand-600"
        aria-hidden="true"
      />
    </Component>
  );
}

/**
 * The compact record card — the list primitive that replaced the admin tables.
 *
 * Every list screen in the app (candidates, interview queue, jobs, tenants,
 * logs) renders one of these per record instead of a `<tr>`. The shape is fixed
 * on purpose, because a queue only stays scannable if every card puts the same
 * information in the same place:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ ⬤  Title                          [trailing] │  who / what, and the one headline figure
 *   │    subtitle                                  │
 *   │    Label      Label      Label               │  the `meta` grid — the old columns
 *   │    value      value      value               │
 *   │ ──────────────────────────────────────────── │
 *   │ footer                        footerTrailing │  basis, provenance, state
 *   └──────────────────────────────────────────────┘
 *
 * The footer strip is the reason this is a card and not a row. A table cell has
 * nowhere to say "this score came from the legacy keyword engine, not the
 * evidence engine" — that caveat ends up as a bare warning glyph in a 6px-wide
 * column, or it gets dropped entirely. CLAUDE.md's rule that a degraded reading
 * must never be dressed as a measurement needs somewhere to *write the
 * sentence*, and this is it.
 *
 * Interaction: hover tints the border and lifts `shadow-card` → `shadow-soft`,
 * and that is all. No `-translate-y`, deliberately — DESIGN.md's Lift-on-Intent
 * Rule is written for panels a pointer addresses one at a time, and a record
 * card is a *row*; a grid of forty rows that jump under the cursor is harder to
 * track with the eye than one that holds still. Same call `<TR>` made.
 */
export function RecordCard({
  title,
  subtitle,
  link,
  avatar,
  icon,
  iconTone = "brand",
  trailing,
  meta = [],
  metaColumns = 3,
  footer,
  footerTrailing,
  actions,
  className = "",
  children,
  ...props
}) {
  // Column counts are looked up, never interpolated — Tailwind scans source for
  // whole class names, so `grid-cols-${n}` compiles to nothing at all.
  const metaCols = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
  };

  return (
    <Card
      padding="compact"
      className={`relative flex h-full flex-col transition-[box-shadow,border-color] duration-150 hover:border-brand-200 hover:shadow-soft ${className}`}
      {...props}
    >
      <div className="flex items-start gap-3">
        {avatar}
        {icon && <IconTile icon={icon} tone={iconTone} size="sm" />}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">
            <RecordLink link={link}>{title}</RecordLink>
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 [overflow-wrap:anywhere]">{subtitle}</p>}
        </div>
        {/* No z-index here: the stretched link is allowed to cover the badge so
            the whole card stays one target. Anything that needs its own click
            goes in `actions`. */}
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>

      {meta.length > 0 && (
        <dl className={`mt-3 grid gap-x-4 gap-y-2.5 ${metaCols[metaColumns] ?? metaCols[3]}`}>
          {meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-[11px] font-semibold text-slate-500">{m.label}</dt>
              <dd className="mt-0.5 text-sm text-slate-700 [overflow-wrap:anywhere]">
                {/* An empty cell renders an em dash rather than nothing. A blank
                    where a number belongs reads as a zero, which for a score or
                    a count is a different claim than "not recorded". */}
                {m.value == null || m.value === "" ? "—" : m.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {children}

      {(footer || footerTrailing) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
          <span className="min-w-0 [overflow-wrap:anywhere]">{footer}</span>
          {footerTrailing && <span className="shrink-0">{footerTrailing}</span>}
        </div>
      )}

      {/* `mt-auto` so action rows line up across a stretched grid row, and
          `relative z-10` so these sit above the stretched title link rather than
          under it — a button you cannot press because a card-wide anchor covers
          it is the classic failure of this pattern. */}
      {actions && <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-3">{actions}</div>}
    </Card>
  );
}

/**
 * The record ROW — <RecordCard>'s slots, laid out as one line.
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ ⬤ Title                      Label   [trailing]  [actions]           │
 *   │   subtitle                   value                                   │
 *   │   note                                                               │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Same information, same order, same fixed slots as the card — this is a
 * density choice, not a different component with different rules.
 *
 * A card grid is right when a record carries several fields worth reading
 * together. It is wrong for a queue you are *scanning*: three-up cards put the
 * third candidate's score in a different screen position than the first's, and
 * the eye loses the column. Rows give the columns back. Screens where a
 * recruiter compares many people at a glance — the candidate lists — use these;
 * screens where a record is a subject in its own right keep the card.
 *
 * `note` is the row's answer to the card's footer strip, and it exists for the
 * same non-negotiable reason: a degraded reading ("this score came from the
 * legacy keyword engine") needs somewhere to be a sentence, not a glyph. It
 * takes its own full-width line rather than being squeezed between columns,
 * because a caveat that only fits when the viewport is wide is a caveat that
 * silently disappears.
 *
 * Hover tints the row and nothing moves — The Row-Doesn't-Jump Rule, which was
 * written for the card and applies with more force here.
 */
export function RecordRow({
  title,
  subtitle,
  link,
  avatar,
  icon,
  iconTone = "brand",
  meta = [],
  trailing,
  note,
  actions,
  className = "",
  children,
  ...props
}) {
  return (
    <li
      className={`relative bg-white px-4 py-3 transition-colors duration-150 hover:bg-brand-50/50 ${className}`}
      {...props}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {avatar}
          {icon && <IconTile icon={icon} tone={iconTone} size="sm" />}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              <RecordLink link={link}>{title}</RecordLink>
            </h3>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>

        {/* The meta columns are the first thing to go on a narrow viewport:
            they are supporting detail, and the row's job below `xl` is name,
            outcome, action. Everything dropped here is still on the record's
            own page.
            `xl`, not `lg`: with the 256px sidebar a 1024px viewport leaves the
            row ~670px, and two fixed tracks plus the outcome band take enough
            of it that the candidate's NAME truncates — trading the one column
            nobody can do without for two that the record's own page repeats. A
            column that only aligns by starving the title is not aligned, it is
            just differently broken. */}
        {meta.length > 0 && (
          <dl className="hidden shrink-0 items-start gap-x-6 xl:flex">
            {meta.map((m) => (
              // A FIXED track, not a content-sized one — this is the whole
              // reason the queue screens are rows (DESIGN.md § The Record-Card
              // Rule). "Fixed slots recover the columns" is only true if a slot
              // is fixed in WIDTH as well as in order: sized to content, the
              // "Applied" heading slid left or right by however wide the next
              // row's engine name happened to be, and eighteen rows of that is
              // a staircase, not a table. Values truncate rather than widen the
              // track; the record's own page carries the untruncated field.
              <div key={m.label} className="w-32 min-w-0">
                <dt className="text-[11px] font-semibold text-slate-500">{m.label}</dt>
                <dd className="mt-0.5 truncate text-sm text-slate-700">
                  {/* An em dash, never a blank — see <RecordCard>. */}
                  {m.value == null || m.value === "" ? "—" : m.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* The outcome slot takes the same fixed track, at the same breakpoint,
            so the columns arrive and leave together. Below `xl` the badges stay
            right-anchored, which is the alignment the row already had.
            `flex-nowrap` because a verdict that wraps to a second line inside
            its own column changes the row height and breaks the scan. */}
        {trailing && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end xl:w-72 xl:flex-nowrap xl:justify-start">
            {trailing}
          </div>
        )}

        {/* `relative z-10` so a control sits above the stretched title link
            rather than under it. */}
        {actions && <div className="relative z-10 flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {note && <div className="mt-2 text-xs text-slate-500 [overflow-wrap:anywhere]">{note}</div>}
      {children}
    </li>
  );
}

/**
 * The container <RecordRow>s sit in — a real <ul>, so the number of records is
 * announced and the rows are navigable as a list.
 *
 * `overflow-hidden` clips the rows' hover fill to the panel's corners. It does
 * not clip an open <Menu>: those render through a portal precisely so a row
 * action can escape its container.
 */
export function RecordList({ children, label, className = "" }) {
  return (
    <ul
      aria-label={label}
      className={`divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 shadow-card ${className}`}
    >
      {children}
    </ul>
  );
}

/**
 * The record's title, optionally as a stretched link.
 *
 * `link` is `{ as: Link, to }` (or `{ as: "a", href }`) — the same `as`-passing
 * convention `Chip`, `ListRow`, and `Button` use, so the shared UI kit still
 * doesn't import the router.
 *
 * The `after:absolute after:inset-0` pseudo-element is what makes the whole card
 * clickable while leaving exactly ONE link in the accessibility tree. The
 * alternative — wrapping the card in an anchor — nests the action buttons inside
 * it, which is invalid HTML and unusable with a keyboard.
 */
function RecordLink({ link, children }) {
  if (!link) return children;
  const { as: Component = "a", className = "", ...rest } = link;
  return (
    <Component
      className={`rounded-sm transition-colors after:absolute after:inset-0 after:rounded-2xl hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${className}`}
      {...rest}
    >
      {children}
    </Component>
  );
}

/**
 * The responsive rail record cards sit in.
 *
 * `columns` caps the widest breakpoint rather than setting it, because these
 * grids hold different densities: a candidate card is three fields wide and sits
 * three-up comfortably, an audit-log card is six and wants two.
 */
export function RecordGrid({ children, columns = 3, className = "" }) {
  const cols = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  };
  return <div className={`grid gap-3 ${cols[columns] ?? cols[3]} ${className}`}>{children}</div>;
}

/**
 * The numbered pipeline stepper — one card per stage, passed ones marked, the
 * rest quiet but still legible.
 *
 * `steps` is `[{ key, label, meta }]` in pipeline order. Showing the whole
 * ordered pipeline rather than a single status word is the point of the
 * component: every other candidate portal renders "Under Review", which is
 * equally true on day 1 and day 60 and never says what comes next.
 *
 * Green here is not decoration — a completed stage is precisely what the
 * reserved positive channel is for. Unreached steps are `slate-500`, not the
 * `slate-400` a mock reaches for: quieter is the intent, unreadable is not.
 *
 * Scrolls rather than wraps, so a long pipeline stays one legible line instead
 * of reflowing into a block that buries whatever sits under it.
 */
export function StepTrack({ steps, currentKey, reached, label, className = "" }) {
  const hasReached = (key) => (reached instanceof Set ? reached.has(key) : Boolean(reached?.includes?.(key)));

  return (
    <ol
      aria-label={label}
      className={`-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {steps.map((step, i) => {
        const current = step.key === currentKey;
        const done = !current && hasReached(step.key);
        return (
          // `aria-current="step"` is what carries "you are here" to a screen
          // reader. The ring and the ink carry it visually and nothing else
          // carried it programmatically.
          <li
            key={step.key}
            aria-current={current ? "step" : undefined}
            className={`min-w-[9.5rem] flex-1 rounded-2xl border p-4 ${
              current
                ? "border-brand-600 bg-brand-50"
                : done
                  ? "border-transparent bg-verdict-positive-tint"
                  : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span
                className={`text-[11px] font-semibold tabular-nums ${
                  current ? "text-brand-700" : done ? "text-verdict-positive" : "text-slate-500"
                }`}
              >
                Step {String(i + 1).padStart(2, "0")}
              </span>
              {done && <CircleCheck className="h-4 w-4 shrink-0 text-verdict-positive" aria-hidden="true" />}
              {current && <CircleDot className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />}
            </div>
            <p className={`mt-1.5 text-sm font-semibold ${current || done ? "text-slate-900" : "text-slate-500"}`}>
              {step.label}
              {current && <span className="sr-only"> (current step)</span>}
            </p>
            {/* slate-600, not the slate-500 used on white elsewhere. slate-500
                clears AA on white by 0.26 and by nothing at all on a tint — on
                the green completed ground it lands at 4.20:1. See DESIGN.md
                § The Tinted-Ground Rule. */}
            {step.meta && <p className="mt-0.5 text-[11px] text-slate-600">{step.meta}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A wrapped set of small tokens — the "required stack" chip block in the
 * reference — with an overflow count once the list runs long.
 *
 * These are slate, never brand or verdict tinted. A skill token is a fact about
 * the posting, not a judgement about the reader, and a row of brand-toned pills
 * next to a match score reads as "these are the ones you have".
 */
export function TokenList({ items = [], max = 6, label, className = "" }) {
  if (!items.length) return null;
  const shown = items.slice(0, max);
  const rest = items.slice(max);

  return (
    <div className={className}>
      {label && <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</p>}
      <ul className={`flex flex-wrap gap-1.5 ${label ? "mt-2" : ""}`}>
        {shown.map((item) => (
          <li key={item} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {item}
          </li>
        ))}
        {rest.length > 0 && (
          <li className="rounded-lg border border-dashed border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500">
            +{rest.length} more
            {/* Truncation here is a layout decision, not an editorial one, so
                the remainder stays in the accessible name. Nobody using a
                screen reader should be handed a shorter list than the page is
                actually describing. */}
            <span className="sr-only">: {rest.join(", ")}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * One icon-and-text fact in a card's meta line — location, seniority, a date.
 *
 * Returns null on an empty value rather than rendering a lone icon, because
 * every field this displays is optional on the underlying document and a
 * floating pin with no place next to it looks like a bug.
 */
export function MetaItem({ icon: Icon, children, className = "" }) {
  if (children == null || children === "") return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm text-slate-500 ${className}`}>
      {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />}
      {children}
    </span>
  );
}
