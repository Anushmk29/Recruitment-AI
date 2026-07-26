import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Eye, LogOut } from "lucide-react";
import Button from "../ui/Button.jsx";
import { getAuth } from "../../portal/portalAuth.js";

// The full-viewport chrome for the two live portal routes (pre-check, interview). Deliberately
// NOT the marketing AppShell/AppNavbar: those carry Careers/How it Works/My Resumes links that
// are in-app SPA navigations, invisible to beforeunload, and were a real accidental-exit path out
// of a monitored, unrepeatable interview session. This shell replaces that chrome instead of
// patching around it — see the "interview portal shell" surface brief.

function ExitConfirmDialog({ onStay, onLeave }) {
  const dialogRef = useRef(null);
  const stayRef = useRef(null);

  // Focus the safe default action on open, trap Tab within the dialog, close on Escape (treated
  // as "stay" — the safe outcome), and restore focus to whatever triggered the dialog on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    stayRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onStay();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll("button");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onStay]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 px-4 py-8">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-dialog-title"
        aria-describedby="exit-dialog-description"
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-soft"
      >
        <h2 id="exit-dialog-title" className="text-base font-semibold text-slate-900">
          Leave this interview?
        </h2>
        <p id="exit-dialog-description" className="mt-2 text-sm text-slate-600">
          Your answers so far are saved. You can come back and continue before your interview link
          expires, but leaving now ends this monitored session.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button ref={stayRef} variant="outline" size="sm" onClick={onStay}>
            Stay
          </Button>
          <Button variant="danger" size="sm" onClick={onLeave}>
            Leave interview
          </Button>
        </div>
      </div>
    </div>
  );
}

// stage: "setup" (pre-check — nothing at stake yet, exit is immediate) or
//        "live" (interview — exit is guarded by ExitConfirmDialog).
export default function InterviewShell({ stage = "live", children }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const jobTitle = getAuth()?.jobTitle;

  function requestExit() {
    if (stage === "live") setConfirming(true);
    else navigate("/portal/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="truncate text-sm font-semibold text-slate-700">
              {jobTitle ? `Interview · ${jobTitle}` : "AI Interview"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {stage === "live" && (
              <span className="hidden items-center gap-1.5 text-xs font-medium text-slate-500 sm:flex">
                <Eye className="h-3.5 w-3.5" /> Monitored
              </span>
            )}
            <button
              type="button"
              onClick={requestExit}
              className="flex items-center gap-1 rounded px-1 py-1 text-xs font-medium text-slate-500 hover:text-red-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
            >
              <LogOut className="h-3.5 w-3.5" /> Exit
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">{children}</main>

      {confirming && (
        <ExitConfirmDialog onStay={() => setConfirming(false)} onLeave={() => navigate("/portal/dashboard")} />
      )}
    </div>
  );
}
