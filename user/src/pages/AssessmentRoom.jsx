import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Loader2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Flag,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Check,
  CheckCircle2,
  ListChecks,
  LayoutGrid,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import api from "../api/client.js";
import { authHeader } from "../portal/assessmentAuth.js";
import { Card } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

// The item screen (ASSESSMENT-ENGINE-PLAN A2.4/A2.5). This is the highest-stakes,
// lowest-context session in the product: a stranger, on their own device, under a
// clock, with a job on the line. Three rules shape the screen.
//
//   1. Advancing is the loud control; submitting is not. Submit is never one click
//      from a question — it sits behind a Review step that NAMES what is unfinished
//      and links straight to it. Telling a candidate "3 unanswered" and giving them
//      no route to those three is a count, not navigation.
//   2. Nothing about the candidate's work is left implicit. Autosave reports its own
//      state, the clock warns on a ladder instead of only at 0:60, and every pending
//      write is flushed before the section closes.
//   3. Integrity signals are described, never insinuated. Fullscreen is offered with
//      its consequence stated, not grabbed silently on mount (where the browser
//      rejects it anyway, for want of a user gesture).

const TYPE_LABEL = {
  mcq_single: "Choose one",
  mcq_multi: "Choose all that apply",
  numeric: "Numeric answer",
  ordering: "Put in order",
};

// Announce at ten, five and one minute. Aimed at screen readers, but the visible
// clock steps with it so the warning is never sound-only.
const ANNOUNCE_AT = [600, 300, 60];

