/**
 * Operator safety gate. Decides, before an action runs, whether Wilson may do
 * it on his own, must pause and ask the user, or must never do it.
 *
 * Rule of thumb: reading, searching and following ordinary links are free.
 * Anything with consequences outside this screen (submitting a form, buying,
 * sending, signing in, deleting, subscribing, posting) waits for a human "yes".
 * Typing passwords, card numbers or ID numbers is never done by Wilson.
 */
export type GateVerdict =
  | { kind: "allow" }
  | { kind: "confirm"; reason: string }
  | { kind: "block"; reason: string };

export type GateContext = {
  /** Visible text / href of the link or button the action targets, when known. */
  targetText?: string;
  targetHref?: string;
  /** The field the action types into, when known. */
  fieldLabel?: string;
  fieldType?: string;
  /** Last field typed into (used to let plain search boxes submit freely). */
  lastFieldLabel?: string;
  lastFieldType?: string;
  /** True when a real browser runs the action (clicks can press buttons). False: a click just opens a link's URL. */
  live?: boolean;
};

const RISKY_WORDS = /\b(buy|purchase|order|checkout|check out|pay|payment|place order|add to cart|subscribe|donate|send|email|message|post|publish|tweet|reply|submit|apply|register|sign ?up|sign ?in|log ?in|login|log ?out|logout|delete|remove|cancel|unsubscribe|confirm|transfer|book|reserve|accept|agree|authori[sz]e|grant|install|upload|share|invite)\b/i;
const RISKY_HREF = /(checkout|cart|\/pay\b|payment|purchase|\/order|subscribe|unsubscribe|logout|signout|sign-out|login|signin|sign-in|\/auth|oauth|delete|remove|mailto:|sms:|tel:)/i;
const SECRET_FIELD = /\b(pass(word|code|phrase)?|pwd|pin|otp|one[- ]time|2fa|mfa|verification code|security code|cvv|cvc|card ?(number|no)|credit card|debit card|ssn|social security|tax id|routing|account number|iban|secret|api[- ]?key|token)\b/i;
const SEARCH_FIELD = /\b(search|query|find|keywords?|^q$)\b/i;

export function isSecretField(label = "", type = ""): boolean {
  return /^(password)$/i.test(type) || SECRET_FIELD.test(label);
}

export function looksLikeSearchField(label = "", type = ""): boolean {
  return /^search$/i.test(type) || SEARCH_FIELD.test(label.trim());
}

export function gate(action: string, args: Record<string, unknown>, ctx: GateContext = {}): GateVerdict {
  const a = action.toLowerCase();
  const text = `${ctx.targetText ?? ""} ${String(args.target ?? "")}`.trim();
  const href = ctx.targetHref ?? "";
  if (a === "type") {
    const label = `${ctx.fieldLabel ?? ""} ${String(args.field ?? "")}`;
    if (isSecretField(label, ctx.fieldType)) return { kind: "block", reason: "That looks like a password, code, card or ID field. Wilson never types those; you'll need to do that part yourself." };
    return { kind: "allow" };
  }
  if (a === "submit") {
    if (looksLikeSearchField(ctx.lastFieldLabel, ctx.lastFieldType) && !RISKY_WORDS.test(text.replace(/\bsubmit\b/gi, ""))) return { kind: "allow" };
    return { kind: "confirm", reason: `Submit this form${text ? ` (“${text.slice(0, 80)}”)` : ""}. Submitting can send information or start something you can't undo.` };
  }
  if (a === "click" && !ctx.live) {
    // Without a live browser a click only opens the link's address (a plain read), so judge it like "open".
    return gate("open", { url: href || String(args.target ?? "") }, ctx);
  }
  if (a === "click") {
    if (/^(mailto|sms|tel|javascript):/i.test(href)) return { kind: "confirm", reason: "This link would open a message, call or script." };
    if (RISKY_WORDS.test(text) || RISKY_HREF.test(href)) return { kind: "confirm", reason: `Click “${(text || href).slice(0, 80)}”. It looks like it could buy, send, sign in, change or delete something.` };
    return { kind: "allow" };
  }
  if (a === "open") {
    const url = String(args.url ?? "");
    if (/^(mailto|sms|tel|javascript|data|file):/i.test(url)) return { kind: "block", reason: "Wilson only opens normal web pages (http/https)." };
    if (RISKY_HREF.test(url) && /(logout|signout|sign-out|delete|unsubscribe|checkout|\/pay\b|purchase)/i.test(url)) return { kind: "confirm", reason: `Open ${url.slice(0, 120)}. Visiting this address may change something (log out, unsubscribe, check out or delete).` };
    return { kind: "allow" };
  }
  return { kind: "allow" };
}
