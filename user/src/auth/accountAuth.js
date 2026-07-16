const STORAGE_KEY = "candidateAccountAuth";

export function saveAccountAuth({ token, user, remember = true }) {
  const payload = JSON.stringify({ token, user });
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

export function clearAccountAuth() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("account-auth-changed"));
}

export function accountAuthHeader() {
  const auth = getAccountAuth();
  return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
}
