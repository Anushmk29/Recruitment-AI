import { Routes, Route, Outlet, useLocation } from "react-router-dom";
import JobList from "./pages/JobList.jsx";
import JobForm from "./pages/JobForm.jsx";
import CandidateList from "./pages/CandidateList.jsx";
import CandidateDetail from "./pages/CandidateDetail.jsx";
import InterviewReport from "./pages/InterviewReport.jsx";
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
import HiringPipeline from "./pages/dashboard/HiringPipeline.jsx";
import AIInterviews from "./pages/dashboard/AIInterviews.jsx";
import Reports from "./pages/dashboard/Reports.jsx";
import SubscriptionPage from "./pages/dashboard/SubscriptionPage.jsx";
import Notifications from "./pages/dashboard/Notifications.jsx";
import SettingsPage from "./pages/dashboard/SettingsPage.jsx";
import RubricEditor from "./pages/dashboard/RubricEditor.jsx";
import PaperEditor from "./pages/dashboard/PaperEditor.jsx";
import AssessmentTracker from "./pages/dashboard/AssessmentTracker.jsx";
import ScoreExplanation from "./pages/dashboard/ScoreExplanation.jsx";
import ReviewQueue from "./pages/dashboard/ReviewQueue.jsx";
import AuditTrail from "./pages/dashboard/AuditTrail.jsx";
import DashboardShell from "./components/dashboard/DashboardShell.jsx";
import NotFound from "./pages/NotFound.jsx";
import PlatformConsole from "./pages/platform/PlatformConsole.jsx";
import RequireAdmin from "./auth/RequireAdmin.jsx";
import RequirePlatform from "./auth/RequirePlatform.jsx";
import { useAdminAuth } from "./auth/useAdminAuth.js";
import SmoothScroll from "./motion/SmoothScroll.jsx";

// Phase 13 fix: the dashboard shell is now ONE layout route. Previously "/"
// rendered its own <DashboardShell> while "/*" rendered a second one, so
// navigating "/" ⇄ "/jobs" unmounted the whole shell — re-running the company
// data fan-out and reconnecting the socket on every hop. With a single layout
// route the shell (and its providers) mounts once; only the <Outlet/> swaps.
function ShellLayout() {
  const { isAuthenticated } = useAdminAuth();
  const location = useLocation();
  // Unauthenticated visitors landing on the bare domain see the marketing page,
  // not a login redirect. Deeper paths still go through RequireAdmin → /login.
  if (!isAuthenticated && location.pathname === "/") return <Landing />;
  return (
    <RequireAdmin>
      <DashboardShell>
        <Outlet />
      </DashboardShell>
    </RequireAdmin>
  );
}

export default function App() {
  // Smooth scroll is scoped to the marketing surface; "/" only counts as
  // marketing while signed out, since it renders the dashboard otherwise.
  const { isAuthenticated } = useAdminAuth();

  return (
    <>
      <SmoothScroll allowRoot={!isAuthenticated} />
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
      {/* Phase 16 — platform console (superadmin only; a distinct top-level
          route so it never nests inside the tenant dashboard shell). */}
      <Route
        path="/platform"
        element={
          <RequirePlatform>
            <PlatformConsole />
          </RequirePlatform>
        }
      />
      <Route path="/" element={<ShellLayout />}>
        <Route index element={<DashboardHome />} />
        <Route path="jobs" element={<JobList />} />
        <Route path="jobs/new" element={<JobForm />} />
        <Route path="jobs/:id/edit" element={<JobForm />} />
        <Route path="jobs/:id/rubric" element={<RubricEditor />} />
        <Route path="jobs/:id/assessment" element={<PaperEditor />} />
        <Route path="jobs/:id/assessments" element={<AssessmentTracker />} />
        <Route path="jobs/:id/candidates" element={<CandidateList />} />
        <Route path="candidates" element={<CandidatesAll />} />
        <Route path="pipeline" element={<HiringPipeline />} />
        <Route path="candidates/:id" element={<CandidateDetail />} />
        <Route path="candidates/:id/score" element={<ScoreExplanation />} />
        <Route path="candidates/:id/interview-report" element={<InterviewReport />} />
        <Route path="review-queue" element={<ReviewQueue />} />
        <Route path="ai-interviews" element={<AIInterviews />} />
        <Route path="reports" element={<Reports />} />
        <Route path="subscription" element={<SubscriptionPage />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit-trail" element={<AuditTrail />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      </Routes>
    </>
  );
}
