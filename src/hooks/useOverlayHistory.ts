import { useEffect, useRef } from "react";

const STATE_KEY = "wilsonView";

/**
 * While a fullscreen overlay is open, push a history entry so iOS swipe-back
 * and the browser back button close it instead of leaving the PWA. Also locks
 * background scroll and restores it on exit. If the overlay is closed from a
 * button, the extra history entry is popped so the stack stays clean.
 */
export function useOverlayHistory(onClose: () => void, view: string) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let popped = false;
    try { history.pushState({ [STATE_KEY]: view }, ""); } catch { /* ignore */ }

    const prev = {
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
      htmlOverscroll: document.documentElement.style.overscrollBehavior,
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.documentElement.classList.add("wilson-overlay-open");

    const onPop = () => { popped = true; closeRef.current(); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prev.bodyOverflow;
      document.documentElement.style.overflow = prev.htmlOverflow;
      document.documentElement.style.overscrollBehavior = prev.htmlOverscroll;
      document.documentElement.classList.remove("wilson-overlay-open");
      if (!popped && history.state && history.state[STATE_KEY] === view) {
        try { history.back(); } catch { /* ignore */ }
      }
    };
  }, [view]);
}
