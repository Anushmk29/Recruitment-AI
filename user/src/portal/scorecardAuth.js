// Scorecard-portal auth store. A FOURTH identity, with its own storage key — an
// interviewer is not a candidate, not a candidate account, and not an admin, and
// the four must never share a token. Mirrors assessmentAuth deliberately.

const STORAGE_KEY = "scorecardPortalAuth";

export function saveAuth(patch) {
  const current = getAuth() || {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
}

export function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export function authHeader() {
  const auth = getAuth();
  return auth?.jwt ? { Authorization: `Bearer ${auth.jwt}` } : {};
}
