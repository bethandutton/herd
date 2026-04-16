import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Square, Play, ListChecks } from "lucide-react";
import type { TicketCard, Tab } from "@/App";
import { TaskDetail } from "@/components/middle/TaskDetail";
import { TerminalSession } from "@/components/middle/TerminalSession";
import { PrTab, LocalPreviewTab } from "@/App";

const PLAN_STATUSES = ["backlog", "todo", "planning"];

function displayPath(path: string | null, fallback: string | null): string {
  if (!path) return fallback || "terminal";
  // Replace $HOME with ~ for a tidier label
  const home = (window as any).HOME_DIR as string | undefined;
  let p = path;
  if (home && p.startsWith(home)) p = "~" + p.slice(home.length);
  else {
    // crude heuristic: /Users/<name>/...  ->  ~/...
    const m = p.match(/^\/Users\/[^/]+\/(.*)$/);
    if (m) p = "~/" + m[1];
  }
  return p;
}

interface Props {
  activeTask: TicketCard | null;
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
}

interface StartTicketResult {
  session_id: string;
  branch_name: string;
  worktree_path: string;
}

export function TaskView({ activeTask, activeTab, setActiveTab }: Props) {
  const [sessionByTask, setSessionByTask] = useState<Record<string, { sessionId: string; worktreePath: string }>>({});
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startingFor = useRef<string | null>(null);

  const session = activeTask ? sessionByTask[activeTask.id] : null;
  const sessionId = session?.sessionId ?? null;
  const worktreePath = session?.worktreePath ?? null;

  // Auto-start when Terminal tab is active and no session yet
  useEffect(() => {
    if (!activeTask || activeTab !== "session") return;
    if (sessionId) return;
    if (starting) return;
    if (startingFor.current === activeTask.id) return;

    if (PLAN_STATUSES.includes(activeTask.status) && !activeTask.branch_name) {
      // User clicked Terminal — we commit to creating a branch
    }

    startingFor.current = activeTask.id;
    setStarting(true);
    setStartError(null);
    invoke<StartTicketResult>("start_ticket", { ticketId: activeTask.id })
      .then((result) => {
        setSessionByTask((prev) => ({
          ...prev,
          [activeTask.id]: { sessionId: result.session_id, worktreePath: result.worktree_path },
        }));
      })
      .catch((e) => setStartError(String(e)))
      .finally(() => {
        setStarting(false);
        startingFor.current = null;
      });
  }, [activeTask?.id, activeTab, sessionId, starting]);

  const handleKill = async () => {
    if (!sessionId || !activeTask) return;
    try {
      await invoke("kill_session", { sessionId });
      setSessionByTask((prev) => {
        const next = { ...prev };
        const taskId = activeTask.id;
        delete next[taskId];
        return next;
      });
    } catch (e) { console.error(e); }
  };

  if (!activeTask) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-surface/60">
            <ListChecks size={20} className="text-muted-foreground-soft" />
          </div>
          <p className="font-display text-3xl text-foreground mb-2 leading-tight">
            Pick a task, or make a <span className="font-display-italic text-primary">new one.</span>
          </p>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Each task gets its own worktree and terminal, so you can switch context without losing any.
          </p>
          <div className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-surface/50 px-2.5 py-1 text-[11px] text-muted-foreground-soft">
            <kbd className="font-mono">⌘K</kbd> quick find
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Task detail (read-only) */}
      <div className={activeTab === "plan" ? "h-full" : "hidden"}>
        <TaskDetail ticket={activeTask} />
      </div>

      {/* Terminal tab */}
      <div className={activeTab === "session" ? "h-full flex flex-col" : "hidden"}>
        {sessionId ? (
          <>
            <div className="hairline-b flex items-center justify-between px-5 py-1.5 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_0_var(--success)] shrink-0" />
                <span className="text-[11px] text-muted-foreground-soft font-mono truncate" title={worktreePath ?? undefined}>
                  {displayPath(worktreePath, activeTask.branch_name)}
                </span>
              </div>
              <button
                onClick={handleKill}
                className="inline-flex items-center gap-1 h-6 px-2 text-[11px] text-muted-foreground-soft hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                title="Stop terminal"
              >
                <Square size={9} /> Stop
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <TerminalSession sessionId={sessionId} />
            </div>
          </>
        ) : starting ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <Loader2 size={18} className="animate-spin text-muted-foreground-soft mx-auto" />
              <div>
                <p className="text-[13px] text-foreground tracking-tight">Creating worktree</p>
                <p className="text-[11px] text-muted-foreground-soft mt-0.5">Cloning the branch and booting Claude Code…</p>
              </div>
            </div>
          </div>
        ) : startError ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="max-w-md text-center space-y-3">
              <p className="font-display text-xl text-destructive">Something broke.</p>
              <p className="text-[11px] text-muted-foreground-soft font-mono whitespace-pre-wrap">{startError}</p>
              <button
                onClick={() => { startingFor.current = null; setStartError(null); setStarting(false); setActiveTab("session"); }}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-primary-soft text-primary text-[12px] font-medium hover:brightness-110 transition"
              >
                <Play size={11} /> Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-muted-foreground-soft">Preparing…</p>
          </div>
        )}
      </div>

      {/* Local preview */}
      <div className={activeTab === "local" ? "h-full" : "hidden"}>
        <LocalPreviewTab activeTicket={activeTask} />
      </div>

      {/* PR */}
      <div className={activeTab === "pr" ? "h-full" : "hidden"}>
        <PrTab activeTicket={activeTask} hidden={activeTab !== "pr"} />
      </div>
    </div>
  );
}
