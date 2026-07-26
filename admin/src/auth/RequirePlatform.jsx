import { Navigate, useLocation } from "react-router-dom";
import { useAdminAuth } from "./useAdminAuth.js";

// Phase 16.5 — platform console gate: superadmin only. Company admins are
// bounced to their own dashboard (and the server 403s them anyway).
export default function RequirePlatform({ children }) {
  const { isAuthenticated, user } = useAdminAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (user?.role !== "superadmin") {
    return <Navigate to="/" replace />;
  }
  return children;
}
