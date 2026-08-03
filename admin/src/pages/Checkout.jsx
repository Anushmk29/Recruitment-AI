import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Loader2, ShieldCheck, Clock3 } from "lucide-react";
import api from "../api/client.js";
import { getAdminAuth } from "../auth/adminAuth.js";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import OnboardingSteps from "../components/marketing/OnboardingSteps.jsx";
import { Card } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the payment gateway script"));
    document.body.appendChild(script);
  });
}

export default function Checkout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { planKey, billingCycle, retriedOrder } = location.state || {};
  const [status, setStatus] = useState("creating-order");
  const [error, setError] = useState("");
  const orderRef = useRef(null);

  useEffect(() => {
    if (!getAdminAuth()?.token) {
      navigate("/login", { replace: true });
      return;
    }
    if (retriedOrder) {
      orderRef.current = retriedOrder;
      if (!retriedOrder.razorpayConfigured) {
        setStatus("not-configured");
      } else {
        setStatus("ready");
        launchCheckout(retriedOrder);
      }
      return;
    }

    if (!planKey || !billingCycle) {
      navigate("/pricing", { replace: true });
      return;
    }

    let cancelled = false;

    async function createOrder() {
      try {
        const res = await api.post("/payments/create-order", { planKey, billingCycle });
        if (cancelled) return;
        orderRef.current = res.data;

        if (!res.data.razorpayConfigured) {
          setStatus("not-configured");
          return;
        }

        setStatus("ready");
        await launchCheckout(res.data);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 503) {
          setStatus("not-configured");
        } else {
          setError(err.response?.data?.error || "Could not start checkout");
          setStatus("error");
        }
      }
    }

    createOrder();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function launchCheckout(order) {
    try {
      await loadRazorpayScript();
    } catch (err) {
      setError(err.message);
      setStatus("error");
      return;
    }

    const razorpay = new window.Razorpay({
      key: order.razorpayKeyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: "HireFlow AI",
      description: `${planKey} plan (${billingCycle})`,
      // Razorpay's modal is a third-party iframe, so it cannot read our tokens —
      // this hex has to be kept in step with --color-brand-600 by hand. It is
      // the only hardcoded brand colour left in either app.
      theme: { color: "#6d4fe0" },
      handler: async (response) => {
        try {
          await api.post("/payments/verify", {
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
          navigate("/payment-success");
        } catch (err) {
          navigate("/payment-failed", { state: { paymentId: order.paymentId } });
        }
      },
      modal: {
        ondismiss: () => {
          navigate("/payment-failed", { state: { paymentId: order.paymentId, cancelled: true } });
        },
      },
    });

    razorpay.open();
  }

  return (
    <div className="min-h-screen bg-canvas">
      <MarketingNavbar />
      <div className="mx-auto max-w-md px-5 py-14 sm:px-8">
        <OnboardingSteps current={5} />
        <Card className="text-center">
          {status === "not-configured" && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <Clock3 className="h-6 w-6" />
              </div>
              <h1 className="text-lg font-semibold text-slate-900">Payments Coming Soon</h1>
              <p className="mt-2 text-sm text-slate-500">
                Payments aren't configured on this platform yet. Please contact support, or try again once payments
                are enabled.
              </p>
              <Link to="/pricing" className="mt-5 inline-block text-sm font-semibold text-brand-700 hover:underline">
                Back to pricing
              </Link>
            </>
          )}

          {status === "error" && (
            <>
              <h1 className="text-lg font-semibold text-red-700">Checkout Error</h1>
              <p className="mt-2 text-sm text-slate-500">{error}</p>
              <Link to="/pricing" className="mt-5 inline-block text-sm font-semibold text-brand-700 hover:underline">
                Back to pricing
              </Link>
            </>
          )}

          {(status === "creating-order" || status === "ready") && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <h1 className="text-lg font-semibold text-slate-900">Preparing Checkout…</h1>
              <p className="mt-2 text-sm text-slate-500">Please wait while we set up your secure payment.</p>
              <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" /> Secured by Razorpay
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
