export type ThemeMode = "auto" | "dark" | "light";
export const THEME_STORAGE_KEY = "pages-deploy-tracker-theme";

export const readThemeMode = (): ThemeMode => {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "dark" || saved === "light" || saved === "auto" ? saved : "auto";
  } catch {
    return "auto";
  }
};

export const readSystemTheme = (): "dark" | "light" => {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
};

export const nextThemeMode: Record<ThemeMode, ThemeMode> = { auto: "dark", dark: "light", light: "auto" };
export const themeIcon: Record<ThemeMode, string> = { auto: "◐", dark: "☾", light: "☀" };
