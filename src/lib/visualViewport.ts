/**
 * Keep Wilson's shell inside the visual viewport so the iPhone keyboard
 * cannot cover the chat input. iOS (especially a full-screen Home Screen
 * PWA) leaves the layout viewport tall when the keyboard opens; only
 * window.visualViewport shrinks. We publish CSS vars and pin #root and
 * other full-screen shells to that visible height.
 *
 * Do not translate the shell by visualViewport.offsetTop. On iOS that
 * value jitters as the browser tries to scroll the focused field into
 * view, and applying it on every scroll event fights the browser and
 * makes the chat box jump while typing. We keep the shell at the top
 * of the layout viewport, size it to the visible height, and cancel
 * document scroll instead.
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
export const KEYBOARD_OPEN_PX = 80;

/** Ignore sub-pixel / 1px visualViewport flicker when publishing CSS vars. */
export const HEIGHT_STABILITY_PX = 1;

function px(n: number): string {
  return `${Math.round(n * 1000) / 1000}px`;
}

export function parsePx(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function computeViewportVars(
  layout: LayoutMetrics,
  visual: ViewportMetrics | null | undefined,
): ViewportCssVars {
  const height = visual?.height ?? layout.innerHeight;
  // offsetTop is deliberately ignored: translating by it causes typing jitter.
  const kb = Math.max(0, layout.innerHeight - height);
  return {
    appHeight: px(height),
    vvTop: "0px",
    kbInset: px(kb),
    keyboardOpen: kb >= KEYBOARD_OPEN_PX,
  };
}

export function shouldApplyViewportVars(
  prev: ViewportCssVars | null | undefined,
  next: ViewportCssVars,
): boolean {
  if (!prev) return true;
  if (prev.keyboardOpen !== next.keyboardOpen) return true;
  if (Math.abs(parsePx(prev.appHeight) - parsePx(next.appHeight)) > HEIGHT_STABILITY_PX) return true;
  if (Math.abs(parsePx(prev.kbInset) - parsePx(next.kbInset)) > HEIGHT_STABILITY_PX) return true;
  return false;
}

export function applyViewportVars(root: HTMLElement, vars: ViewportCssVars): void {
  if (root.style.getPropertyValue("--app-height") !== vars.appHeight) {
    root.style.setProperty("--app-height", vars.appHeight);
  }
  if (root.style.getPropertyValue("--vv-top") !== "0px") {
    root.style.setProperty("--vv-top", "0px");
  }
  if (root.style.getPropertyValue("--kb-inset") !== vars.kbInset) {
    root.style.setProperty("--kb-inset", vars.kbInset);
  }
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

let lastVars: ViewportCssVars | null = null;
let raf = 0;
let pinnedForKeyboard = false;
let started = false;
const focusTimers: number[] = [];

function pinWindow(): void {
  if (!window.scrollX && !window.scrollY) return;
  // html { scroll-behavior: smooth } would animate scrollTo(0, 0) and jitter.
  const html = document.documentElement;
  const prev = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  try {
    window.scrollTo(0, 0);
  } finally {
    html.style.scrollBehavior = prev;
  }
}

function findChatScroller(target: HTMLElement): HTMLElement | null {
  const root = target.closest("[data-chat-root], .wa, .wterm, .womni, .wjobs, .obs-root");
  const scoped = (root ?? document).querySelector("[data-chat-scroller]");
  if (scoped instanceof HTMLElement) return scoped;
  if (root instanceof HTMLElement && root.classList.contains("wa")) return root;
  return null;
}

function isEditableField(t: Element | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT") return false;
  if (t instanceof HTMLInputElement && /^(button|checkbox|radio|file|submit|reset|hidden|range|color|image)$/i.test(t.type)) {
    return false;
  }
  return true;
}

/** Scroll the message list to the end once. Do not call scrollIntoView — iOS would move the visual viewport. */
function pinChatScroller(): void {
  const t = document.activeElement;
  if (!isEditableField(t)) return;
  const scroller = findChatScroller(t);
  if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
    scroller.scrollTop = scroller.scrollHeight;
  }
  pinWindow();
}

function sync(options: { pinScroller?: boolean } = {}): void {
  const { layout, visual } = readLiveViewport();
  const vars = computeViewportVars(layout, visual);
  if (shouldApplyViewportVars(lastVars, vars)) {
    applyViewportVars(document.documentElement, vars);
    lastVars = vars;
  } else if (document.documentElement.style.getPropertyValue("--vv-top") !== "0px") {
    document.documentElement.style.setProperty("--vv-top", "0px");
  }
  pinWindow();

  const keyboardJustOpened = vars.keyboardOpen && !pinnedForKeyboard;
  if (!vars.keyboardOpen) pinnedForKeyboard = false;
  if (options.pinScroller || keyboardJustOpened) {
    pinnedForKeyboard = vars.keyboardOpen;
    pinChatScroller();
  }
}

function scheduleSync(): void {
  if (raf) return;
  raf = window.requestAnimationFrame(() => {
    raf = 0;
    sync();
  });
}

function clearFocusTimers(): void {
  while (focusTimers.length) window.clearTimeout(focusTimers.pop());
}

export function startVisualViewportSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  sync();
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("orientationchange", scheduleSync);
  window.visualViewport?.addEventListener("resize", scheduleSync);
  window.visualViewport?.addEventListener("scroll", scheduleSync);

  document.addEventListener("focusin", () => {
    if (!isEditableField(document.activeElement)) return;
    clearFocusTimers();
    // Pin the message list once on focus. A second pin happens only when
    // the keyboard first opens (see sync). No delayed re-pins while typing.
    sync({ pinScroller: true });
  });
  document.addEventListener("focusout", () => {
    clearFocusTimers();
    pinnedForKeyboard = false;
    // Keyboard close animation lags behind blur on iOS.
    focusTimers.push(window.setTimeout(() => sync(), 300));
  });
}
