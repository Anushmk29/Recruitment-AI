import { Link } from "react-router-dom";
import { CreditCard, ArrowUpRight } from "lucide-react";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";

function formatPrice(amount) {
  if (!amount) return "Free";
  return `₹${amount.toLocaleString("en-IN")}`;
}

export default function SubscriptionPage() {
  const { subscription, loading } = useCompanyData();
  const plan = subscription?.plan;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Subscription</h1>
        <p className="mt-1 text-sm text-slate-500">Your current plan and usage limits.</p>
      </div>

      {loading ? (
        <Card><Skeleton className="h-40 w-full" /></Card>
      ) : !subscription ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="No active subscription"
            description="Choose a plan to unlock jobs, AI interviews, and resume parsing."
            action={
              <Button as={Link} to="/pricing">
                View Plans <ArrowUpRight className="h-4 w-4" />
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{plan?.name}</h2>
                  <Badge tone={subscription.status === "active" ? "green" : "amber"}>{subscription.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Billed {subscription.billingCycle} · {formatPrice(plan?.pricing?.[subscription.billingCycle])}
                  {plan?.pricing?.[subscription.billingCycle] > 0 && (subscription.billingCycle === "monthly" ? " /mo" : " /yr")}
                </p>
                {subscription.currentPeriodEnd && (
                  <p className="mt-1 text-xs text-slate-500">
                    Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  </p>
                )}
              </div>
              <Button as={Link} to="/pricing" variant="secondary">
                Change Plan
              </Button>
            </div>
          </Card>

          {plan?.limits && (
            <Card>
              <h2 className="mb-4 text-base font-semibold text-slate-900">Plan Limits</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ["Active Jobs", plan.limits.maxJobs],
                  ["Recruiter Seats", plan.limits.maxRecruiters],
                  ["AI Interviews / mo", plan.limits.maxAiInterviews],
                  ["Resume Parses / mo", plan.limits.maxResumeParsing],
                  ["Storage", `${(plan.limits.storageLimitMb / 1000).toFixed(1)} GB`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{value?.toLocaleString?.() ?? value}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
