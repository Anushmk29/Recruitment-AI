import { Check } from "lucide-react";

const STEPS = ["Company", "Admin", "Verify Email", "Subscription", "Payment"];

export default function OnboardingSteps({ current }) {
  return (
    <div className="mx-auto mb-10 flex w-full max-w-2xl items-center">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition ${
                  done
                    ? "bg-brand-600 text-white"
                    : active
                    ? "bg-brand-600 text-white ring-4 ring-brand-100"
                    : "bg-slate-200 text-slate-500"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : step}
              </div>
              <span className={`hidden text-[11px] font-medium sm:block ${active || done ? "text-brand-700" : "text-slate-500"}`}>
                {label}
              </span>
            </div>
            {step < STEPS.length && (
              <div className={`mx-2 h-0.5 flex-1 rounded ${done ? "bg-brand-600" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
