import api from "../api/client.js";
import { getAccountRefreshToken, clearAccountAuth } from "./accountAuth.js";

// User-initiated logout: best-effort server-side revocation of the refresh-token family,
// then clear local session regardless of the request outcome.
export function logoutAccount() {
  const refreshToken = getAccountRefreshToken();
  if (refreshToken) {
    api.post("/auth/logout", { refreshToken }).catch(() => {});
  }
  clearAccountAuth();
}
