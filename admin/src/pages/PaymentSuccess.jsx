import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { PartyPopper } from "lucide-react";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import { Card } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

export default function PaymentSuccess() {
  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingNavbar />
      <div className="mx-auto max-w-md px-5 py-20 sm:px-8">
        <Card className="text-center">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 14 }}
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
          >
            <PartyPopper className="h-8 w-8" />
          </motion.div>
          <h1 className="text-xl font-bold text-slate-900">Payment Successful</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your workspace has been activated. You can now log in and start posting jobs.
          </p>
          <Button as={Link} to="/login" size="lg" className="mt-6 w-full">
            Go to Login
          </Button>
        </Card>
      </div>
    </div>
  );
}
