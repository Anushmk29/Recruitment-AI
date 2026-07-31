// Assessment-portal auth store (ASSESSMENT-ENGINE-PLAN A2.4). Its own storage
// key — the interview portal, candidate account, and assessment portal are three
// separate identities and never share tokens.

const STORAGE_KEY = "assessmentPortalAuth";

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
