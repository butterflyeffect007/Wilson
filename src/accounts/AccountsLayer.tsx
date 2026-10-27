import { useEffect, useState } from "react";
import "./accounts.css";
import type { AcctUser, Flags } from "./api";
import { AuthPage, ForgotPage, RecoveryCodeScreen } from "./AuthPages";
import { BetaPage } from "./BetaPage";
import { MessageArchitect } from "./MessageArchitect";
import { CommunityRoom } from "./CommunityRoom";
import { ArchitectDashboard } from "./ArchitectDashboard";
import { AccountPage } from "./AccountPage";

export const ROUTES = ["signin", "signup", "forgot", "beta", "message", "room", "architect", "account"] as const;
export type Route = (typeof ROUTES)[number];
const readRoute = (): Route | null => { const h = location.hash.replace(/^#\/?/, "").split(/[?&]/)[0]; return (ROUTES as readonly string[]).includes(h) ? (h as Route) : null; };

export function closeLayer() {
  if (!location.hash) return;
  history.replaceState(null, "", location.pathname + location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
export function useAccountRoute() {
  const [r, setR] = useState<Route | null>(readRoute);
  useEffect(() => { const f = () => setR(readRoute()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return r;
}

export function AccountsLayer({ route, user, flags, isAdmin, chatContext, syncNote, onSignOut }: {
  route: Route | null; user: AcctUser | null; flags: Flags | null; isAdmin: boolean; chatContext: string; syncNote: string | null; onSignOut: (removeLocal: boolean) => Promise<void> | void;
}) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => { document.documentElement.style.overflow = route || code ? "hidden" : ""; return () => { document.documentElement.style.overflow = ""; }; }, [route, code]);
  useEffect(() => { if (route) document.querySelector(".wa")?.scrollTo(0, 0); }, [route]);
  if (!route && !code) return null;
  let page: JSX.Element | null = null;
  if (code) page = <RecoveryCodeScreen code={code} onDone={() => { setCode(null); closeLayer(); }} />;
  else if ((route === "signin" || route === "signup") && user) page = <AccountPage user={user} onClose={closeLayer} onSignOut={onSignOut} syncNote={syncNote} />;
  else if (route === "signin" || route === "signup") page = <AuthPage mode={route} onClose={closeLayer} onSignedIn={closeLayer} onRecovery={setCode} signupsOpen={flags?.signups_open !== false} />;
  else if (route === "forgot") page = <ForgotPage onClose={closeLayer} onRecovered={setCode} />;
  else if (route === "beta") page = <BetaPage user={user} onClose={closeLayer} />;
  else if (route === "message") page = <MessageArchitect user={user} onClose={closeLayer} context={chatContext} />;
  else if (route === "room") page = <CommunityRoom user={user} onClose={closeLayer} />;
  else if (route === "architect") page = user?.architect || isAdmin ? <ArchitectDashboard user={user} onClose={closeLayer} /> : user ? <AccountPage user={user} onClose={closeLayer} onSignOut={onSignOut} syncNote={syncNote} notice="The Architect dashboard is only for the Architect account. If you have an Architect claim code, use Claim Architect below." /> : <AuthPage mode="signin" onClose={closeLayer} onSignedIn={() => { location.hash = "#architect"; }} onRecovery={setCode} signupsOpen={flags?.signups_open !== false} />;
  else if (route === "account") page = <AccountPage user={user} onClose={closeLayer} onSignOut={onSignOut} syncNote={syncNote} />;
  return <div className="wa" role="dialog" aria-modal="true">{page}</div>;
}
