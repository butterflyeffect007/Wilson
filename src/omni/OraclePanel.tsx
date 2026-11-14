import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechToText } from "../hooks/useSpeechToText";
import { speakMessage } from "../lib/kokoroTTS";
import { getPuckState, puckOnDisk, puckOnDiskKnown } from "../lib/puckVoice";
import { isE2EOmni } from "./access";
import { cachedIsAdmin } from "../lib/admin";
import { isE2EArchitect } from "../terminal/access";
import { EXAMPLE_ORACLE, EXAMPLE_ORACLE_QUESTION, runOracle, type OracleTurn } from "./oracle";

type LogItem = { q: string; turn: OracleTurn };

function brainLabel(turn: OracleTurn): string {
  if (turn.stopped) return "stopped";
  if (turn.brain === "fixture") return "example loop";
  if (turn.escalated) return `escalated → ${turn.brain}`;
  if (turn.brain === "on-device") return "on-device";
  return "rented";
}

export default function OraclePanel() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogItem[]>(() => (
    isE2EOmni() ? [{ q: EXAMPLE_ORACLE_QUESTION, turn: EXAMPLE_ORACLE }] : []
  ));
  const [photo, setPhoto] = useState<{ file: File; name: string } | null>(null);
  const [puckReady, setPuckReady] = useState(() => getPuckState() === "ready" || puckOnDiskKnown() === true);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void puckOnDisk().then((ok) => { if (ok) setPuckReady(true); });
  }, []);

  const onSpoken = useCallback((t: string) => {
    setDraft((d) => (d && t ? d.replace(/\s+$/, "") + " " + t : d + t));
  }, []);
  const stt = useSpeechToText(onSpoken, onSpoken);

  const ask = async (text?: string) => {
    const q = (text ?? draft).trim();
    if ((!q && !photo) || busy) return;
    setBusy(true);
    if (!text) setDraft("");
    const architect = cachedIsAdmin() || isE2EArchitect();
    const turn = await runOracle(q || "Look at this photo.", {
      architect,
      speakerId: "architect",
      image: photo?.file || null,
    });
    setLog((rows) => [...rows, { q: q || `(photo: ${photo?.name || "image"})`, turn }]);
    setPhoto(null);
    setBusy(false);
    if (turn.reply && !turn.stopped && (getPuckState() === "ready" || puckReady)) {
      try { speakMessage(turn.reply); } catch { /* voice is optional */ }
    }
  };

  const onFile = (f: File | undefined | null) => {
    if (!f) return;
    setPhoto({ file: f, name: f.name || "photo" });
  };

  return (
    <section className="card oracle" data-testid="omni-oracle">
      <div className="pills">
        <span className="pill gold">Oracle</span>
        <span className="pill icy">on-device first</span>
        <span className="pill">rented fallback</span>
      </div>
      <h3>Omni Oracle</h3>
      <p className="meta">
        The active brain can call Brave search, news, local memory, Jobs hunt (Architect only), the Sunflower lane, and a photo “see” tool. Voice uses the existing mic and Puck, only if Puck is already on this device. Secrets stay on the worker.
      </p>

      {isE2EOmni() && (
        <div className="banner" data-testid="omni-oracle-fixture" role="status">
          Example loop for preview only. This is not a live hunt or a live model reply.
        </div>
      )}

      {log.map((row, i) => (
        <div key={i} className="oracle-turn" data-testid={i === log.length - 1 ? "omni-oracle-turn" : undefined}>
          <p className="meta">You: {row.q}</p>
          {!!row.turn.used.length && (
            <div className="pills tools">
              {row.turn.used.map((u, j) => (
                <span key={j} className={`pill ${u.ok ? "icy" : "amber"}`}>{u.name}{u.ok ? "" : " · miss"}</span>
              ))}
              <span className="pill gold">{brainLabel(row.turn)}</span>
            </div>
          )}
          {!row.turn.used.length && (
            <div className="pills tools">
              <span className="pill gold">{brainLabel(row.turn)}</span>
            </div>
          )}
          <div className="reply" data-testid={i === log.length - 1 ? "omni-oracle-reply" : undefined}>{row.turn.reply}</div>
        </div>
      ))}

      {photo && <p className="meta">Photo attached: {photo.name}</p>}
      {stt.error && <p className="fail">{stt.error}</p>}

      <div className="chatbar oracle-bar">
        <input
          data-testid="omni-oracle-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask Omni…"
          onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
          disabled={busy}
        />
        <button type="button" className="btn ghost" data-testid="omni-oracle-mic" onClick={() => stt.toggle()} disabled={busy} aria-label="Voice in">
          {stt.listening ? "Listening" : "Mic"}
        </button>
        <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>See</button>
        <button type="button" className="btn ghost" onClick={() => camRef.current?.click()} disabled={busy}>Camera</button>
        <button
          type="button"
          className="btn go"
          data-testid="omni-oracle-send"
          disabled={busy || (!draft.trim() && !photo)}
          onClick={() => void ask()}
        >
          {busy ? "Working…" : "Ask"}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </section>
  );
}
