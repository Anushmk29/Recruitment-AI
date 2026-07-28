import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../api/client.js";
import { getSocket } from "../lib/socket.js";

const CompanyDataContext = createContext(null);

export function CompanyDataProvider({ children }) {
  const [me, setMe] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [candidatesByJob, setCandidatesByJob] = useState({});
  const [queue, setQueue] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Phase 12.5: ONE paginated company-wide request replaces the old
      // one-request-per-job fan-out (a 40-job tenant fired 40 requests here).
      const [meRes, jobsRes, queueRes, candidatesRes] = await Promise.all([
        api.get("/auth/me"),
        api.get("/jobs"),
        api.get("/interview-queue"),
        api.get("/candidates", { params: { limit: 500 } }).catch(() => ({ data: { items: [] } })),
      ]);
      setMe(meRes.data);
      setJobs(jobsRes.data);
      setQueue(queueRes.data);

      const grouped = {};
      for (const job of jobsRes.data) grouped[job._id] = [];
      for (const c of candidatesRes.data.items || []) {
        const jobId = c.job?._id || c.job;
        if (!grouped[jobId]) grouped[jobId] = [];
        grouped[jobId].push(c);
      }
      setCandidatesByJob(grouped);

      try {
        const subRes = await api.get("/subscriptions/me");
        setSubscription(subRes.data);
      } catch {
        setSubscription(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live-sync: any candidate stage change (from the profile page, the Hiring
  // Pipeline board, or a review-queue resolution) broadcasts "candidate:stage".
  // Refetching here keeps `queue` (AI Interviews) and `allCandidates` (Hiring
  // Pipeline) current for every consumer without each page wiring its own
  // listener.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStage = () => load();
    socket.on("candidate:stage", onStage);
    return () => socket.off("candidate:stage", onStage);
  }, [load]);

  const allCandidates = useMemo(() => {
    return Object.entries(candidatesByJob).flatMap(([jobId, list]) => {
      const job = jobs.find((j) => j._id === jobId);
      return list.map((c) => ({ ...c, job: c.job || job }));
    });
  }, [candidatesByJob, jobs]);

  const value = useMemo(
    () => ({ me, jobs, candidatesByJob, allCandidates, queue, subscription, loading, refresh: load }),
    [me, jobs, candidatesByJob, allCandidates, queue, subscription, loading, load]
  );

  return <CompanyDataContext.Provider value={value}>{children}</CompanyDataContext.Provider>;
}

export function useCompanyData() {
  const ctx = useContext(CompanyDataContext);
  if (!ctx) throw new Error("useCompanyData must be used within CompanyDataProvider");
  return ctx;
}
