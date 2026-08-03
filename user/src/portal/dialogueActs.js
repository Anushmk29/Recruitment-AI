// Client-side mirror of backend/utils/dialogueActs.js.
//
// Detection runs here because it has to be instant — a candidate who says "I don't know" and
// waits four seconds for a server round-trip before the interviewer reacts has not had a
// conversation. But nothing here decides anything: the TRIGGERS and the LIMITS all arrive from
// the server with the streaming credential, and the server re-runs this same matching before any
// act takes effect. This file is a latency optimisation, not an authority.
//
// Same relationship as portal/endpointing.js has to utils/endpointing.js. If the two ever
// disagree, the server wins by construction — see handleDecline/handleWithdraw, which fall back
// to recording the utterance as an ordinary answer rather than trusting this reading.

function wordList(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

function toWordRegex(phrase) {
  const words = String(phrase || "").toLowerCase().match(/[a-z0-9']+/g) || [];
  if (!words.length) return null;
  const parts = words.map((w) => w.replace(/'/g, "'?"));
  return new RegExp(`\\b${parts.join("[^a-z0-9]+")}\\b[.,;:!?…]*`, "gi");
}

function matchLongest(text, triggers) {
  for (const trigger of [...(triggers || [])].sort((a, b) => String(b).length - String(a).length)) {
    const re = toWordRegex(trigger);
    if (!re) continue;
    const m = re.exec(String(text));
    if (m) return { trigger, matchedText: m[0] };
  }
  return null;
}

// No policy from the server ⇒ every act is OFF, exactly like repeat and finish. What counts as
// "I want to stop" is server-owned, and a client that invented its own rule for ending interviews
// would be the single worst thing in this codebase.
export function normalizeDialogueActs(d) {
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const max = d?.maxOtherWords || {};
  return {
    withdrawTriggers: list(d?.withdrawTriggers),
    declineTriggers: list(d?.declineTriggers),
    pauseTriggers: list(d?.pauseTriggers),
    maxOtherWords: {
      withdraw: Number(max.withdraw ?? 3),
      decline: Number(max.decline ?? 6),
      pause: Number(max.pause ?? 4),
    },
    confirmYes: list(d?.confirmYes),
    confirmNo: list(d?.confirmNo),
    confirmMaxWords: Math.max(1, Number(d?.confirmMaxWords ?? 8)),
    withdrawConfirmGraceMs: Math.max(1000, Number(d?.withdrawConfirmGraceMs ?? 12000)),
    pauseGraceMs: Math.max(1000, Number(d?.pauseGraceMs ?? 30000)),
  };
}

// Which act, if any. Checked most-consequential-first, and each one only counts when it is
// essentially the WHOLE of what was said — see the server file for why that limit is the entire
// safety story ("I don't know the exact number, but…" is an answer, not a decline).
export function detectAct(transcript, policy) {
  const text = String(transcript || "");
  const total = wordList(text).length;
  const none = { act: null, matchedTrigger: null, honour: false };
  if (!total || !policy) return none;

  const order = [
    ["withdraw", policy.withdrawTriggers, policy.maxOtherWords.withdraw],
    ["decline", policy.declineTriggers, policy.maxOtherWords.decline],
    ["pause", policy.pauseTriggers, policy.maxOtherWords.pause],
  ];
  for (const [act, triggers, maxOther] of order) {
    if (!triggers.length) continue;
    const hit = matchLongest(text, triggers);
    if (!hit) continue;
    const otherWords = Math.max(0, total - wordList(hit.matchedText).length);
    return { act, matchedTrigger: hit.trigger, otherWords, honour: otherWords <= maxOther };
  }
  return none;
}

// Reply to "would you like to end the interview here?" — "yes" | "no" | null.
//
// null means unrecognisable, and callers treat it identically to "no". Nothing but an explicit
// yes ends an interview: continuing someone who wanted to stop costs them one more question they
// can decline, and stopping someone who did not want to stop costs them the job.
export function detectConfirmation(transcript, policy) {
  const text = String(transcript || "");
  const words = wordList(text);
  if (!policy || !words.length || words.length > policy.confirmMaxWords) return null;
  if (matchLongest(text, policy.confirmNo)) return "no"; // "no" wins any tie, deliberately
  if (matchLongest(text, policy.confirmYes)) return "yes";
  return null;
}
