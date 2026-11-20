/**
 * Keep Wilson's shell inside the visual viewport so the iPhone keyboard
 * cannot cover the chat input. iOS (especially a full-screen Home Screen
 * PWA) leaves the layout viewport tall when the keyboard opens; only
 * window.visualViewport shrinks. We publish CSS vars and pin #root and
 * other full-screen shells to that visible rectangle.
 */

export type ViewportMetrics = {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft?: number;
};

export type LayoutMetrics = {
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
};

export type ViewportCssVars = {
  appHeight: string;
  vvTop: string;
  kbInset: string;
  keyboardOpen: boolean;
};

/** Inset larger than a URL-bar tuck is treated as a keyboard. */
const KEYBOARD_OPEN_PX = 80;

function px(n: number): string {
  return `${Math.round(n * 1000) / 1000}px`;
}

export function computeViewportVars(
  layout: LayoutMetrics,
  visual: ViewportMetrics | null | undefined,
): ViewportCssVars {
  const height = visual?.height ?? layout.innerHeight;
  const offsetTop = visual?.offsetTop ?? 0;
  const kb = Math.max(0, layout.innerHeight - height - offsetTop);
  return {
    appHeight: px(height),
    vvTop: px(offsetTop),
    kbInset: px(kb),
    keyboardOpen: kb >= KEYBOARD_OPEN_PX,
  };
}

export function applyViewportVars(root: HTMLElement, vars: ViewportCssVars): void {
  root.style.setProperty("--app-height", vars.appHeight);
  root.style.setProperty("--vv-top", vars.vvTop);
  root.style.setProperty("--kb-inset", vars.kbInset);
  root.classList.toggle("kb-open", vars.keyboardOpen);
}

export function readLiveViewport(): { layout: LayoutMetrics; visual: ViewportMetrics | null } {
  const vv = window.visualViewport;
  return {
    layout: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    visual: vv
      ? { width: vv.width, height: vv.height, offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft }
      : null,
  };
}

function sync(): void {
  const { layout, visual } = readLiveViewport();
  applyViewportVars(document.documentElement, computeViewportVars(layout, visual));
  // Prevent iOS from jumping the layout viewport when the keyboard opens.
  if (layout.scrollX || layout.scrollY) window.scrollTo(0, 0);
}

function findChatScroller(target: HTMLElement): HTMLElement | null {
  const root = target.closest("[data-chat-root], .wa, .wterm, .womni, .wjobs, .obs-root");
  const scoped = (root ?? document).querySelector("[data-chat-scroller]");
  if (scoped instanceof HTMLElement) return scoped;
  if (root instanceof HTMLElement && root.classList.contains("wa")) return root;
  return null;
}

function pinFocusedInput(): void {
  sync();
  const t = document.activeElement;
  if (!(t instanceof HTMLElement)) return;
  if (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT") return;
  if (t instanceof HTMLInputElement && /^(button|checkbox|radio|file|submit|reset|hidden|range|color|image)$/i.test(t.type)) return;

  const scroller = findChatScroller(t);
  if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
    scroller.scrollTop = scroller.scrollHeight;
  }
  try {
    t.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {
    /* ignore */
  }
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
}

let started = false;
const focusTimers: number[] = [];

function clearFocusTimers(): void {
  while (focusTimers.length) window.clearTimeout(focusTimers.pop());
}

export function startVisualViewportSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  sync();
  const onSync = () => sync();
  window.addEventListener("resize", onSync);
  window.addEventListener("orientationchange", onSync);
  window.visualViewport?.addEventListener("resize", onSync);
  window.visualViewport?.addEventListener("scroll", onSync);

  document.addEventListener("focusin", () => {
    clearFocusTimers();
    pinFocusedInput();
    requestAnimationFrame(pinFocusedInput);
    for (const ms of [80, 300, 500]) {
      focusTimers.push(window.setTimeout(pinFocusedInput, ms));
    }
  });
  document.addEventListener("focusout", () => {
    clearFocusTimers();
    // Keyboard close animation lags behind blur on iOS.
    focusTimers.push(window.setTimeout(sync, 300));
  });
}
