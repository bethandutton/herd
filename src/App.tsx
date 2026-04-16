import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Toaster, toast } from "sonner";
import {
  ListChecks,
  GitPullRequest,
  Globe,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ChevronDown,
  Plus,
  Trash2,
  Settings as SettingsIcon,
  PanelLeft,
} from "lucide-react";
import { WorktreeSidebar } from "@/components/sidebar/WorktreeSidebar";
import { TaskView } from "@/components/middle/TaskView";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { UpdateChecker } from "@/components/UpdateChecker";
import { useTheme } from "@/hooks/useTheme";

type AppView = "loading" | "onboarding" | "main";
export type Tab = "plan" | "session" | "local" | "pr";
export type Drawer = "plan" | "local" | "pr";

export interface TicketCard {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  status: string;
  branch_name: string | null;
  tags: string[];
  project: string | null;
  assignee: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepoInfo {
  id: string;
  name: string;
  path: string;
  worktrees_dir: string;
  primary_branch: string;
  preview_port: number;
}


export default function App() {
  // Apply theme/density/font-size to <html> at the root.
  useTheme();

  const [view, setView] = useState<AppView>("loading");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [tickets, setTickets] = useState<TicketCard[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [openDrawer, setOpenDrawer] = useState<Drawer | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [drawerFullscreen, setDrawerFullscreen] = useState<boolean>(false);
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [drawerWidths, setDrawerWidths] = useState<Record<Drawer, number>>(() => {
    try {
      const raw = localStorage.getItem("herd.drawerWidths");
      if (raw) return { plan: 420, local: 520, pr: 620, ...JSON.parse(raw) };
    } catch {}
    return { plan: 420, local: 520, pr: 620 };
  });
  const [resizing, setResizing] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  const refreshTasks = useCallback(async () => {
    try {
      const next = await invoke<TicketCard[]>("get_tickets");
      setTickets(next);
    } catch (e) {
      console.error("Failed to load tasks:", e);
    }
  }, []);

  const refreshRepo = useCallback(async () => {
    try {
      const r = await invoke<RepoInfo | null>("get_active_repo");
      setRepo(r);
    } catch {
      setRepo(null);
    }
  }, []);

  useEffect(() => {
    invoke<boolean>("has_repos")
      .then((hasRepos) => setView(hasRepos ? "main" : "onboarding"))
      .catch(() => setView("onboarding"));
  }, []);

  useEffect(() => {
    if (view !== "main") return;
    refreshTasks();
    refreshRepo();
    const unlisten = listen("tickets_updated", refreshTasks);
    return () => { unlisten.then((f) => f()); };
  }, [view, refreshTasks, refreshRepo]);

  // Close project menu on outside click
  useEffect(() => {
    if (!projectMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [projectMenuOpen]);

  useEffect(() => {
    const unlisten1 = listen("open_settings", () => setSettingsOpen(true));
    return () => { unlisten1.then((f) => f()); };
  }, []);

  // Persist drawer widths
  useEffect(() => {
    try { localStorage.setItem("herd.drawerWidths", JSON.stringify(drawerWidths)); } catch {}
  }, [drawerWidths]);

  // Drawer resize: mouse-move handler active while resizing
  useEffect(() => {
    if (!resizing || !openDrawer) return;
    const handleMove = (e: MouseEvent) => {
      const next = Math.min(Math.max(window.innerWidth - e.clientX, 280), Math.round(window.innerWidth * 0.8));
      setDrawerWidths((prev) => ({ ...prev, [openDrawer]: next }));
    };
    const stop = () => setResizing(false);
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing, openDrawer]);

  // Whether GitHub drawer is enabled depends on token presence; refresh when settings close.
  useEffect(() => {
    invoke<string | null>("get_token", { key: "github_api_token" })
      .then((v) => setGithubConfigured(!!v))
      .catch(() => setGithubConfigured(false));
  }, [settingsOpen]);

  const activeTicket = tickets.find((t) => t.id === activeTicketId) || null;

  // When switching tasks, close drawers so we land on terminal.
  useEffect(() => {
    setOpenDrawer(null);
    setDrawerFullscreen(false);
  }, [activeTicketId]);

  // Drop fullscreen state whenever drawer changes/closes
  useEffect(() => { if (!openDrawer) setDrawerFullscreen(false); }, [openDrawer]);

  // Poll session activity and sync status
  useEffect(() => {
    if (view !== "main") return;
    let cancelled = false;
    const prevStates: Record<string, string> = {};

    const tick = async () => {
      try {
        const activity = await invoke<Array<{ session_id: string; ticket_id: string; state: string }>>("get_session_activity");
        if (cancelled) return;
        let changed = false;
        for (const a of activity) {
          const desired =
            a.state === "thinking" ? "working"
            : a.state === "attention" ? "requires_attention"
            : null;
          if (!desired) continue;
          if (prevStates[a.ticket_id] === desired) continue;
          prevStates[a.ticket_id] = desired;
          changed = true;
          try {
            await invoke("update_ticket_status", { ticketId: a.ticket_id, status: desired });
          } catch {}
        }
        if (changed) refreshTasks();
      } catch {}
    };

    const id = window.setInterval(tick, 1500);
    tick();
    return () => { cancelled = true; window.clearInterval(id); };
  }, [view, refreshTasks]);

  // When the user visits a task whose session is in "requires_attention", flip it back to working.
  useEffect(() => {
    if (!activeTicket) return;
    if (activeTicket.status !== "requires_attention") return;
    invoke<Array<{ session_id: string; ticket_id: string; state: string }>>("get_session_activity")
      .then(async (activity) => {
        const match = activity.find((a) => a.ticket_id === activeTicket.id);
        if (!match) return;
        await invoke("mark_session_visited", { sessionId: match.session_id }).catch(() => {});
        await invoke("update_ticket_status", { ticketId: activeTicket.id, status: "working" }).catch(() => {});
        refreshTasks();
      }).catch(() => {});
  }, [activeTicket?.id, activeTicket?.status, refreshTasks]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.metaKey && e.key === "k") { e.preventDefault(); setCommandPaletteOpen((v) => !v); return; }
      if (e.metaKey && e.key === ",") { e.preventDefault(); setSettingsOpen(true); return; }
      if (e.key === "Escape") {
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (drawerFullscreen) setDrawerFullscreen(false);
        return;
      }
      if (e.metaKey && e.key === "1") { e.preventDefault(); setOpenDrawer((d) => d === "plan" ? null : "plan"); return; }
      if (e.metaKey && e.key === "2") { e.preventDefault(); setOpenDrawer((d) => d === "local" ? null : "local"); return; }
      if (e.metaKey && e.key === "3") { e.preventDefault(); setOpenDrawer((d) => d === "pr" ? null : "pr"); return; }

      if (!isInput && !commandPaletteOpen && !settingsOpen) {
        if (e.key === "j" || e.key === "k") {
          e.preventDefault();
          const currentIndex = tickets.findIndex((t) => t.id === activeTicketId);
          if (e.key === "j") {
            const next = Math.min(currentIndex + 1, tickets.length - 1);
            if (tickets[next]) setActiveTicketId(tickets[next].id);
          } else {
            const prev = Math.max(currentIndex - 1, 0);
            if (tickets[prev]) setActiveTicketId(tickets[prev].id);
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, settingsOpen, tickets, activeTicketId]);

  const handleOnboardingComplete = useCallback(async () => {
    await refreshRepo();
    await refreshTasks();
    setView("main");
  }, [refreshRepo, refreshTasks]);

  const handleRerunSetup = useCallback(() => {
    setSettingsOpen(false);
    setView("onboarding");
  }, []);

  const handleCreateBlankTask = useCallback(async (t: TicketCard) => {
    await refreshTasks();
    setActiveTicketId(t.id);
    setOpenDrawer(null);
  }, [refreshTasks]);

  const handleImportedTask = useCallback(async (t: TicketCard) => {
    await refreshTasks();
    setActiveTicketId(t.id);
    setOpenDrawer(null);
  }, [refreshTasks]);

  const handleDeleteTask = useCallback(async (id: string) => {
    if (!confirm("Delete this task?")) return;
    try {
      await invoke("delete_task", { ticketId: id });
      if (activeTicketId === id) setActiveTicketId(null);
      await refreshTasks();
    } catch (e) {
      toast.error(String(e));
    }
  }, [activeTicketId, refreshTasks]);

  if (view === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (view === "onboarding") {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  const hasBranch = !!activeTicket?.branch_name;
  const hasTicket = !!activeTicket;

  const drawerButtons: { key: Drawer; icon: React.ReactNode; label: string; shortcut: string; enabled: boolean; needsToken?: boolean }[] = [
    { key: "plan",  icon: <ListChecks size={14} />,     label: "Task",          shortcut: "⌘1", enabled: hasTicket },
    { key: "local", icon: <Globe size={14} />,          label: "Local preview", shortcut: "⌘2", enabled: hasBranch },
    { key: "pr",    icon: <GitPullRequest size={14} />, label: "GitHub PR",     shortcut: "⌘3", enabled: hasBranch && githubConfigured, needsToken: !githubConfigured },
  ];

  return (
    <div className="flex h-screen flex-col bg-background text-foreground relative">
      {drawerFullscreen && openDrawer && activeTicket && (
        <div className="fixed inset-0 z-[60] bg-background text-foreground">
          <div className="h-full flex flex-col">
            <TaskView
              activeTask={activeTicket}
              openDrawer={openDrawer}
              drawerOnly
              isFullscreen
              onToggleFullscreen={() => setDrawerFullscreen(false)}
            />
          </div>
        </div>
      )}
      {/* Top header — full-width, draggable, hairline bottom */}
      <header data-tauri-drag-region className="hairline-b flex shrink-0 items-center h-11 pr-3">
        {/* Traffic-light spacer — explicit draggable block */}
        <div data-tauri-drag-region className="w-[84px] h-full shrink-0" />

        {/* Project picker */}
        <div className="titlebar-no-drag relative" ref={projectMenuRef}>
          <button
            onClick={() => setProjectMenuOpen(!projectMenuOpen)}
            className="group flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md text-[13px] font-medium text-foreground hover:bg-surface transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_0_var(--success)]" aria-hidden="true" />
            <span className="truncate max-w-[200px] tracking-tight">{repo?.name || "Herd"}</span>
            <ChevronDown size={11} className="text-muted-foreground-soft group-hover:text-muted-foreground transition-colors" />
          </button>
          {projectMenuOpen && (
            <div className="absolute left-0 top-9 z-50 w-72 rounded-lg bg-surface-elevated py-1 shadow-2xl ring-1 ring-divider/40">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground-soft font-medium">Current project</div>
              {repo && (
                <div className="px-3 pb-2">
                  <div className="text-[13px] text-foreground font-medium">{repo.name}</div>
                  <div className="text-[11px] text-muted-foreground-soft font-mono truncate mt-0.5">{repo.path}</div>
                </div>
              )}
              <div className="mx-1 h-px bg-divider" />
              <button
                onClick={() => { setProjectMenuOpen(false); handleRerunSetup(); }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-foreground hover:bg-primary-soft transition-colors"
              >
                <Plus size={12} className="text-muted-foreground" /> Switch / add project
              </button>
              <button
                onClick={() => { setProjectMenuOpen(false); setSettingsOpen(true); }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-foreground hover:bg-primary-soft transition-colors"
              >
                <SettingsIcon size={12} className="text-muted-foreground" /> Settings
                <span className="ml-auto text-[10px] text-muted-foreground-soft font-mono">⌘,</span>
              </button>
              {repo && (
                <>
                  <div className="mx-1 h-px bg-divider" />
                  <button
                    onClick={async () => {
                      setProjectMenuOpen(false);
                      if (!confirm(`Close project "${repo.name}"? Worktrees and tasks stay on disk.`)) return;
                      try { handleRerunSetup(); } catch (e) { toast.error(String(e)); }
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 size={12} /> Close project
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="titlebar-no-drag flex items-center ml-2 gap-0.5">
          <button
            disabled
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft/50 disabled:cursor-default"
            title="Back"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            disabled
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft/50 disabled:cursor-default"
            title="Forward"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => setSidebarVisible((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
            title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
          >
            <PanelLeft size={14} />
          </button>
        </div>

        {/* Active task label (tiny, centered-ish, non-draggable tooltip area) */}
        {activeTicket && (
          <div data-tauri-drag-region className="mx-3 flex items-center gap-2 min-w-0 truncate text-[12.5px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground-soft shrink-0">{activeTicket.identifier}</span>
            <span className="text-foreground truncate tracking-tight">{activeTicket.title}</span>
          </div>
        )}

        <div data-tauri-drag-region className="flex-1" />

        {/* Drawer toggles, right-aligned */}
        {activeTicket && (
          <nav className="titlebar-no-drag flex items-center gap-0.5">
            {drawerButtons.map((btn) => {
              const active = openDrawer === btn.key;
              const showsTokenPrompt = !!btn.needsToken && !btn.enabled;
              const handleClick = () => {
                if (btn.enabled) {
                  setOpenDrawer(active ? null : btn.key);
                } else if (showsTokenPrompt) {
                  setSettingsOpen(true);
                }
              };
              return (
                <button
                  key={btn.key}
                  onClick={handleClick}
                  title={showsTokenPrompt ? `${btn.label}: add a token in Settings` : `${btn.label}  ${btn.shortcut}`}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors relative ${
                    !btn.enabled && !showsTokenPrompt
                      ? "text-muted-foreground-soft/30 cursor-not-allowed"
                      : showsTokenPrompt
                        ? "text-muted-foreground-soft/60 hover:text-foreground hover:bg-surface/70"
                        : active
                          ? "bg-surface text-primary"
                          : "text-muted-foreground-soft hover:text-foreground hover:bg-surface/70"
                  }`}
                >
                  {btn.icon}
                  {showsTokenPrompt && (
                    <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-warning" />
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {/* Main — flat, full-width, sidebar flush */}
      <div className="flex flex-1 min-h-0">
        <div
          className="shrink-0 overflow-hidden"
          style={{
            width: sidebarVisible ? 268 : 0,
            transition: "width 220ms cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          <div
            style={{
              width: 268,
              height: "100%",
              transform: sidebarVisible ? "translateX(0)" : "translateX(-24px)",
              opacity: sidebarVisible ? 1 : 0,
              transition: "transform 220ms cubic-bezier(0.32, 0.72, 0, 1), opacity 180ms ease",
            }}
          >
            <WorktreeSidebar
              tasks={tickets}
              activeTaskId={activeTicketId}
              onSelectTask={(id) => setActiveTicketId((prev) => prev === id ? null : id)}
              onCreateBlankTask={handleCreateBlankTask}
              onImportedTask={handleImportedTask}
              onDeleteTask={handleDeleteTask}
            />
          </div>
        </div>
        <main className="flex-1 min-w-0 flex bg-background text-foreground">
          <div className="flex-1 min-w-0">
            <TaskView
              activeTask={activeTicket}
              openDrawer={openDrawer}
            />
          </div>
          <div
            className="shrink-0 flex flex-col overflow-hidden relative"
            style={{
              width: openDrawer && activeTicket ? drawerWidths[openDrawer] : 0,
              boxShadow: openDrawer ? "inset 1px 0 0 0 oklch(0.93 0.004 60)" : "none",
              transition: resizing ? "none" : "width 220ms cubic-bezier(0.32, 0.72, 0, 1)",
            }}
          >
            {openDrawer && activeTicket && (
              <>
                {/* Left edge resize handle */}
                <div
                  onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
                  className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-primary/20 transition-colors"
                  title="Drag to resize"
                />
                <div
                  key={openDrawer}
                  className="h-full"
                  style={{
                    animation: resizing ? "none" : "herd-slide-in 220ms cubic-bezier(0.32, 0.72, 0, 1)",
                  }}
                >
                  <TaskView
                    activeTask={activeTicket}
                    openDrawer={openDrawer}
                    drawerOnly
                    isFullscreen={false}
                    onToggleFullscreen={() => setDrawerFullscreen(true)}
                  />
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onRerunSetup={handleRerunSetup}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        tickets={tickets}
        onSelectTicket={setActiveTicketId}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewTicket={() => { /* picker is in sidebar now */ }}
      />

      <UpdateChecker />

      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 2500,
          className: "!bg-surface-elevated !text-foreground !text-xs !ring-1 !ring-divider",
        }}
      />
    </div>
  );
}

// Reusable PR tab — embedded real browser via Tauri child webview
export function PrTab({ activeTicket, hidden }: { activeTicket: TicketCard | null; hidden: boolean }) {
  const [prInfo, setPrInfo] = useState<{ number: number; title: string; url: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPrInfo(null);
    if (!activeTicket?.branch_name) return;

    setLoading(true);
    invoke<{ number: number; title: string; url: string } | null>("check_pr_status", {
      branchName: activeTicket.branch_name,
    })
      .then((info) => setPrInfo(info))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTicket?.id]);

  useEffect(() => {
    if (!prInfo?.url || !panelRef.current || hidden) {
      invoke("hide_pr_webview").catch(() => {});
      return;
    }

    const el = panelRef.current;
    const updateBounds = () => {
      const r = el.getBoundingClientRect();
      invoke("embed_pr_webview", {
        url: prInfo.url,
        x: r.left, y: r.top, width: r.width, height: r.height,
      }).catch((e) => console.error("embed_pr_webview failed:", e));
    };

    updateBounds();

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      invoke("resize_pr_webview", {
        x: r.left, y: r.top, width: r.width, height: r.height,
      }).catch(() => {});
    });
    ro.observe(el);

    const onResize = () => updateBounds();
    window.addEventListener("resize", onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      invoke("hide_pr_webview").catch(() => {});
    };
  }, [prInfo?.url, hidden]);

  if (!activeTicket?.branch_name) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No branch for this task.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!prInfo) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-1">
          <GitPullRequest size={20} className="text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">No PR found yet</p>
          <p className="text-xs text-muted-foreground/60 font-mono">{activeTicket.branch_name}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b shrink-0 px-5 py-2 flex items-center gap-2.5">
        <GitPullRequest size={13} className="text-muted-foreground-soft" />
        <span className="font-mono text-[11px] text-muted-foreground-soft tabular-nums">#{prInfo.number}</span>
        <span className="text-[13px] text-foreground truncate flex-1 tracking-tight">{prInfo.title}</span>
        <button
          onClick={() => window.open(prInfo.url, "_blank")}
          className="flex items-center gap-1 h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground rounded-md hover:bg-surface transition-colors"
          title="Open in external browser"
        >
          <ExternalLink size={11} />
        </button>
      </div>
      <div ref={panelRef} className="flex-1 bg-white" />
    </div>
  );
}


