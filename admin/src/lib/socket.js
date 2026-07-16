import { io } from "socket.io-client";

const SOCKET_URL = (import.meta.env.VITE_API_URL || "http://localhost:9000/api").replace(/\/api\/?$/, "");

let socket = null;

export function connectSocket(token) {
  if (!token) return null;
  if (socket) {
    socket.disconnect();
  }
  socket = io(SOCKET_URL, { auth: { token }, transports: ["websocket", "polling"] });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function getSocket() {
  return socket;
}
