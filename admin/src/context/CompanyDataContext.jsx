import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../api/client.js";

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
      const [meRes, jobsRes, queueRes] = await Promise.all([
        api.get("/auth/me"),
        api.get("/jobs"),
        api.get("/interview-queue"),
      ]);
      setMe(meRes.data);
      setJobs(jobsRes.data);
      setQueue(queueRes.data);

      const candidateLists = await Promise.all(
        jobsRes.data.map((job) =>
          api
            .get(`/jobs/${job._id}/candidates`)
            .then((res) => [job._id, res.data])
            .catch(() => [job._id, []])
        )
      );
      setCandidatesByJob(Object.fromEntries(candidateLists));

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