function fmtClock(sec) {
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function spokenTime(sec) {
  if (sec >= 60) {
    const m = Math.round(sec / 60);
    return `${m} minute${m === 1 ? "" : "s"} remaining`;
  }
  return `${sec} seconds remaining`;
}

function isAnswered(item, response) {
  if (response === null || response === undefined) return false;
  if (item.type === "numeric") return response !== "" && Number.isFinite(Number(response));
  return Array.isArray(response) && response.length > 0;
}

function statusOf(item, responses, marked) {
  if (marked[item.itemId]) return "marked";
  if (isAnswered(item, responses[item.itemId])) return "answered";
  return "unanswered";
}

// One vocabulary for the palette, the legend, the counters and the review list, so
// a colour means the same thing in all four places. The green/amber pairing is the
// exam grammar candidates already arrive knowing; it predates this file and stays.
const STATUS_STYLE = {
  current: { chip: "bg-brand-600 text-white ring-brand-600", dot: "bg-brand-600", label: "Current question" },
  answered: { chip: "bg-emerald-500 text-white ring-emerald-500", dot: "bg-emerald-500", label: "Answered" },
  marked: { chip: "bg-amber-400 text-amber-950 ring-amber-400", dot: "bg-amber-400", label: "Marked for review" },
  seen: { chip: "bg-white text-slate-600 ring-slate-300", dot: "bg-white ring-1 ring-inset ring-slate-300", label: "Seen, not answered" },
  unanswered: { chip: "bg-slate-100 text-slate-500 ring-slate-200", dot: "bg-slate-200", label: "Not opened yet" },
};

export default function AssessmentRoom() {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const [section, setSection] = useState(null);
  const [items, setItems] = useState([]);
  const [responses, setResponses] = useState({}); // itemId → response
  const [marked, setMarked] = useState({}); // itemId → bool
  const [visited, setVisited] = useState({});
  const [index, setIndex] = useState(0);
  const [remainingSec, setRemainingSec] = useState(null);
  const [error, setError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [view, setView] = useState("question"); // "question" | "review"
  const [sheetOpen, setSheetOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // Per-item timers. A single shared timer (the previous shape) meant answering Q1
  // and moving to Q2 inside the 400ms debounce cancelled Q1's write, and the answer
  // was never sent — a silently dropped answer on a graded, timed test.
  const saveTimers = useRef(new Map());
  const pending = useRef(new Map()); // itemId → payload the server has not accepted yet
  const inflight = useRef(0);
  const eventQueue = useRef([]);
  const submittingRef = useRef(false);
  const announcedRef = useRef(new Set());
  const mainRef = useRef(null);

  // --- Load section + start its clock ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post(`/assessment-portal/sections/${sectionId}/start`, {}, { headers: authHeader() });
        if (cancelled) return;
        setSection(res.data.section);
        setItems(res.data.items);
        setRemainingSec(res.data.remainingSec);
        const savedResponses = {};
        const savedMarks = {};
        for (const item of res.data.items) {
          if (item.response !== null && item.response !== undefined) savedResponses[item.itemId] = item.response;
          if (item.markedForReview) savedMarks[item.itemId] = true;
        }
        setResponses(savedResponses);
        setMarked(savedMarks);
      } catch (err) {
        if (cancelled) return;
        const msg = err.response?.data?.error || "Could not open this section.";
        if (err.response?.status === 410 || err.response?.status === 409) {
          navigate("/assessment-portal/hub", { replace: true });
          return;
        }
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sectionId, navigate]);

  // --- Local countdown (display only; server re-checks on every write) -------
  const clockRunning = remainingSec !== null;
  useEffect(() => {
    if (!clockRunning) return undefined;
    const t = setInterval(() => setRemainingSec((s) => (s === null ? s : s - 1)), 1000);
    return () => clearInterval(t);
  }, [clockRunning]);

  useEffect(() => {
    if (remainingSec === null) return;
    for (const mark of ANNOUNCE_AT) {
      if (remainingSec <= mark && !announcedRef.current.has(mark)) {
        announcedRef.current.add(mark);
        setAnnouncement(spokenTime(Math.max(0, remainingSec)));
      }
    }
  }, [remainingSec]);

  // --- Saving ----------------------------------------------------------------
  const sendSave = useCallback(
    async (itemId, payload, { retry = true } = {}) => {
      inflight.current += 1;
      setSaveState("saving");
      try {
        const res = await api.post("/assessment-portal/responses", payload, { headers: authHeader() });
        pending.current.delete(itemId);
        if (Number.isFinite(res.data?.remainingSec)) setRemainingSec(res.data.remainingSec);
        inflight.current -= 1;
        if (inflight.current === 0 && pending.current.size === 0) setSaveState("saved");
      } catch (err) {
        inflight.current -= 1;
        if (err.response?.status === 410) {
          navigate("/assessment-portal/hub", { replace: true });
          return;
        }
        // One quiet retry, then say so out loud. A candidate who cannot see that a
        // write failed keeps answering into a void — silence is the worst state
        // this screen can be in.
        if (retry) {
          setSaveState("saving");
          setTimeout(() => {
            if (pending.current.has(itemId)) sendSave(itemId, payload, { retry: false });
          }, 1800);
        } else {
          setSaveState("error");
        }
      }
    },
    [navigate]
  );

  const queueSave = useCallback(
    (itemId, response, isMarked) => {
      const item = items.find((i) => i.itemId === itemId);
      let value = response === "" || response === undefined ? null : response;
      if (item?.type === "numeric" && value !== null) value = Number(value);
      const payload = { itemId, response: value, markedForReview: Boolean(isMarked) };

      pending.current.set(itemId, payload);
      setSaveState("saving");
      clearTimeout(saveTimers.current.get(itemId));
      saveTimers.current.set(
        itemId,
        setTimeout(() => {
          saveTimers.current.delete(itemId);
          sendSave(itemId, payload);
        }, 400)
      );
    },
    [items, sendSave]
  );

  // Everything still sitting in a debounce window goes out now. Without this, the
  // last answer before a submit — the one entered in the final half-second — never
  // reaches the server.
  const flushSaves = useCallback(async () => {
    for (const timer of saveTimers.current.values()) clearTimeout(timer);
    saveTimers.current.clear();
    const outstanding = [...pending.current.entries()];
    await Promise.all(outstanding.map(([itemId, payload]) => sendSave(itemId, payload, { retry: false })));
  }, [sendSave]);

  const submitSection = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setSubmitError("");
    try {
      await flushSaves();
    } catch {
      /* a failed flush must not block the submit — the server keeps whatever landed */
    }
    try {
      await api.post(`/assessment-portal/sections/${sectionId}/submit`, {}, { headers: authHeader() });
      navigate("/assessment-portal/hub", { replace: true });
    } catch (err) {
      const status = err.response?.status;
      if (status === 409 || status === 410) {
        // Already closed server-side — submitted either way, so the hub is correct.
        navigate("/assessment-portal/hub", { replace: true });
        return;
      }
      // Anything else is a live failure, and the candidate has to be able to retry
      // rather than be dropped on the hub as though it worked.
      submittingRef.current = false;
      setBusy(false);
      setSubmitError(
        err.response?.data?.error || "We couldn't submit this section just now. Your answers are saved — try again."
      );
    }
  }, [sectionId, navigate, flushSaves]);

  useEffect(() => {
    if (remainingSec !== null && remainingSec <= 0 && !timeUp) {
      setTimeUp(true);
      submitSection();
    }
  }, [remainingSec, timeUp, submitSection]);

  // --- Integrity events (advisory; server assigns severity) ------------------
  useEffect(() => {
    const push = (type) => eventQueue.current.push({ type });
    const onVis = () => document.visibilityState === "hidden" && push("tab_switch");
    const onBlur = () => push("window_blur");
    const onCopy = () => push("copy");
    const onPaste = () => push("paste");
    const onCtx = () => push("context_menu");
    const onFs = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (!document.fullscreenElement) push("fullscreen_exit");
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onCtx);
    document.addEventListener("fullscreenchange", onFs);

    const flusher = setInterval(async () => {
      if (!eventQueue.current.length) return;
      const events = eventQueue.current.splice(0, eventQueue.current.length);
      try {
        const res = await api.post("/assessment-portal/proctoring/events", { events }, { headers: authHeader() });
        if (res.data?.paused) navigate("/assessment-portal/hub", { replace: true });
      } catch {
        /* flush failures never disturb the candidate */
      }
    }, 8000);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onCtx);
      document.removeEventListener("fullscreenchange", onFs);
      clearInterval(flusher);
    };
  }, [navigate]);

  const current = items[index];

  useEffect(() => {
    if (current) setVisited((v) => (v[current.itemId] ? v : { ...v, [current.itemId]: true }));
  }, [current]);

  // A new question starts at the top of its own pane, not wherever the last one was
  // scrolled to.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [index, view]);

  const setResponse = useCallback(
    (itemId, value) => {
      setResponses((r) => ({ ...r, [itemId]: value }));
      queueSave(itemId, value, marked[itemId]);
    },
    [queueSave, marked]
  );

  const toggleMark = useCallback(() => {
    if (!current) return;
    const next = !marked[current.itemId];
    setMarked((m) => ({ ...m, [current.itemId]: next }));
    queueSave(current.itemId, responses[current.itemId] ?? null, next);
  }, [current, marked, responses, queueSave]);

  const resetAnswer = useCallback(() => {
    if (!current) return;
    setResponse(current.itemId, current.type === "numeric" ? "" : []);
  }, [current, setResponse]);

  const go = useCallback(
    (i) => {
      setIndex((prev) => {
        const next = Math.max(0, Math.min(items.length - 1, i));
        return Number.isFinite(next) ? next : prev;
      });
      setView("question");
      setSheetOpen(false);
    },
    [items.length]
  );

  const counts = useMemo(() => {
    let answered = 0;
    let markedCount = 0;
    for (const item of items) {
      if (isAnswered(item, responses[item.itemId])) answered += 1;
      if (marked[item.itemId]) markedCount += 1;
    }
    return { answered, unanswered: items.length - answered, marked: markedCount, total: items.length };
  }, [items, responses, marked]);

  const jumpToFirst = useCallback(
    (status) => {
      const i = items.findIndex((item) =>
        status === "unanswered"
          ? !isAnswered(item, responses[item.itemId])
          : status === "answered"
            ? isAnswered(item, responses[item.itemId])
            : Boolean(marked[item.itemId])
      );
      if (i >= 0) go(i);
    },
    [items, responses, marked, go]
  );

  // --- Keyboard --------------------------------------------------------------
  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && sheetOpen) {
        setSheetOpen(false);
        return;
      }
      if (view !== "question" || !current) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (index < items.length - 1) go(index + 1);
        else setView("review");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (index > 0) go(index - 1);
      } else if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleMark();
      } else if (/^[1-9]$/.test(e.key) && (current.type === "mcq_single" || current.type === "mcq_multi")) {
        const opt = current.options?.[Number(e.key) - 1];
        if (!opt) return;
        e.preventDefault();
        const selected = Array.isArray(responses[current.itemId]) ? responses[current.itemId] : [];
        if (current.type === "mcq_multi") {
          setResponse(
            current.itemId,
            selected.includes(opt.id) ? selected.filter((v) => v !== opt.id) : [...selected, opt.id]
          );
        } else {
          setResponse(current.itemId, [opt.id]);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, current, index, items.length, responses, sheetOpen, go, toggleMark, setResponse]);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // --- Terminal / loading states --------------------------------------------
  if (error) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6">
        <Card className="max-w-md text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" />
          <p className="text-sm font-medium text-red-600">{error}</p>
          <Button className="mt-4" onClick={() => navigate("/assessment-portal/hub")}>
            Back to sections
          </Button>
        </Card>
      </div>
    );
  }
  if (!section || !current) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
        <p className="text-sm text-slate-500">Opening your section…</p>
      </div>
    );
  }

  const lastQuestion = index === items.length - 1;
  const progressPct = counts.total ? Math.round((counts.answered / counts.total) * 100) : 0;

  const palette = (onNavigate) => (
    <Palette
      items={items}
      responses={responses}
      marked={marked}
      visited={visited}
      index={index}
      counts={counts}
      view={view}
      onJump={go}
      onJumpStatus={jumpToFirst}
      onReview={() => {
        onNavigate?.();
        setView("review");
      }}
    />
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-canvas">
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {/* ---------------------------------------------------------------- Top */}
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold text-slate-900 sm:text-base">{section.title}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              <span>
                {view === "review" ? (
                  "Reviewing your answers"
                ) : (
                  <>
                    Question <strong className="font-semibold text-slate-700">{index + 1}</strong> of {items.length}
                  </>
                )}
              </span>
              {/* The two facts wrap onto separate lines on a narrow phone, where a
                  separator would just dangle at the end of the first one. */}
              <span aria-hidden="true" className="hidden text-slate-300 sm:inline">
                ·
              </span>
              <SaveIndicator state={saveState} />
            </p>
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            title="Leaving fullscreen during the test is recorded as an integrity signal for a reviewer to read."
            className="hidden h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 sm:inline-flex"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>

          <Countdown seconds={remainingSec} />
        </div>

        {/* Answered-so-far. A bar, not a ring: this counts work done, and it must
            never be mistaken for a score. */}
        <div className="h-1 w-full bg-slate-100" role="presentation">
          <div className="h-full bg-brand-600 transition-[width] duration-300 ease-out" style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      {/* --------------------------------------------------------------- Body */}
      <div className="flex min-h-0 flex-1">
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            {view === "question" ? (
              <QuestionView
                item={current}
                value={responses[current.itemId]}
                isMarked={Boolean(marked[current.itemId])}
                onChange={(v) => setResponse(current.itemId, v)}
              />
            ) : (
              <ReviewView
                items={items}
                responses={responses}
                marked={marked}
                counts={counts}
                sectionTitle={section.title}
                acknowledged={acknowledged}
                onAcknowledge={setAcknowledged}
                submitError={submitError}
                onJump={go}
              />
            )}
          </div>
        </main>

        {/* Palette rail — lg and up */}
        <aside aria-label="Question navigator" className="hidden w-[19rem] shrink-0 overflow-y-auto border-l border-slate-200 bg-white lg:block">
          {palette()}
        </aside>
      </div>

      {/* ------------------------------------------------------------- Bottom */}
      <footer className="shrink-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-3 sm:px-6">
          {view === "question" ? (
            <>
              <Button variant="outline" onClick={() => go(index - 1)} disabled={index === 0} className="shrink-0">
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Previous</span>
                <span className="sr-only sm:hidden">Previous question</span>
              </Button>

              <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
                <Button variant="ghost" size="sm" onClick={toggleMark} aria-pressed={Boolean(marked[current.itemId])}>
                  <Flag className={`h-4 w-4 ${marked[current.itemId] ? "fill-amber-400 text-amber-500" : ""}`} />
                  <span className="hidden sm:inline">{marked[current.itemId] ? "Unmark" : "Mark for review"}</span>
                  <span className="sr-only sm:hidden">{marked[current.itemId] ? "Unmark" : "Mark for review"}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetAnswer}
                  disabled={!isAnswered(current, responses[current.itemId])}
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="hidden sm:inline">Clear</span>
                  <span className="sr-only sm:hidden">Clear this answer</span>
                </Button>
                <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSheetOpen(true)}>
                  <LayoutGrid className="h-4 w-4" />
                  <span className="tabular-nums">
                    {index + 1}/{items.length}
                  </span>
                  <span className="sr-only">Open the question list</span>
                </Button>
              </div>

              <Button onClick={() => (lastQuestion ? setView("review") : go(index + 1))} className="shrink-0">
                {lastQuestion ? (
                  <>
                    <ListChecks className="h-4 w-4" />
                    <span>
                      Review<span className="hidden sm:inline"> answers</span>
                    </span>
                  </>
                ) : (
                  <>
                    Next <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setView("question")} className="shrink-0">
                <ChevronLeft className="h-4 w-4" />
                <span>
                  Back<span className="hidden sm:inline"> to questions</span>
                </span>
              </Button>
              {/* A disabled primary with its reason off-screen is a dead end. The
                  footer names the blocker in the same glance as the greyed button. */}
              <p className="hidden flex-1 text-center text-xs sm:block">
                {counts.unanswered === 0 ? (
                  <span className="text-slate-500">Every question answered</span>
                ) : acknowledged ? (
                  <span className="text-slate-500">
                    Submitting with {counts.unanswered} unanswered
                  </span>
                ) : (
                  <span className="font-medium text-amber-700">
                    {counts.unanswered} unanswered — confirm above to submit anyway
                  </span>
                )}
              </p>
              <Button
                onClick={submitSection}
                loading={busy}
                disabled={counts.unanswered > 0 && !acknowledged}
                className="shrink-0"
              >
                Submit section
              </Button>
            </>
          )}
        </div>
      </footer>

      {/* Palette sheet — below lg */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close the question list"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-slate-900/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="All questions"
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-soft"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">All questions</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {palette(() => setSheetOpen(false))}
          </div>
        </div>
      )}

      {timeUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-soft">
            <Clock className="mx-auto mb-3 h-8 w-8 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Time is up</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Submitting the answers you saved. Everything you entered has already been recorded.
            </p>
            <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-brand-600" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Countdown */

function Countdown({ seconds }) {
  const tier = seconds === null ? "unknown" : seconds <= 60 ? "critical" : seconds <= 300 ? "warning" : "calm";
  const styles = {
    unknown: "bg-slate-100 text-slate-400",
    calm: "bg-slate-100 text-slate-800",
    warning: "bg-amber-100 text-amber-800",
    critical: "bg-red-100 text-red-700",
  };
  return (
    <div className="shrink-0 text-right">
      <p className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-base font-bold tabular-nums sm:text-lg ${styles[tier]}`}>
        <Clock className={`h-4 w-4 sm:h-5 sm:w-5 ${tier === "critical" ? "motion-safe:animate-pulse" : ""}`} aria-hidden="true" />
        <span aria-hidden="true">{seconds === null ? "--:--" : fmtClock(seconds)}</span>
        <span className="sr-only">{seconds === null ? "Time remaining unknown" : spokenTime(Math.max(0, seconds))}</span>
      </p>
      {tier === "warning" && <p className="mt-0.5 text-[11px] font-medium text-amber-700">Under 5 minutes left</p>}
      {tier === "critical" && <p className="mt-0.5 text-[11px] font-medium text-red-600">Submits automatically at 0:00</p>}
    </div>
  );
}

/* ----------------------------------------------------------- Save indicator */

function SaveIndicator({ state }) {
  if (state === "idle") return <span className="text-slate-400">Answers save automatically</span>;
  if (state === "saving")
    return (
      <span className="inline-flex items-center gap-1 text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Saving…
      </span>
    );
  if (state === "saved")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600">
        <Check className="h-3 w-3" aria-hidden="true" /> Saved
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 font-medium text-red-600">
      <AlertCircle className="h-3 w-3" aria-hidden="true" /> Not saved — check your connection
    </span>
  );
}

/* ------------------------------------------------------------- Question view */

function QuestionView({ item, value, isMarked, onChange }) {
  return (
    <article>
      {/* No question-number chip here: the sticky header already carries "Question
          n of N" and never scrolls away. Two copies of one fact is noise. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {TYPE_LABEL[item.type] || item.type.replace(/_/g, " ")}
        </span>
        {isMarked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
            <Flag className="h-3 w-3 fill-amber-400 text-amber-500" aria-hidden="true" /> Marked for review
          </span>
        )}
      </div>

      <h2 id="question-stem" className="text-lg font-semibold leading-snug text-slate-900 sm:text-xl">
        {item.stem}
      </h2>

      <div className="mt-6">
        <AnswerWidget item={item} value={value} onChange={onChange} />
      </div>

      <p className="mt-8 hidden text-xs text-slate-400 lg:block">
        Keyboard: <Kbd>←</Kbd> <Kbd>→</Kbd> move · <Kbd>1</Kbd>–<Kbd>9</Kbd> pick an option · <Kbd>M</Kbd> mark for review
      </p>
    </article>
  );
}

function Kbd({ children }) {
  return (
    <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[11px] font-semibold text-slate-500">
      {children}
    </kbd>
  );
}

/* --------------------------------------------------------------- Review view */

function ReviewView({ items, responses, marked, counts, sectionTitle, acknowledged, onAcknowledge, submitError, onJump }) {
  const rows = items.map((item, i) => ({ item, i, status: statusOf(item, responses, marked) }));
  const groups = [
    {
      key: "unanswered",
      title: "Not answered",
      tone: "text-slate-800",
      rows: rows.filter((r) => !isAnswered(r.item, responses[r.item.itemId])),
      empty: "Nothing left unanswered.",
    },
    {
      key: "marked",
      title: "Marked for review",
      tone: "text-amber-800",
      rows: rows.filter((r) => marked[r.item.itemId]),
      empty: "You didn't flag anything to come back to.",
    },
    {
      key: "answered",
      title: "Answered",
      tone: "text-emerald-800",
      rows: rows.filter((r) => isAnswered(r.item, responses[r.item.itemId]) && !marked[r.item.itemId]),
      empty: "No answers recorded yet.",
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Review before you submit</h2>
      <p className="mt-2 text-sm text-slate-500">
        Submitting locks <span className="font-medium text-slate-700">{sectionTitle}</span> — you won't be able to change these
        answers. Anything below is one tap away.
      </p>

      {/* The consequence comes BEFORE the detail. A tick-box buried under a
          twelve-row list leaves a disabled Submit button with its reason
          off-screen, which is the dead end this whole view exists to remove. */}
      {counts.unanswered > 0 ? (
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600"
          />
          <span className="text-sm text-amber-900">
            I'm submitting with <strong>{counts.unanswered}</strong> question{counts.unanswered === 1 ? "" : "s"} unanswered.
            Unanswered questions score zero.
          </span>
        </label>
      ) : (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          Every question in this section has an answer.
        </p>
      )}

      {submitError && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {submitError}
        </p>
      )}

      <div className="mt-6 space-y-5">
        {groups.map((group) => (
          <section key={group.key}>
            <h3 className={`text-sm font-semibold ${group.tone}`}>
              {group.title} <span className="font-normal text-slate-400">({group.rows.length})</span>
            </h3>
            {group.rows.length === 0 ? (
              <p className="mt-1.5 text-xs text-slate-400">{group.empty}</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {group.rows.map(({ item, i, status }) => (
                  <li key={item.itemId}>
                    <button
                      type="button"
                      onClick={() => onJump(i)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums ring-1 ring-inset ${STATUS_STYLE[status].chip}`}
                      >
                        {i + 1}
                      </span>
                      <span className="line-clamp-2 min-w-0 flex-1 text-sm text-slate-700">{item.stem}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                      <span className="sr-only">Go to question {i + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

    </div>
  );
}

/* -------------------------------------------------------------------- Palette */

const LEGEND_KEYS = ["current", "answered", "marked", "seen", "unanswered"];

function Palette({ items, responses, marked, visited, index, counts, view, onJump, onJumpStatus, onReview }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* The counters double as jumps. Reading "3 left" and having no way to act on
          it is exactly what made the old panel a dead end. */}
      <div className="grid grid-cols-3 gap-1.5">
        <CountJump value={counts.answered} label="answered" tone="emerald" onClick={() => onJumpStatus("answered")} />
        <CountJump value={counts.unanswered} label="left" tone="ink" onClick={() => onJumpStatus("unanswered")} />
        <CountJump value={counts.marked} label="marked" tone="amber" onClick={() => onJumpStatus("marked")} />
      </div>

      <div>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Jump to a question">
          {items.map((item, i) => {
            const live = i === index && view === "question";
            const base = live ? "current" : statusOf(item, responses, marked);
            const status = base === "unanswered" && visited[item.itemId] ? "seen" : base;
            return (
              <button
                key={item.itemId}
                type="button"
                onClick={() => onJump(i)}
                aria-current={live ? "true" : undefined}
                aria-label={`Question ${i + 1}, ${STATUS_STYLE[status].label}`}
                className={`h-11 w-11 rounded-xl text-sm font-bold tabular-nums ring-1 ring-inset transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 active:scale-95 ${STATUS_STYLE[status].chip}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        <ul className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1">
          {LEGEND_KEYS.map((key) => (
            <li key={key} className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded ${STATUS_STYLE[key].dot}`} />
              {STATUS_STYLE[key].label}
            </li>
          ))}
        </ul>
      </div>

      <Button variant="secondary" className="w-full" onClick={onReview}>
        <ListChecks className="h-4 w-4" /> Review &amp; submit
      </Button>
    </div>
  );
}

