import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Square, ExternalLink } from "lucide-react";
import type { TicketCard, Drawer } from "@/App";
import { TaskDetail } from "@/components/middle/TaskDetail";
import { TerminalSession } from "@/components/middle/TerminalSession";
import { LocalServices } from "@/components/middle/LocalServices";
import { PrTab } from "@/App";

interface Props {
  activeTask: TicketCard | null;
  openDrawer: Drawer | null;
  /** When true, render only the drawer content. Otherwise render the terminal area. */
  drawerOnly?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onTasksChanged?: () => void;
}

interface StartTicketResult {
  session_id: string;
  branch_name: string;
  worktree_path: string;
}

interface AgentAvailability {
  claude_code: boolean;
  codex: boolean;
  gemini: boolean;
  aider: boolean;
}

type AgentKey = "claude_code" | "codex" | "gemini" | "aider";

interface AgentEntry {
  key: AgentKey;
  label: string;
  cli: string;
  installHint: string;
  blurb: string;
  glyph: string;   // one- or two-letter monogram
  tint: string;    // oklch color
}

const AGENTS: AgentEntry[] = [
  {
    key: "claude_code",
    label: "Claude Code",
    cli: "claude",
    installHint: "npm i -g @anthropic-ai/claude-code",
    blurb: "Best reasoning and autonomy.",
    glyph: "C",
    tint: "oklch(0.72 0.15 35)",
  },
  {
    key: "codex",
    label: "Codex",
    cli: "codex",
    installHint: "npm i -g @openai/codex",
    blurb: "Strongest OpenAI-native terminal option.",
    glyph: "OX",
    tint: "oklch(0.62 0.14 160)",
  },
  {
    key: "gemini",
    label: "Gemini",
    cli: "gemini",
    installHint: "npm i -g @google/gemini-cli",
    blurb: "Cheapest, easiest entry point.",
    glyph: "G",
    tint: "oklch(0.62 0.16 250)",
  },
  {
    key: "aider",
    label: "Aider",
    cli: "aider",
    installHint: "pip install aider-chat",
    blurb: "Most flexible if you want control.",
    glyph: "A",
    tint: "oklch(0.65 0.18 300)",
  },
];

function displayPath(path: string | null, fallback: string | null): string {
  if (!path) return fallback || "terminal";
  let p = path;
  const m = p.match(/^\/Users\/[^/]+\/(.*)$/);
  if (m) p = "~/" + m[1];
  return p;
}

