import { Routes, Route } from "react-router-dom";
import JobList from "./pages/JobList.jsx";
import JobForm from "./pages/JobForm.jsx";
import CandidateList from "./pages/CandidateList.jsx";
import CandidateDetail from "./pages/CandidateDetail.jsx";
import Login from "./pages/Login.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import Landing from "./pages/Landing.jsx";
import Demo from "./pages/Demo.jsx";
import RegisterCompany from "./pages/RegisterCompany.jsx";
import VerifyCompanyOtp from "./pages/VerifyCompanyOtp.jsx";
import Pricing from "./pages/Pricing.jsx";
import Checkout from "./pages/Checkout.jsx";
import PaymentSuccess from "./pages/PaymentSuccess.jsx";
import PaymentFailed from "./pages/PaymentFailed.jsx";
import DashboardHome from "./pages/dashboard/DashboardHome.jsx";
import CandidatesAll from "./pages/dashboard/CandidatesAll.jsx";
import AIInterviews from "./pages/dashboard/AIInterviews.jsx";
import Reports from "./pages/dashboard/Reports.jsx";
import SubscriptionPage from "./pages/dashboard/SubscriptionPage.jsx";
import Notifications from "./pages/dashboard/Notifications.jsx";
import SettingsPage from "./pages/dashboard/SettingsPage.jsx";
import DashboardShell from "./components/dashboard/DashboardShell.jsx";
import RequireAdmin from "./auth/RequireAdmin.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/welcome" element={<Landing />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/register-company" element={<RegisterCompany />} />
      <Route path="/verify-otp" element={<VerifyCompanyOtp />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/payment-success" element={<PaymentSuccess />} />
      <Route path="/payment-failed" element={<PaymentFailed />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route
        path="/*"
        element={
          <RequireAdmin>
            <DashboardShell>
              <Routes>
                <Route path="/" element={<DashboardHome />} />
                <Route path="/jobs" element={<JobList />} />
                <Route path="/jobs/new" element={<JobForm />} />
                <Route path="/jobs/:id/edit" element={<JobForm />} />
                <Route path="/jobs/:id/candidates" element={<CandidateList />} />
                <Route path="/candidates" element={<CandidatesAll />} />
                <Route path="/candidates/:id" element={<CandidateDetail />} />
                <Route path="/ai-interviews" element={<AIInterviews />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/subscription" element={<SubscriptionPage />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </DashboardShell>
          </RequireAdmin>
        }
      />
    </Routes>
  );
}
