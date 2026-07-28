import api from "../api/client.js";

// Bearer-authenticated file download. A plain <a href> to a protected API
// endpoint carries no Authorization header, so it always 401s in a new tab —
// fetch through the axios client (which injects the token) as a blob and
// trigger a save. The blob keeps the response's Content-Type.
export async function downloadFile(path, filename) {
  const res = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
