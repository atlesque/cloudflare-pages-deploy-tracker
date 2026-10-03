import { statusLabels } from "../lib/format";
import type { StatusFilter } from "../../shared/types";

export function StatusBadge({ status }: { status: string }) { return <span className={`status-badge status-${status}`}><span className="status-dot" />{statusLabels[status as StatusFilter] ?? "Unknown"}</span>; }
