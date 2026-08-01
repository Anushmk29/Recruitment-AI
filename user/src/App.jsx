import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import JobListings from "./pages/JobListings.jsx";
import JobDetail from "./pages/JobDetail.jsx";
import ApplyForm from "./pages/ApplyForm.jsx";
import ResumeUpload from "./pages/ResumeUpload.jsx";
import InterviewLogin from "./pages/InterviewLogin.jsx";
import InterviewDashboard from "./pages/InterviewDashboard.jsx";
import PreInterviewCheck from "./pages/PreInterviewCheck.jsx";
import InterviewRoom from "./pages/InterviewRoom.jsx";
import PhoneCam from "./pages/PhoneCam.jsx";
import AssessmentLogin from "./pages/AssessmentLogin.jsx";
import AssessmentHub from "./pages/AssessmentHub.jsx";
import AssessmentRoom from "./pages/AssessmentRoom.jsx";
import ScorecardLogin from "./pages/ScorecardLogin.jsx";
import ScorecardForm from "./pages/ScorecardForm.jsx";
import Register from "./pages/Register.jsx";
import Login from "./pages/Login.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import Account from "./pages/Account.jsx";
import CandidateDashboard from "./pages/CandidateDashboard.jsx";
import NotificationCenter from "./pages/NotificationCenter.jsx";
import NotFound from "./pages/NotFound.jsx";
import RequireAccount from "./auth/RequireAccount.jsx";
import AppNavbar from "./components/app/AppNavbar.jsx";
import { NotificationProvider } from "./context/NotificationContext.jsx";

function AppShell({ children }) {
  return (
    <NotificationProvider>
      <AppNavbar />
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">{children}</div>
    </NotificationProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/welcome" element={<Landing />} />
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login />} />
      <Route path="/verify-email/:token" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />

      {/* Live portal routes sit outside AppShell/AppNavbar — see InterviewShell.jsx for why the
          marketing navbar is an accidental-exit risk here, not just visual noise. Each page wraps
          itself in InterviewShell directly, since only the page knows its true live/setup stage
          (InterviewRoom's stage changes across a single mount as the interview progresses). */}
      <Route path="/portal/pre-check" element={<PreInterviewCheck />} />
      <Route path="/portal/interview" element={<InterviewRoom />} />
      {/* Assessment shell — the live item screen sits outside AppShell for the
          same accidental-exit reasons as the interview room. */}
      <Route path="/assessment-portal/section/:sectionId" element={<AssessmentRoom />} />
      {/* Phase 14.6 — phone companion camera, opened by scanning the pre-check QR.
          Deliberately outside AppShell: it's a single-purpose kiosk page. */}
      <Route path="/phone-cam/:token" element={<PhoneCam />} />
      {/* Interviewer scorecard (RoundScorecard). Outside AppShell on purpose: the
          person opening this is a hiring manager or external panelist, not a
          candidate — the careers navbar would be confusing chrome, and they have
          no account to navigate to. */}
      <Route path="/scorecard/:token" element={<ScorecardLogin />} />
      <Route path="/scorecard-portal/form" element={<ScorecardForm />} />

      <Route
        path="/*"
        element={
          <AppShell>
            <Routes>
              <Route path="/" element={<JobListings />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route
                path="/jobs/:id/apply"
                element={
                  <RequireAccount>
                    <ApplyForm />
                  </RequireAccount>
                }
              />
              <Route
                path="/resume"
                element={
                  <RequireAccount>
                    <ResumeUpload />
                  </RequireAccount>
                }
              />
              <Route path="/interview/:token" element={<InterviewLogin />} />
              <Route path="/portal/dashboard" element={<InterviewDashboard />} />
              <Route path="/assessment/:token" element={<AssessmentLogin />} />
              <Route path="/assessment-portal/hub" element={<AssessmentHub />} />
              <Route
                path="/account"
                element={
                  <RequireAccount>
                    <Account />
                  </RequireAccount>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAccount>
                    <CandidateDashboard />
                  </RequireAccount>
                }
              />
              <Route
                path="/notifications"
                element={
                  <RequireAccount>
                    <NotificationCenter />
                  </RequireAccount>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
