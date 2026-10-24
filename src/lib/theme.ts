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

// Harborlight switches every color token on the `dark` class of <html>; public/boot.js applies the same class before first paint.
export const applyTheme = (theme: "dark" | "light") => {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", theme === "dark" ? "#010810" : "#ffffff");
};
