import type { DeploymentSummary, StatusFilter } from "../../shared/types";

export const statusLabels: Record<StatusFilter, string> = {
  all: "All statuses",
  active: "Active",
  queued: "Queued",
  success: "Successful",
  failure: "Failed",
  canceled: "Canceled",
  unknown: "Unknown",
};

export const formatDate = (value?: string): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

export const formatDuration = (deployment: DeploymentSummary): string => {
  if (!deployment.stageStartedAt) return "—";
  const end = deployment.stageEndedAt ? Date.parse(deployment.stageEndedAt) : Date.now();
  const start = Date.parse(deployment.stageStartedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
};

export const shortCommit = (commit?: string): string => (commit ? commit.slice(0, 8) : "—");
