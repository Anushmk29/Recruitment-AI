import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, AlertTriangle, Clock, Flag, ChevronLeft, ChevronRight, RotateCcw, ArrowUp, ArrowDown } from "lucide-react";
import api from "../api/client.js";
import { authHeader } from "../portal/assessmentAuth.js";
import { Card, Badge } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

// The item screen (ASSESSMENT-ENGINE-PLAN A2.4/A2.5): question palette with the
// NTA-style color legend, live counters, mark-for-review, autosave on every
// change, and a server-authoritative clock (the local countdown is display only
// — the server re-checks remaining time on every save and at submit).

const PALETTE_LEGEND = [
  { key: "current", label: "Current", cls: "bg-brand-600 text-white" },
  { key: "answered", label: "Answered", cls: "bg-emerald-500 text-white" },
  { key: "marked", label: "Marked for review", cls: "bg-amber-400 text-white" },
  { key: "unvisited", label: "Not visited", cls: "bg-slate-200 text-slate-600" },
];

function fmtClock(sec) {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isAnswered(item, response) {
  if (response === null || response === undefined) return false;
  if (item.type === "numeric") return response !== "" && Number.isFinite(Number(response));
  return Array.isArray(response) && response.length > 0;
}

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
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef(null);
  const eventQueue = useRef([]);
  const submittingRef = useRef(false);

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
        document.documentElement.requestFullscreen?.().catch(() => {});
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
  useEffect(() => {
    if (remainingSec === null) return undefined;
    const t = setInterval(() => setRemainingSec((s) => (s === null ? s : s - 1)), 1000);
    return () => clearInterval(t);
  }, [remainingSec !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitSection = useCallback(
    async (auto = false) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setBusy(true);
      try {
        await api.post(`/assessment-portal/sections/${sectionId}/submit`, {}, { headers: authHeader() });
      } catch {
        /* 409/410 = already closed server-side — fine either way */
      }
      navigate("/assessment-portal/hub", { replace: true });
    },
    [sectionId, navigate]
  );

  useEffect(() => {
    if (remainingSec !== null && remainingSec <= 0) submitSection(true);
  }, [remainingSec, submitSection]);

  // --- Integrity events (advisory; server assigns severity) ------------------
  useEffect(() => {
    const push = (type) => eventQueue.current.push({ type });
    const onVis = () => document.visibilityState === "hidden" && push("tab_switch");
    const onBlur = () => push("window_blur");
    const onCopy = () => push("copy");
    const onPaste = () => push("paste");
    const onCtx = () => push("context_menu");
    const onFs = () => !document.fullscreenElement && push("fullscreen_exit");
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
    if (current) setVisited((v) => ({ ...v, [current.itemId]: true }));
  }, [current]);

  // --- Autosave (debounced ~400ms per change) --------------------------------
  const save = useCallback(
    (itemId, response, isMarked) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const payload = {
            itemId,
            response: response === "" || response === undefined ? null : response,
            markedForReview: Boolean(isMarked),
          };
          if (items.find((i) => i.itemId === itemId)?.type === "numeric" && payload.response !== null) {
            payload.response = Number(payload.response);
          }
          const res = await api.post("/assessment-portal/responses", payload, { headers: authHeader() });
          if (Number.isFinite(res.data?.remainingSec)) setRemainingSec(res.data.remainingSec);
        } catch (err) {
          if (err.response?.status === 410) navigate("/assessment-portal/hub", { replace: true });
        }
      }, 400);
    },
    [items, navigate]
  );

  function setResponse(itemId, value) {
    setResponses((r) => ({ ...r, [itemId]: value }));
    save(itemId, value, marked[itemId]);
  }

  function toggleMark() {
    if (!current) return;
    const next = !marked[current.itemId];
    setMarked((m) => ({ ...m, [current.itemId]: next }));
    save(current.itemId, responses[current.itemId] ?? null, next);
  }

  function resetAnswer() {
    if (!current) return;
    setResponse(current.itemId, current.type === "numeric" ? "" : []);
  }

  const counts = useMemo(() => {
    let answered = 0;
    let markedCount = 0;
    for (const item of items) {
      if (isAnswered(item, responses[item.itemId])) answered += 1;
      if (marked[item.itemId]) markedCount += 1;
    }
    return { answered, unanswered: items.length - answered, marked: markedCount };
  }, [items, responses, marked]);

  if (error) {
    return (
      <Card className="m-6 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" />
        <p className="text-sm font-medium text-red-600">{error}</p>
        <Button className="mt-4" onClick={() => navigate("/assessment-portal/hub")}>
          Back to sections
        </Button>
      </Card>
    );
  }
  if (!section || !current) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header: section + live clock */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{section.title}</h1>
          <p className="text-xs text-slate-500">
            Question {index + 1} of {items.length}
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-lg font-bold ${
            remainingSec !== null && remainingSec < 60 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-800"
          }`}
        >
          <Clock className="h-5 w-5" /> {remainingSec === null ? "--:--" : fmtClock(remainingSec)}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* Question card */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <p className="text-base font-medium text-slate-900">{current.stem}</p>
            <Badge tone="slate">{current.type.replace("_", " ")}</Badge>
          </div>

          <div className="mt-5">
            <AnswerWidget item={current} value={responses[current.itemId]} onChange={(v) => setResponse(current.itemId, v)} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="secondary"
              onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
              disabled={index === items.length - 1}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={toggleMark}>
              <Flag className={`h-4 w-4 ${marked[current.itemId] ? "text-amber-500" : ""}`} />
              {marked[current.itemId] ? "Unmark" : "Mark for review"}
            </Button>
            <Button variant="ghost" onClick={resetAnswer}>
              <RotateCcw className="h-4 w-4" /> Clear
            </Button>
          </div>
        </Card>

        {/* Palette */}
        <div className="space-y-3">
          <Card className="!p-4">
            <div className="mb-2 flex justify-between text-xs text-slate-500">
              <span>
                <strong className="text-emerald-600">{counts.answered}</strong> answered
              </span>
              <span>
                <strong className="text-slate-700">{counts.unanswered}</strong> left
              </span>
              <span>
                <strong className="text-amber-600">{counts.marked}</strong> marked
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
              {items.map((item, i) => {
                let cls = "bg-slate-200 text-slate-600";
                if (i === index) cls = "bg-brand-600 text-white";
                else if (marked[item.itemId]) cls = "bg-amber-400 text-white";
                else if (isAnswered(item, responses[item.itemId])) cls = "bg-emerald-500 text-white";
                else if (visited[item.itemId]) cls = "bg-white border border-slate-300 text-slate-600";
                return (
                  <button
                    key={item.itemId}
                    onClick={() => setIndex(i)}
                    className={`h-8 w-8 rounded-lg text-xs font-bold ${cls}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 space-y-1">
              {PALETTE_LEGEND.map((l) => (
                <p key={l.key} className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className={`inline-block h-3 w-3 rounded ${l.cls}`} /> {l.label}
                </p>
              ))}
            </div>
          </Card>

          <Card className="!p-4">
            {!confirmSubmit ? (
              <Button className="w-full" onClick={() => setConfirmSubmit(true)}>
                Submit section
              </Button>
            ) : (
              <div className="space-y-2 text-center">
                <p className="text-xs text-slate-600">
                  {counts.answered} answered · {counts.unanswered} unanswered · {counts.marked} marked. Submitting locks this
                  section.
                </p>
                <Button className="w-full" onClick={() => submitSection(false)} loading={busy}>
                  Yes, submit section
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setConfirmSubmit(false)}>
                  Keep working
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function AnswerWidget({ item, value, onChange }) {
  if (item.type === "numeric") {
    return (
      <input
        type="number"
        step="any"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter your numeric answer"
        className="w-full max-w-xs rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
      />
    );
  }

  if (item.type === "ordering") {
    const order = Array.isArray(value) && value.length ? value : item.options.map((o) => o.id);
    const textById = new Map(item.options.map((o) => [o.id, o.text]));
    const move = (i, dir) => {
      const next = [...order];
      const j = i + dir;
      if (j < 0 || j >= next.length) return;
      [next[i], next[j]] = [next[j], next[i]];
      onChange(next);
    };
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-400">Arrange in the correct order (top = first):</p>
        {order.map((id, i) => (
          <div key={id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <span className="text-xs font-bold text-slate-400">{i + 1}.</span>
            <span className="flex-1 text-sm text-slate-800">{textById.get(id)}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30">
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === order.length - 1}
              className="rounded p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
        ))}
        {(!Array.isArray(value) || !value.length) && (
          <p className="text-[11px] text-amber-600">Use the arrows at least once to record your order.</p>
        )}
      </div>
    );
  }

  const multi = item.type === "mcq_multi";
  const selected = Array.isArray(value) ? value : [];
  const toggle = (id) => {
    if (multi) {
      onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
    } else {
      onChange([id]);
    }
  };
  return (
    <div className="space-y-2">
      {multi && <p className="text-xs text-slate-400">Select all that apply:</p>}
      {item.options.map((o) => (
        <label
          key={o.id}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${
            selected.includes(o.id) ? "border-brand-400 bg-brand-50/60 text-slate-900" : "border-slate-200 text-slate-700 hover:border-slate-300"
          }`}
        >
          <input type={multi ? "checkbox" : "radio"} checked={selected.includes(o.id)} onChange={() => toggle(o.id)} className="mt-0.5" />
          <span>
            <strong className="mr-1.5 uppercase">{o.id})</strong>
            {o.text}
          </span>
        </label>
      ))}
    </div>
  );
}
