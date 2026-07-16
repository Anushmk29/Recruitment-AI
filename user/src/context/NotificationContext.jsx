import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "../api/client.js";
import { accountAuthHeader } from "../auth/accountAuth.js";
import { useAccountAuth } from "../auth/useAccountAuth.js";
import { connectSocket, disconnectSocket } from "../lib/socket.js";
import { useToast } from "../components/ui/Toast.jsx";

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { token, isAuthenticated } = useAccountAuth();
  const toast = useToast();
  const [unreadCount, setUnreadCount] = useState(0);
  const [recent, setRecent] = useState([]);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await api.get("/notifications/unread-count", { headers: accountAuthHeader() });
      setUnreadCount(res.data.count);
    } catch {
      // ignore
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    try {
      const res = await api.get("/notifications", { headers: accountAuthHeader(), params: { limit: 8 } });
      setRecent(res.data.notifications);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshUnreadCount();
    refreshRecent();
  }, [isAuthenticated, refreshUnreadCount, refreshRecent]);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      disconnectSocket();
      return;
    }

    const socket = connectSocket(token);
    function handleNew(notification) {
      setUnreadCount((c) => c + 1);
      setRecent((list) => [notification, ...list].slice(0, 8));
      toast.info(notification.title);
    }
    socket.on("notification:new", handleNew);

    return () => {
      socket.off("notification:new", handleNew);
    };
  }, [isAuthenticated, token, toast]);

  async function markRead(id) {
    await api.patch(`/notifications/${id}/read`, {}, { headers: accountAuthHeader() });
    setRecent((list) => list.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function markAllRead() {
    await api.patch("/notifications/read-all", {}, { headers: accountAuthHeader() });
    setRecent((list) => list.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }

  return (
    <NotificationContext.Provider
      value={{ unreadCount, recent, markRead, markAllRead, refreshRecent, refreshUnreadCount }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
