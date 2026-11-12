/**
 * Copy plain text to the clipboard. Tries the async Clipboard API first,
 * then an iOS Safari / PWA-safe textarea + execCommand fallback.
 * Returns whether the browser reported a successful copy.
 */
export async function copyText(text: string): Promise<boolean> {
  if (canUseClipboardApi()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* iOS Safari / standalone PWA often rejects writeText; fall through. */
    }
  }
  return copyTextFallback(text);
}

function canUseClipboardApi(): boolean {
  try {
    return typeof navigator !== "undefined" && !!navigator.clipboard?.writeText && !!window.isSecureContext;
  } catch {
    return false;
  }
}

function copyTextFallback(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  // Must stay in the document and selectable. display:none / opacity:0 can fail on iOS.
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;outline:none;box-shadow:none;background:transparent;opacity:0.01;z-index:-1;";
  document.body.appendChild(ta);
  const editable = ta.contentEditable;
  try {
    ta.focus();
    ta.contentEditable = "true";
    ta.readOnly = false;
    const range = document.createRange();
    range.selectNodeContents(ta);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    ta.setSelectionRange(0, ta.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.contentEditable = editable;
    ta.remove();
  }
}
