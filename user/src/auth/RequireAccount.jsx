import { Navigate, useLocation } from "react-router-dom";
import { useAccountAuth } from "./useAccountAuth.js";
import { setReturnTo } from "./returnTo.js";

export default function RequireAccount({ children }) {
  const { isAuthenticated } = useAccountAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    setReturnTo(location.pathname);
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
