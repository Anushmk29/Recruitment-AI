import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import JobListings from "./pages/JobListings.jsx";
import JobDetail from "./pages/JobDetail.jsx";
import ApplyForm from "./pages/ApplyForm.jsx";
import ResumeUpload from "./pages/ResumeUpload.jsx";
import InterviewLogin from "./pages/InterviewLogin.jsx";
import InterviewDashboard from "./pages/InterviewDashboard.jsx";
import PreInterviewCheck from "./pages/PreInterviewCheck.jsx";
import Register from "./pages/Register.jsx";
import Login from "./pages/Login.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import Account from "./pages/Account.jsx";
import CandidateDashboard from "./pages/CandidateDashboard.jsx";
import NotificationCenter from "./pages/NotificationCenter.jsx";
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
              <Route path="/resume" element={<ResumeUpload />} />
              <Route path="/interview/:token" element={<InterviewLogin />} />
              <Route path="/portal/dashboard" element={<InterviewDashboard />} />
              <Route path="/portal/pre-check" element={<PreInterviewCheck />} />
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
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
