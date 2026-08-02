import { lazy, Suspense } from "react";
import { Routes, Route, Outlet, useLocation } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import DashboardShell from "./components/dashboard/DashboardShell.jsx";
import RequireAdmin from "./auth/RequireAdmin.jsx";
import RequirePlatform from "./auth/RequirePlatform.jsx";
import { useAdminAuth } from "./auth/useAdminAuth.js";
import SmoothScroll from "./motion/SmoothScroll.jsx";

// Every page used to be a static import, so one 863 kB chunk had to arrive
// before anything rendered: a recruiter opening their queue downloaded the
// marketing site, the superadmin console, the rubric and paper editors and the
// interview report first. Only the two entry points stay eager — Landing (the
// signed-out "/") and Login — because a Suspense flash on the first paint of an
// entry point is a worse trade than the extra request. Everything else is
// fetched when its route is actually visited.
const Demo = lazy(() => import("./pages/Demo.jsx"));
const Pricing = lazy(() => import("./pages/Pricing.jsx"));
const RegisterCompany = lazy(() => import("./pages/RegisterCompany.jsx"));
const VerifyCompanyOtp = lazy(() => import("./pages/VerifyCompanyOtp.jsx"));
const Checkout = lazy(() => import("./pages/Checkout.jsx"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess.jsx"));
const PaymentFailed = lazy(() => import("./pages/PaymentFailed.jsx"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword.jsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.jsx"));

const JobList = lazy(() => import("./pages/JobList.jsx"));
const JobForm = lazy(() => import("./pages/JobForm.jsx"));
const CandidateList = lazy(() => import("./pages/CandidateList.jsx"));
const CandidateDetail = lazy(() => import("./pages/CandidateDetail.jsx"));
const InterviewReport = lazy(() => import("./pages/InterviewReport.jsx"));
const NotFound = lazy(() => import("./pages/NotFound.jsx"));

const DashboardHome = lazy(() => import("./pages/dashboard/DashboardHome.jsx"));
const CandidatesAll = lazy(() => import("./pages/dashboard/CandidatesAll.jsx"));
const HiringPipeline = lazy(() => import("./pages/dashboard/HiringPipeline.jsx"));
const AIInterviews = lazy(() => import("./pages/dashboard/AIInterviews.jsx"));
const Reports = lazy(() => import("./pages/dashboard/Reports.jsx"));
const SubscriptionPage = lazy(() => import("./pages/dashboard/SubscriptionPage.jsx"));
const Notifications = lazy(() => import("./pages/dashboard/Notifications.jsx"));
const SettingsPage = lazy(() => import("./pages/dashboard/SettingsPage.jsx"));
const RubricEditor = lazy(() => import("./pages/dashboard/RubricEditor.jsx"));
const PaperEditor = lazy(() => import("./pages/dashboard/PaperEditor.jsx"));
const AssessmentTracker = lazy(() => import("./pages/dashboard/AssessmentTracker.jsx"));
const ScoreExplanation = lazy(() => import("./pages/dashboard/ScoreExplanation.jsx"));
const ReviewQueue = lazy(() => import("./pages/dashboard/ReviewQueue.jsx"));
const AuditTrail = lazy(() => import("./pages/dashboard/AuditTrail.jsx"));

const PlatformConsole = lazy(() => import("./pages/platform/PlatformConsole.jsx"));

// A spinner announces "something is happening"; this announces the shape of
// what is arriving, which is the difference between a wait that feels like a
// stall and one that feels like a page.
function RouteFallback() {
  return (
    <div role="status" aria-label="Loading page" className="mx-auto w-full max-w-5xl px-4 py-10">
      <div aria-hidden="true">
        <div className="h-7 w-56 animate-pulse rounded-lg bg-slate-200" />
        <div className="mt-3 h-4 w-80 animate-pulse rounded bg-slate-200/70" />
        <div className="mt-8 h-64 w-full animate-pulse rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}

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
        {/* Inside the shell, so a route chunk arriving late swaps only the page
            body — the sidebar, header and notification socket stay put. */}
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
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
      <Suspense fallback={<RouteFallback />}>
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
      </Suspense>
    </>
  );
}
