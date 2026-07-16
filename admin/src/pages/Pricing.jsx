import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import api from "../api/client.js";
import { getAdminAuth } from "../auth/adminAuth.js";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import OnboardingSteps from "../components/marketing/OnboardingSteps.jsx";
import { Card, Skeleton } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

function formatPrice(amount) {
  if (amount === 0) return "Free";
  return `₹${amount.toLocaleString("en-IN")}`;
}

export default function Pricing() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [error, setError] = useState("");
  const [isOnboarding, setIsOnboarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.get("/subscriptions/plans");
        if (!cancelled) setPlans(res.data);
      } catch (err) {
        if (!cancelled) setError("Could not load subscription plans");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    if (getAdminAuth()?.token) {
      api
        .get("/auth/me")
        .then((res) => {
          if (!cancelled) setIsOnboarding(res.data.company?.status !== "active");
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, []);

  function choosePlan(planKey) {
    navigate("/checkout", { state: { planKey, billingCycle } });
  }

  return (
    <div className="min-h-screen bg-white">
      <MarketingNavbar />
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        {isOnboarding && <OnboardingSteps current={4} />}

        <div className="mx-auto max-w-xl text-center">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Choose Your Plan</h1>
          <p className="mt-3 text-slate-600">Every plan includes AI resume screening, ATS scoring, and AI interviews.</p>
        </div>

        {error && <p className="mt-6 text-center text-sm font-medium text-red-600">{error}</p>}

        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1">
            {["monthly", "yearly"].map((cycle) => (
              <button
                key={cycle}
                type="button"
                onClick={() => setBillingCycle(cycle)}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
                  billingCycle === cycle ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"
                }`}
              >
                {cycle === "monthly" ? "Monthly" : "Yearly · save more"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {loading &&
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="space-y-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-9 w-full" />
              </Card>
            ))}

          {plans.map((plan, i) => {
            const popular = plan.key === "professional";
            return (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card
                  className={`relative flex h-full flex-col ${popular ? "border-brand-400 ring-2 ring-brand-100" : ""}`}
                >
                  {popular && (
                    <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-brand-600 px-3 py-1 text-[11px] font-bold text-white">
                      <Sparkles className="h-3 w-3" /> Most Popular
                    </span>
                  )}
                  <h3 className="text-base font-semibold text-slate-900">{plan.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">{plan.description}</p>
                  <div className="mt-5 text-3xl font-extrabold text-slate-900">
                    {formatPrice(plan.pricing[billingCycle])}
                    {plan.pricing[billingCycle] > 0 && (
                      <span className="text-sm font-medium text-slate-400"> / {billingCycle === "monthly" ? "mo" : "yr"}</span>
                    )}
                  </div>
                  <ul className="mt-5 flex-1 space-y-2.5 text-sm text-slate-600">
                    {[
                      `${plan.limits.maxJobs.toLocaleString()} active jobs`,
                      `${plan.limits.maxRecruiters.toLocaleString()} recruiter seats`,
                      `${plan.limits.maxAiInterviews.toLocaleString()} AI interviews / mo`,
                      `${plan.limits.maxResumeParsing.toLocaleString()} resume parses / mo`,
                      `${(plan.limits.storageLimitMb / 1000).toFixed(1)} GB storage`,
                    ].map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {line}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={popular ? "primary" : "secondary"}
                    className="mt-6 w-full"
                    onClick={() => choosePlan(plan.key)}
                  >
                    Choose {plan.name}
                  </Button>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
