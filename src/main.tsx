import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "@fontsource/lexend/300.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/500.css";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/700.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="Wilson">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

/* Update path for every install (incl. old service workers / iOS Home Screen apps that never reload):
   check version.json (no-store) on open + whenever the app comes back to the foreground; if a newer
   build is live, update the service worker and reload ONCE. */
if (import.meta.env.PROD) {
  const KEY = "wilson_reloaded_for";
  const check = async () => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      const { build } = await r.json();
      if (!build || build === __BUILD_ID__ || sessionStorage.getItem(KEY) === build) return;
      if (document.querySelector("textarea:focus")) return; // don't yank her mid-typing; next foreground will do it
      sessionStorage.setItem(KEY, build);
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update().catch(() => {});
      location.reload();
    } catch { /* offline */ }
  };
  window.addEventListener("load", () => setTimeout(check, 1500));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });
  setInterval(check, 30 * 60 * 1000);
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: "none" })
      .then((reg) => {
        // The page that installed the new service worker isn't isolated yet (Puck can only use 1 core). Reload once
        // per build at startup so it is; if this browser ignores the headers, don't try again for this build.
        try {
          const K = "wilson_coi_try";
          if (navigator.serviceWorker.controller && !window.crossOriginIsolated && localStorage.getItem(K) !== __BUILD_ID__ && performance.now() < 8000 && !document.querySelector("textarea:focus")) {
            localStorage.setItem(K, __BUILD_ID__); location.reload(); return;
          }
        } catch { /* ignore */ }
        // First visit: the service worker takes control a moment after load; reload once then so the page is isolated.
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          try {
            const K = "wilson_coi_try";
            if (!window.crossOriginIsolated && localStorage.getItem(K) !== __BUILD_ID__ && performance.now() < 15000 && !document.querySelector("textarea:focus")) { localStorage.setItem(K, __BUILD_ID__); location.reload(); }
          } catch { /* ignore */ }
        });
        // Quietly pick up new deploys: check on return to the app; the new worker activates itself.
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void reg.update().catch(() => {}); });
      })
      .catch(() => {});
  });
}
