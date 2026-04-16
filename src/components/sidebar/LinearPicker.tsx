import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Search, Loader2, Sparkles, AlertCircle, ArrowRight, ChevronLeft } from "lucide-react";
import { StatusCircle, STATUS_CONFIG } from "@/components/board/statusIcons";
import type { TicketCard } from "@/App";

interface PickerIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  branch_name: string | null;
  project: string | null;
  tags: string[];
  in_current_cycle: boolean;
}

function sortByPriorityThenUpdated(a: PickerIssue, b: PickerIssue): number {
  // Linear priorities: 0=none, 1=urgent, 2=high, 3=medium, 4=low
  // Sort urgent→low, with 0 (none) at the end
  const ap = a.priority === 0 ? 99 : a.priority;
  const bp = b.priority === 0 ? 99 : b.priority;
  if (ap !== bp) return ap - bp;
  return a.identifier.localeCompare(b.identifier);
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (t: TicketCard) => void;
  onBlankCreated: (t: TicketCard) => void;
  existingIds: Set<string>;
}

type Mode = "pick" | "blank";

export function LinearPicker({ open, onClose, onImported, onBlankCreated, existingIds }: Props) {
  const [mode, setMode] = useState<Mode>("pick");
  const [issues, setIssues] = useState<PickerIssue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(0);
  const [importing, setImporting] = useState<string | null>(null);
  const [blankTitle, setBlankTitle] = useState("");
  const [creatingBlank, setCreatingBlank] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blankInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSelected(0);
    setError(null);
    setMode("pick");
    setBlankTitle("");
    setLoading(true);
    invoke<PickerIssue[]>("fetch_linear_issues_live")
      .then((list) => { setIssues(list); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (mode === "blank") setTimeout(() => blankInputRef.current?.focus(), 0);
  }, [mode]);

  const handleCreateBlank = async () => {
    const title = blankTitle.trim();
    if (!title || creatingBlank) return;
    setCreatingBlank(true);
    setError(null);
    try {
      const t = await invoke<TicketCard>("create_task", { title });
      invoke("start_ticket", { ticketId: t.id }).catch(() => {});
      onBlankCreated(t);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingBlank(false);
    }
  };

  const filtered = (issues || []).filter((i) =>
    !q ||
    i.title.toLowerCase().includes(q.toLowerCase()) ||
    i.identifier.toLowerCase().includes(q.toLowerCase())
  );

  const cycleIssues = filtered.filter((i) => i.in_current_cycle).sort(sortByPriorityThenUpdated);
  const otherIssues = filtered.filter((i) => !i.in_current_cycle).sort(sortByPriorityThenUpdated);
  const orderedList = [...cycleIssues, ...otherIssues];

  const handleImport = async (issue: PickerIssue) => {
    setImporting(issue.id);
    try {
      const t = await invoke<TicketCard>("import_linear_task", {
        linearId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        branchName: issue.branch_name,
        priority: issue.priority,
      });
      onImported(t);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, orderedList.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (orderedList[selected]) handleImport(orderedList[selected]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl bg-surface-elevated shadow-2xl ring-1 ring-divider overflow-hidden flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 hairline-b px-4 py-3 shrink-0">
          {mode === "blank" ? (
            <>
              <button
                onClick={() => { setMode("pick"); setBlankTitle(""); setError(null); }}
                className="text-muted-foreground-soft hover:text-foreground p-0.5"
                title="Back"
              >
                <ChevronLeft size={16} />
              </button>
              <Sparkles size={14} className="text-primary" />
              <input
                ref={blankInputRef}
                type="text"
                value={blankTitle}
                onChange={(e) => setBlankTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBlank();
                  if (e.key === "Escape") { setMode("pick"); setBlankTitle(""); }
                }}
                placeholder="New task title…"
                className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground-soft/70 outline-none"
              />
              <button
                onClick={handleCreateBlank}
                disabled={!blankTitle.trim() || creatingBlank}
                className="inline-flex items-center gap-1 h-7 px-2.5 text-[12px] rounded-md bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
              >
                {creatingBlank ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                Create
              </button>
            </>
          ) : (
            <>
              <Search size={14} className="text-muted-foreground-soft" />
              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => { setQ(e.target.value); setSelected(0); }}
                onKeyDown={handleKeyDown}
                placeholder="Search Linear tasks…"
                className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground-soft/70 outline-none"
              />
              <button onClick={onClose} className="text-muted-foreground-soft hover:text-foreground p-0.5">
                <X size={14} />
              </button>
            </>
          )}
        </div>

        <div className={`flex-1 overflow-y-auto py-1 ${mode === "blank" ? "hidden" : ""}`}>
          {/* Blank task option — always available, top of list */}
          <button
            onClick={() => setMode("blank")}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-primary-soft transition-colors"
          >
            <div className="h-6 w-6 shrink-0 rounded-md bg-primary-soft flex items-center justify-center">
              <Sparkles size={12} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-foreground font-medium">Create blank task</p>
              <p className="text-[11px] text-muted-foreground-soft">Not from Linear. You'll name it yourself.</p>
            </div>
            <ArrowRight size={12} className="text-muted-foreground-soft" />
          </button>

          <div className="mx-3 my-1 h-px bg-divider" />

          <p className="px-4 pt-2 pb-2 text-[11px] text-muted-foreground-soft leading-relaxed">
            Only issues <span className="text-foreground/80">assigned to you</span>. Creating one spins up a worktree from{" "}
            <span className="font-mono text-foreground/80">main</span> using Linear's branch name.
          </p>

          {loading && (
            <div className="py-6 text-center">
              <Loader2 size={16} className="animate-spin text-muted-foreground-soft mx-auto" />
              <p className="text-[11px] text-muted-foreground-soft mt-2">Fetching from Linear…</p>
            </div>
          )}

          {error && (
            <div className="mx-3 my-2 rounded-md bg-destructive/10 px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] text-destructive">{error}</p>
                {error.includes("No Linear API token") && (
                  <p className="text-[11px] text-muted-foreground-soft mt-1">Add one in Settings.</p>
                )}
              </div>
            </div>
          )}

          {issues && !loading && filtered.length === 0 && (
            <p className="text-[12px] text-muted-foreground-soft text-center py-6">
              {q ? `No match for "${q}"` : "No assigned Linear tasks"}
            </p>
          )}

          {issues && !loading && filtered.map((issue, i) => {
            const statusDef = STATUS_CONFIG[issue.status];
            const alreadyImported = existingIds.has(issue.id);
            return (
              <button
                key={issue.id}
                onClick={() => !alreadyImported && handleImport(issue)}
                disabled={alreadyImported || importing === issue.id}
                className={`flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors ${
                  i === selected ? "bg-primary-soft" : "hover:bg-surface/60"
                } ${alreadyImported ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="h-6 w-6 shrink-0 flex items-center justify-center">
                  {statusDef && <StatusCircle icon={statusDef.icon} color={statusDef.color} size={11} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground-soft">{issue.identifier}</span>
                    {statusDef && (
                      <span className="text-[10px] text-muted-foreground-soft">· {statusDef.label}</span>
                    )}
                    {issue.project && (
                      <span className="text-[10px] text-muted-foreground-soft">· {issue.project}</span>
                    )}
                    {alreadyImported && (
                      <span className="ml-auto text-[10px] text-muted-foreground-soft italic">added</span>
                    )}
                  </div>
                  <p className="text-[13px] text-foreground leading-snug truncate">{issue.title}</p>
                </div>
                {importing === issue.id && (
                  <Loader2 size={14} className="animate-spin text-primary shrink-0 mt-1" />
                )}
              </button>
            );
          })}

        </div>

        {/* Blank-mode body */}
        {mode === "blank" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Type a title for the task. Herd will create a local task and spin up a worktree from{" "}
              <span className="font-mono text-foreground/80">main</span> with a branch name derived from the title.
            </p>
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 flex items-start gap-2">
                <AlertCircle size={14} className="text-destructive shrink-0 mt-0.5" />
                <p className="text-[12px] text-destructive">{error}</p>
              </div>
            )}
          </div>
        )}

        <div className="hairline-t shrink-0 px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground-soft">
          <span className="flex items-center gap-1.5">
            {mode === "blank" ? (
              <><kbd className="font-mono">↵</kbd> create</>
            ) : (
              <><kbd className="font-mono">↑↓</kbd> navigate<kbd className="font-mono ml-2">↵</kbd> create</>
            )}
          </span>
          <kbd className="font-mono">esc</kbd>
        </div>
      </div>
    </div>
  );
}