function CountJump({ value, label, tone, onClick }) {
  const tones = { emerald: "text-emerald-600", amber: "text-amber-600", ink: "text-slate-800" };
  const disabled = value === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={disabled ? `${value} ${label}` : `${value} ${label} — go to the first one`}
      className="rounded-xl border border-slate-200 px-2 py-1.5 text-center transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className={`block text-sm font-bold tabular-nums ${disabled ? "text-slate-300" : tones[tone]}`}>{value}</span>
      <span className="block text-[11px] text-slate-500">{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------- Answer widgets */

// The label a candidate reads is the option's POSITION on their screen, never its
// stored id. Options arrive in a per-candidate shuffled order (assembly seeds
// optionOrder so a leaked answer key — "the answer is C" — is worthless), and the
// ids ride along unchanged because they are the answer tokens the scorer matches.
// Printing the id as the label leaked that shuffle straight into the paper, so
// candidates saw "c) a) d) b)". Position in, id out.
const optionLabel = (i) => String.fromCharCode(65 + i);

function AnswerWidget({ item, value, onChange }) {
  if (item.type === "numeric") {
    return (
      <div>
        <label htmlFor="numeric-answer" className="mb-1.5 block text-sm font-semibold text-slate-700">
          Your answer
        </label>
        <input
          id="numeric-answer"
          type="number"
          step="any"
          inputMode="decimal"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type a number"
          className="w-full max-w-xs rounded-xl border border-slate-300 px-3.5 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
        />
      </div>
    );
  }

  if (item.type === "ordering") {
    const order = Array.isArray(value) && value.length ? value : item.options.map((o) => o.id);
    const textById = new Map(item.options.map((o) => [o.id, o.text]));
    const touched = Array.isArray(value) && value.length > 0;
    const move = (i, dir) => {
      const next = [...order];
      const j = i + dir;
      if (j < 0 || j >= next.length) return;
      [next[i], next[j]] = [next[j], next[i]];
      onChange(next);
    };
    return (
      <div>
        <p className="mb-2 text-sm text-slate-500">Arrange these so the first step is at the top.</p>
        <ol className="space-y-2">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold tabular-nums text-slate-500">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm text-slate-800">{textById.get(id)}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move "${textById.get(id)}" up`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === order.length - 1}
                  aria-label={`Move "${textById.get(id)}" down`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ol>
        {!touched && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-800">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            This counts as unanswered until you move at least one item — even if the order already looks right.
          </p>
        )}
      </div>
    );
  }

  const multi = item.type === "mcq_multi";
  const selected = Array.isArray(value) ? value : [];
  const toggle = (id) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
    else onChange([id]);
  };

  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">{multi ? "Select every option that applies." : "Select one option."}</p>
      <div className="space-y-2">
        {item.options.map((o, i) => {
          const isSelected = selected.includes(o.id);
          return (
            <label
              key={o.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-100 ${
                isSelected
                  ? "border-brand-500 bg-brand-50 text-slate-900 ring-1 ring-inset ring-brand-500"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                name={multi ? undefined : `q-${item.itemId}`}
                checked={isSelected}
                onChange={() => toggle(o.id)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center text-xs font-bold ${multi ? "rounded-lg" : "rounded-full"} ${
                  isSelected ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {isSelected && multi ? <Check className="h-4 w-4" /> : optionLabel(i)}
              </span>
              <span className="min-w-0 flex-1 leading-snug">{o.text}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
