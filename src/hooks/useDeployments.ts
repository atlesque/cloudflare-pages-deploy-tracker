import { useCallback, useEffect, useRef, useState } from "react";
import { getDeployments, mergeProjectData, type LoadState } from "../lib/api";

interface UseDeploymentsOptions {
  page: number;
  selectedProjectName: string | null;
  isPaused: boolean;
  intervalMs: number;
}

export function useDeployments({ page, selectedProjectName, isPaused, intervalMs }: UseDeploymentsOptions) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [failureCount, setFailureCount] = useState(0);
  const inFlight = useRef(false);
  const backgroundInFlight = useRef(false);
  const mounted = useRef(true);
  const abortController = useRef<AbortController | null>(null);
  const backgroundAbortController = useRef<AbortController | null>(null);
  const loadStateRef = useRef(loadState);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  loadStateRef.current = loadState;

  const refresh = useCallback(async (requestedPage = page) => {
    if (inFlight.current) return;
    inFlight.current = true;
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setLoadState((current) => ({ status: "loading", previous: current.status === "success" ? current.data : current.previous }));
    try {
      const data = await getDeployments(controller.signal, requestedPage);
      if (!mounted.current) return;
      setFailureCount(0);
      setLoadState({ status: "success", data });
    } catch (error) {
      if (!mounted.current || (error instanceof Error && error.name === "AbortError")) return;
      const current = loadStateRef.current;
      const previous = current.status === "success" ? current.data : current.previous;
      console.error("[pages-deploy-tracker] browser_request_error", JSON.stringify({ endpoint: `/api/deployments?page=${requestedPage}`, method: "GET", page: requestedPage, error: error instanceof Error ? error.message : String(error) }));
      setFailureCount((count) => count + 1);
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "The deployment service could not be reached.", previous });
    } finally {
      inFlight.current = false;
      if (abortController.current === controller) abortController.current = null;
    }
  }, [page]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      abortController.current?.abort();
    };
  }, [refresh]);

  const hasData = loadState.status === "success" || Boolean(loadState.status === "error" && loadState.previous);
  useEffect(() => {
    if (!selectedProjectName || isPaused || !hasData || loadState.status === "loading") return;
    const delay = Math.min(intervalMs * 2 ** Math.min(failureCount, 3), 120_000);
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [failureCount, hasData, intervalMs, isPaused, loadState.status, refresh, selectedProjectName]);

  const data = loadState.status === "success" ? loadState.data : loadState.status === "error" ? loadState.previous : loadState.status === "loading" ? loadState.previous : undefined;

  const backgroundRefresh = useCallback(async (requestedPage = page) => {
    if (backgroundInFlight.current || !mounted.current) return;
    backgroundInFlight.current = true;
    const controller = new AbortController();
    backgroundAbortController.current = controller;
    setIsBackgroundRefreshing(true);
    try {
      const refreshedData = await getDeployments(controller.signal, requestedPage);
      if (!mounted.current || controller.signal.aborted) return;
      const current = loadStateRef.current;
      const previous = current.status === "success" ? current.data : current.previous;
      const mergedData = previous ? mergeProjectData(previous, refreshedData) : refreshedData;
      setFailureCount(0);
      setLoadState({ status: "success", data: mergedData });
    } catch (error) {
      if (!mounted.current || (error instanceof Error && error.name === "AbortError")) return;
      const current = loadStateRef.current;
      const previous = current.status === "success" ? current.data : current.previous;
      console.error("[pages-deploy-tracker] browser_background_refresh_error", JSON.stringify({ endpoint: `/api/deployments?page=${requestedPage}`, method: "GET", page: requestedPage, error: error instanceof Error ? error.message : String(error) }));
      setFailureCount((count) => count + 1);
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "The deployment service could not be reached.", previous });
    } finally {
      backgroundInFlight.current = false;
      if (backgroundAbortController.current === controller) backgroundAbortController.current = null;
      if (mounted.current) setIsBackgroundRefreshing(false);
    }
  }, [page]);

  useEffect(() => {
    if (selectedProjectName || !data || loadState.status === "loading") return;
    const timer = window.setTimeout(() => void backgroundRefresh(), 10_000);
    return () => {
      window.clearTimeout(timer);
      backgroundAbortController.current?.abort();
    };
  }, [backgroundRefresh, data, loadState.status, page, selectedProjectName]);

  return { loadState, setLoadState, failureCount, isBackgroundRefreshing, data, refresh };
}
