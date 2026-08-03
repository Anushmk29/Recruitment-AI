import { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { XCircle } from "lucide-react";
import api from "../api/client.js";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import { Card } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

export default function PaymentFailed() {
  const location = useLocation();
  const navigate = useNavigate();
  const { paymentId, cancelled } = location.state || {};
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    if (!paymentId) {
      navigate("/pricing");
      return;
    }
    setRetrying(true);
    setError("");
    try {
      const res = await api.post(`/payments/${paymentId}/retry`);
      navigate("/checkout", { state: { planKey: null, billingCycle: null, retriedOrder: res.data } });
    } catch (err) {
      setError(err.response?.data?.error || "Could not retry payment");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <MarketingNavbar />
      <div className="mx-auto max-w-md px-5 py-20 sm:px-8">
        <Card className="text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
            <XCircle className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">{cancelled ? "Payment Cancelled" : "Payment Failed"}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {cancelled
              ? "You closed the checkout before completing payment."
              : "We couldn't process your payment. You can try again or choose a different plan."}
          </p>
          {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
          <div className="mt-6 flex gap-3">
            <Button variant="outline" as={Link} to="/pricing" className="flex-1">
              Back to Pricing
            </Button>
            <Button onClick={handleRetry} loading={retrying} className="flex-1">
              Retry Payment
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
