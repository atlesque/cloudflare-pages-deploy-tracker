// Runs before first paint: applies the saved Auto/Dark/Light choice (default: auto) so Harborlight's dark tokens never flash.
(() => {
  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: dark)");
  let mode = "auto";
  try { mode = localStorage.getItem("pages-deploy-tracker-theme") ?? "auto"; } catch { /* storage blocked */ }
  const dark = mode === "dark" || (mode !== "light" && media.matches);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
