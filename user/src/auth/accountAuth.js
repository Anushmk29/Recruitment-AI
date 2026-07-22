const STORAGE_KEY = "candidateAccountAuth";

// Which store currently holds the session (localStorage when "remember me", else
// sessionStorage). Used so a token refresh writes back to the same place.
function activeStore() {
  if (localStorage.getItem(STORAGE_KEY)) return localStorage;
  if (sessionStorage.getItem(STORAGE_KEY)) return sessionStorage;
  return null;
}

export function saveAccountAuth({ token, refreshToken, user, remember = true }) {
  const payload = JSON.stringify({ token, refreshToken, user });
  const store = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  store.setItem(STORAGE_KEY, payload);
  other.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("account-auth-changed"));
}

export function getAccountAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAccountRefreshToken() {
  return getAccountAuth()?.refreshToken || null;
}

// Replace tokens after a silent refresh, writing back to whichever store holds the
// session and preserving the stored user + a non-rotated refresh token.
export function updateAccountTokens({ token, refreshToken }) {
  const store = activeStore();
  const current = getAccountAuth();
  if (!store || !current) return;
  store.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...current, token, refreshToken: refreshToken || current.refreshToken })
  );
  window.dispatchEvent(new Event("account-auth-changed"));
}

export function clearAccountAuth() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("account-auth-changed"));
}

export function accountAuthHeader() {
  const auth = getAccountAuth();
  return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
}
