import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { PartyPopper, Loader2, Clock3 } from "lucide-react";
import api from "../api/client.js";
import { getAdminAuth } from "../auth/adminAuth.js";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import { Card } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

const ACTIVE_STATES = new Set(["active", "trialing"]);
const POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2000;

// Phase 13 fix: this page used to claim "Your workspace has been activated"
// without making a single API call — if verification or provisioning had
// failed, the user was told a lie. Now it polls the subscription and only
// says "activated" when the subscription actually is.
export default function PaymentSuccess() {
  const [state, setState] = useState("checking"); // checking | active | pending | unauthenticated
  const cancelledRef = useRef(false);

  async function poll() {
    setState("checking");
    for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
      try {
        const res = await api.get("/subscriptions/me");
        if (cancelledRef.current) return;
        if (ACTIVE_STATES.has(res.data?.status)) {
          setState("active");
          return;
        }
      } catch {
        // 404 = webhook/provisioning hasn't landed yet — keep polling.
      }
      if (cancelledRef.current) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!cancelledRef.current) setState("pending");
  }

  useEffect(() => {
    if (!getAdminAuth()?.token) {
      setState("unauthenticated");
      return undefined;
    }
    cancelledRef.current = false;
    poll();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-canvas">
      <MarketingNavbar />
      <div className="mx-auto max-w-md px-5 py-20 sm:px-8">
        <Card className="text-center">
          {state === "checking" && (
            <>
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Payment Received</h1>
              <p className="mt-2 text-sm text-slate-500">Activating your workspace — this usually takes a few seconds…</p>
            </>
          )}

          {state === "active" && (
            <>
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 14 }}
                className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
              >
                <PartyPopper className="h-8 w-8" />
              </motion.div>
              <h1 className="text-xl font-bold text-slate-900">Workspace Activated</h1>
              <p className="mt-2 text-sm text-slate-500">
                Your subscription is confirmed and your workspace is live. You can start posting jobs right away.
              </p>
              <Button as={Link} to="/" size="lg" className="mt-6 w-full">
                Go to Dashboard
              </Button>
            </>
          )}

          {state === "pending" && (
            <>
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <Clock3 className="h-8 w-8" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Payment Received — Activation Pending</h1>
              <p className="mt-2 text-sm text-slate-500">
                We've recorded your payment, but your workspace isn't active yet. This can take a minute while the
                payment provider confirms. If it stays pending, contact support — your payment is safe.
              </p>
              <Button size="lg" variant="outline" className="mt-6 w-full" onClick={poll}>
                Check Again
              </Button>
            </>
          )}

          {state === "unauthenticated" && (
            <>
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <PartyPopper className="h-8 w-8" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Payment Received</h1>
              <p className="mt-2 text-sm text-slate-500">Log in to check your workspace activation status.</p>
              <Button as={Link} to="/login" size="lg" className="mt-6 w-full">
                Go to Login
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
