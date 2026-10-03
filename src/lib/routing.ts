export const readProjectPage = (): number => {
  const value = Number(new URLSearchParams(window.location.search).get("page") ?? "1");
  return Number.isInteger(value) && value > 0 ? value : 1;
};

export const readSelectedProject = (): string | null => {
  const match = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};