export function TaskView({ activeTask, openDrawer, drawerOnly, isFullscreen, onToggleFullscreen, onTasksChanged }: Props) {
  const [sessionByTask, setSessionByTask] = useState<Record<string, { sessionId: string; worktreePath: string; agent: AgentKey }>>({});
  const [starting, setStarting] = useState<AgentKey | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentAvailability | null>(null);

  const session = activeTask ? sessionByTask[activeTask.id] : null;
  const sessionId = session?.sessionId ?? null;
  const worktreePath = session?.worktreePath ?? null;

  // Load agent availability on mount / when task changes
  useEffect(() => {
    if (drawerOnly) return;
    invoke<AgentAvailability>("check_agents").then(setAgents).catch(() => setAgents(null));
  }, [drawerOnly, activeTask?.id]);

  // Clear error when switching tasks
  useEffect(() => {
    setStartError(null);
  }, [activeTask?.id]);

  const handleStart = async (agent: AgentKey) => {
    if (!activeTask) return;
    setStarting(agent);
    setStartError(null);
    try {
      const result = await invoke<StartTicketResult>("start_agent", {
        ticketId: activeTask.id,
        agent,
      });
      setSessionByTask((prev) => ({
        ...prev,
        [activeTask.id]: { sessionId: result.session_id, worktreePath: result.worktree_path, agent },
      }));
      onTasksChanged?.();
    } catch (e) {
      setStartError(String(e));
    } finally {
      setStarting(null);
    }
  };

  const handleKill = async () => {
    if (!sessionId || !activeTask) return;
    try {
      await invoke("kill_session", { sessionId });
      setSessionByTask((prev) => {
        const next = { ...prev };
        delete next[activeTask.id];
        return next;
      });
    } catch (e) { console.error(e); }
  };

  // Drawer-only mode: render just the selected drawer content
  if (drawerOnly) {
    if (!activeTask || !openDrawer) return null;
    if (openDrawer === "plan")  return <TaskDetail ticket={activeTask} />;
    if (openDrawer === "local") return <LocalServices ticket={activeTask} isFullscreen={!!isFullscreen} onToggleFullscreen={onToggleFullscreen} />;
    if (openDrawer === "pr")    return <PrTab activeTicket={activeTask} hidden={false} />;
    return null;
  }

  if (!activeTask) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="flex flex-col items-center text-center">
          <p className="font-display text-3xl text-foreground leading-tight whitespace-nowrap">
            Pick a task, or make a <span className="font-display-italic text-primary">new one.</span>
          </p>
          <p className="text-[13px] text-muted-foreground leading-relaxed mt-2" style={{ width: "90%" }}>
            Each task gets its own worktree and terminal, so you can switch context without losing any.
          </p>
        </div>
      </div>
    );
  }

  // Session live
  if (sessionId) {
    return (
      <div className="h-full flex flex-col">
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
      </div>
    );
  }

  // Starting a specific agent
  if (starting) {
    const agent = AGENTS.find((a) => a.key === starting);
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <Loader2 size={20} className="animate-spin text-muted-foreground-soft mx-auto" />
          <div>
            <p className="text-[13px] text-foreground tracking-tight">Starting {agent?.label}</p>
            <p className="text-[11px] text-muted-foreground-soft mt-0.5">Creating worktree and booting the terminal.</p>
          </div>
        </div>
      </div>
    );
  }

  // Agent picker — shown when task is selected but no session yet
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <p className="font-display text-4xl text-foreground mb-2 tracking-[-0.02em]">
            Pick an <span className="font-display-italic text-primary">agent.</span>
          </p>
          <p className="text-[13px] text-muted-foreground">
            This will create a worktree from <span className="font-mono">main</span> and open a terminal with the chosen CLI.
          </p>
        </div>

        {!agents && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={14} className="animate-spin text-muted-foreground-soft" />
          </div>
        )}

        {agents && (
          <div className="space-y-1.5">
            {AGENTS.map((a) => {
              const installed = agents[a.key];
              return (
                <button
                  key={a.key}
                  onClick={() => installed && handleStart(a.key)}
                  disabled={!installed}
                  title={installed ? a.label : `Install separately in your terminal: ${a.installHint}`}
                  className={`w-full flex items-start gap-3 rounded-lg px-3 py-3 text-left transition-all ${
                    installed
                      ? "bg-surface/60 hover:bg-surface hover:shadow-sm"
                      : "bg-surface/25 opacity-55 cursor-not-allowed"
                  }`}
                >
                  <span
                    className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center font-display text-[14px] font-medium"
                    style={{
                      backgroundColor: installed ? `${a.tint.replace(")", " / 0.16)")}` : "oklch(0.24 0.005 60)",
                      color: installed ? a.tint : "oklch(0.55 0 0)",
                    }}
                  >
                    {a.glyph}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`text-[13px] font-medium tracking-tight ${installed ? "text-foreground" : "text-muted-foreground"}`}>
                        {a.label}
                      </p>
                      {installed ? (
                        <span className="text-[10px] font-mono text-muted-foreground-soft">${a.cli}</span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground-soft flex items-center gap-1">
                          Not installed <ExternalLink size={10} />
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] text-muted-foreground-soft leading-snug mt-0.5">
                      {installed ? a.blurb : `Install separately in your terminal: ${a.installHint}`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {startError && (
          <p className="mt-4 text-[11px] text-destructive text-center font-mono whitespace-pre-wrap">{startError}</p>
        )}
      </div>
    </div>
  );
}
