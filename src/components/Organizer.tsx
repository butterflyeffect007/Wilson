import { useEffect, useState } from "react";
import { X, Trash2, Check, Plus, Bell } from "lucide-react";
import { loadNotes, addNote, updateNote, deleteNote, loadReminders, addReminder, setReminderDone, deleteReminder, fmtDue, askNotifyOnce, type Note, type Reminder } from "../lib/organizer";

export type OrgTab = "notes" | "reminders";

export default function Organizer({ tab, onTab, onClose }: { tab: OrgTab; onTab: (t: OrgTab) => void; onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [rems, setRems] = useState<Reminder[]>(loadReminders);
  const [draft, setDraft] = useState("");
  const [when, setWhen] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  useEffect(() => {
    const f = () => { setNotes(loadNotes()); setRems(loadReminders()); };
    window.addEventListener("wilson-organizer", f); return () => window.removeEventListener("wilson-organizer", f);
  }, []);
  const open = rems.filter((r) => !r.done).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
  const done = rems.filter((r) => r.done).slice(-10).reverse();
  const add = () => {
    const t = draft.trim(); if (!t) return;
    if (tab === "notes") addNote(t); else { addReminder(t, when ? new Date(when) : null); void askNotifyOnce(); }
    setDraft(""); setWhen("");
  };
  const tabBtn = (t: OrgTab, label: string) => (
    <button type="button" onClick={() => onTab(t)} className={`flex-1 py-2 text-[14px] rounded-xl ${tab === t ? "bg-white/70 text-violet-900 shadow-sm" : "text-violet-600/70"}`}>{label}</button>
  );
  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-violet-950/10" role="dialog" aria-label={tab === "notes" ? "Notes" : "Reminders"}>
      <div className="mt-auto w-full max-w-lg mx-auto glass-strong rounded-t-3xl flex flex-col max-h-[88dvh] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-[17px] tracking-[0.04em] text-violet-950/90">{tab === "notes" ? "Notes" : "Reminders"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-violet-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-1 mx-4 mt-3 p-1 rounded-2xl bg-violet-100/40">{tabBtn("notes", "Notes")}{tabBtn("reminders", "Reminders")}</div>
        <div className="px-4 pt-3 space-y-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={tab === "notes" ? "Write a note…" : "What should Wilson remind you about?"} className="w-full text-[16px] leading-relaxed rounded-xl px-3 py-2 bg-white/60 text-violet-950 border border-violet-200/60 resize-none" />
          <div className="flex gap-2">
            {tab === "reminders" && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Time (optional)" className="flex-1 min-w-0 text-[14px] rounded-xl px-3 py-2 bg-white/60 text-violet-900 border border-violet-200/60" />}
            <button type="button" onClick={add} disabled={!draft.trim()} className="ml-auto px-4 py-2 rounded-xl bg-violet-500/90 text-white text-[14px] flex items-center gap-1 disabled:opacity-50"><Plus className="w-4 h-4" />Add</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {tab === "notes" && (notes.length === 0 ? <p className="text-[14px] text-violet-600/60 py-6 text-center">No notes yet. Try telling Wilson “note that…”.</p> :
            notes.map((n) => (
              <div key={n.id} className="rounded-2xl msg-wilson px-4 py-3">
                {editing === n.id ? (
                  <>
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className="w-full text-[16px] rounded-xl px-2 py-1 bg-white/60 text-violet-950 border border-violet-200/60 resize-none" autoFocus />
                    <div className="flex gap-3 mt-2 text-[13px]">
                      <button type="button" className="text-violet-700" onClick={() => { updateNote(n.id, editText.trim() || n.text); setEditing(null); }}>Save</button>
                      <button type="button" className="text-violet-500/70" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[16px] leading-relaxed text-violet-950/90 whitespace-pre-wrap break-words" onClick={() => { setEditing(n.id); setEditText(n.text); }}>{n.text}</div>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-violet-500/70">
                      <span>{new Date(n.updated).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                      <button type="button" onClick={() => { setEditing(n.id); setEditText(n.text); }}>Edit</button>
                      <button type="button" className="ml-auto text-rose-400" aria-label="Delete note" onClick={() => { if (confirm("Delete this note?")) deleteNote(n.id); }}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </>
                )}
              </div>
            )))}
          {tab === "reminders" && (
            <>
              {open.length === 0 && <p className="text-[14px] text-violet-600/60 py-6 text-center">Nothing coming up. Try “remind me at 7 to…”.</p>}
              {open.map((r) => {
                const overdue = r.due && Date.parse(r.due) <= Date.now();
                return (
                  <div key={r.id} className="rounded-2xl msg-wilson px-3 py-3 flex items-center gap-3">
                    <button type="button" onClick={() => setReminderDone(r.id)} aria-label="Mark done" className="w-6 h-6 rounded-full border-2 border-violet-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[16px] text-violet-950/90 break-words">{r.text}</div>
                      <div className={`text-[12px] flex items-center gap-1 ${overdue ? "text-rose-500" : "text-violet-500/70"}`}><Bell className="w-3 h-3" />{fmtDue(r.due)}{overdue ? " · due" : ""}</div>
                    </div>
                    <button type="button" onClick={() => deleteReminder(r.id)} aria-label="Delete reminder" className="text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
              {done.length > 0 && <p className="text-[12px] text-violet-500/60 pt-2">Done</p>}
              {done.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-[14px] text-violet-500/60">
                  <button type="button" onClick={() => setReminderDone(r.id, false)} aria-label="Mark not done" className="w-5 h-5 rounded-full bg-violet-300/60 flex items-center justify-center"><Check className="w-3 h-3 text-white" /></button>
                  <span className="flex-1 line-through break-words">{r.text}</span>
                  <button type="button" onClick={() => deleteReminder(r.id)} aria-label="Delete reminder" className="text-rose-300"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
