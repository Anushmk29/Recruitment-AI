const STORAGE_KEY = "adminAuth";

// Persist the admin session. `refreshToken` is optional — the onboarding OTP flow issues
// a short-lived access token with no refresh token; the normal login/verify flows include
// one so the session can be silently renewed (see api/client.js).
export function saveAdminAuth({ token, refreshToken, user }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, refreshToken, user }));
  window.dispatchEvent(new Event("admin-auth-changed"));
}

export function getAdminAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function getAdminRefreshToken() {
  return getAdminAuth()?.refreshToken || null;
}

// Replace the tokens after a silent refresh while preserving the stored user. If the
// backend rotated the refresh token, persist the new one; otherwise keep the existing one.
export function updateAdminTokens({ token, refreshToken }) {
  const current = getAdminAuth();
  if (!current) return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...current, token, refreshToken: refreshToken || current.refreshToken })
  );
  window.dispatchEvent(new Event("admin-auth-changed"));
}

export function clearAdminAuth() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("admin-auth-changed"));
}
