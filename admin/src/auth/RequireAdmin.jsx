import { Navigate, useLocation } from "react-router-dom";
import { useAdminAuth } from "./useAdminAuth.js";

export default function RequireAdmin({ children }) {
  const { isAuthenticated } = useAdminAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
