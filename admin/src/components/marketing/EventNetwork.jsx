import { useEffect, useState } from "react";
import { Scale, Quote, Users, ShieldCheck, MessageSquare, Check } from "lucide-react";
import { useReducedMotion } from "../../motion/useReducedMotion.js";

/**
 * Hero illustration — cards riding a hairline network, cycling through the
 * events the pipeline actually emits.
 *
 * What it deliberately does NOT show: candidate names, résumé scores, or
 * counts presented as measurements. The previous hero shipped three invented
 * people with invented scores, which is a strange thing to put on the front of
 * a product whose claim is that no number is ever invented. These cards depict
 * *system* events instead — the vocabulary of the pipeline, not a fabricated
 * record of a person.
 *
 * Built in SVG + CSS. No canvas, no WebGL: the whole thing is six nodes and a
 * handful of lines, and a 3D library for that would be weight with nothing to
 * show for it.
 */

const EVENTS = [
  { icon: Scale, tone: "brand", title: "Rubric approved", detail: "Senior Backend Engineer · v3, frozen" },
  { icon: Quote, tone: "brand", title: "Claims extracted", detail: "Each one carries its source line" },
  { icon: Users, tone: "amber", title: "Routed to human review", detail: "Repeated readings disagreed" },
  { icon: MessageSquare, tone: "brand", title: "Probes generated", detail: "Unproven claims become questions" },
  { icon: ShieldCheck, tone: "green", title: "Verdict reconciled", detail: "Interview closed the loop" },
  { icon: Scale, tone: "brand", title: "Score computed", detail: "Line items sum to the total" },
];

const TONE_TILE = {
  brand: "bg-brand-50 text-brand-600",
  amber: "bg-amber-50 text-amber-600",
  green: "bg-emerald-50 text-emerald-600",
};

// Card anchor points, as percentages of the frame. Chosen so each card sits on
// a node of the network beneath it.
const SLOTS = [
  { top: "4%", right: "0%", width: "min(21rem, 88%)", delay: "0s" },
  { top: "38%", right: "14%", width: "min(20rem, 84%)", delay: "1.6s" },
  { top: "71%", right: "2%", width: "min(20rem, 84%)", delay: "3.1s" },
];

function EventCard({ event, slot, animate }) {
  const Icon = event.icon;
  return (
    <figure
      className="absolute rounded-2xl border border-slate-200 bg-white p-4 shadow-soft"
      style={{
        top: slot.top,
        right: slot.right,
        width: slot.width,
        animation: animate ? `event-drift 9s var(--ease-in-out) ${slot.delay} infinite alternate` : undefined,
      }}
    >
      {/* Keyed on the event so React remounts the row when the content rotates,
          which replays the swap animation without any transition bookkeeping. */}
      <div
        key={event.title}
        data-event-swap=""
        className="flex items-center gap-3"
        style={{ animation: animate ? "event-swap 420ms var(--ease-out) both" : undefined }}
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_TILE[event.tone]}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <figcaption className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{event.title}</p>
          <p className="truncate text-xs text-slate-500">{event.detail}</p>
        </figcaption>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Check className="h-3 w-3" aria-hidden="true" />
        </span>
      </div>
    </figure>
  );
}

export default function EventNetwork() {
  const reducedMotion = useReducedMotion();
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (reducedMotion) return undefined;
    const id = setInterval(() => setOffset((n) => n + 1), 3400);
    return () => clearInterval(id);
  }, [reducedMotion]);

  return (
    <div
      className="relative h-[26rem] w-full sm:h-[30rem]"
      role="img"
      aria-label="Illustration: pipeline events — rubric approved, claims extracted, routed to human review, probes generated, verdict reconciled."
    >
      {/* The network. Hairlines only — the lines are structure, not decoration:
          they are what the cards sit on. */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 400 400"
        fill="none"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g stroke="var(--color-slate-300)" strokeWidth="0.75" opacity="0.9">
          <path d="M-40 96 L150 96 L268 210 L420 210" />
          <path d="M-40 300 L120 300 L214 210 L420 118" />
          <path d="M60 -20 L60 158 L214 210 L300 420" />
          <path d="M420 330 L250 330 L214 210" />
          <path d="M-40 200 L214 210" />
        </g>
        <g fill="var(--color-brand-500)">
          <circle cx="214" cy="210" r="3" />
          <circle cx="60" cy="158" r="2" opacity="0.6" />
          <circle cx="268" cy="210" r="2" opacity="0.6" />
          <circle cx="120" cy="300" r="2" opacity="0.6" />
        </g>
      </svg>

      {SLOTS.map((slot, i) => (
        <EventCard
          key={slot.top}
          slot={slot}
          animate={!reducedMotion}
          // Each slot walks the event list at its own phase, so the three cards
          // never show the same thing and the set never repeats in lockstep.
          event={EVENTS[(offset + i * 2) % EVENTS.length]}
        />
      ))}
    </div>
  );
}
