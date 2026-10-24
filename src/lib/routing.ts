export const readProjectPage = (): number => {
  const value = Number(new URLSearchParams(window.location.search).get("page") ?? "1");
  return Number.isInteger(value) && value > 0 ? value : 1;
};

// Selected projects are identified by projectKey(): Pages projects by name, Workers as "worker:<name>".
export const readSelectedProject = (): string | null => {
  const match = window.location.pathname.match(/^\/(projects|workers)\/([^/]+)\/?$/);
  if (!match) return null;
  let name = match[2];
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the raw path segment when it is not valid URI encoding.
  }
  return match[1] === "workers" ? `worker:${name}` : name;
};

export const projectPathForKey = (key: string): string =>
  key.startsWith("worker:") ? `/workers/${encodeURIComponent(key.slice("worker:".length))}` : `/projects/${encodeURIComponent(key)}`;
