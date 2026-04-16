import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Toaster, toast } from "sonner";
import {
  ListChecks,
  GitPullRequest,
  Globe,
  SquareTerminal,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ChevronDown,
  Plus,
  Trash2,
  Settings as SettingsIcon,
} from "lucide-react";
import { WorktreeSidebar } from "@/components/sidebar/WorktreeSidebar";
import { TaskView } from "@/components/middle/TaskView";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { UpdateChecker } from "@/components/UpdateChecker";

type AppView = "loading" | "onboarding" | "main";
export type Tab = "plan" | "session" | "local" | "pr";

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

const WORKING_STATUSES = ["in_progress", "human_input", "waiting_for_review", "ready_to_merge"];

export default function App() {
  const [view, setView] = useState<AppView>("loading");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [tickets, setTickets] = useState<TicketCard[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [repo, setRepo] = useState<RepoInfo | null>(null);
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

  const activeTicket = tickets.find((t) => t.id === activeTicketId) || null;

  useEffect(() => {
    if (!activeTicket) return;
    const hasBranchNow = !!activeTicket.branch_name;
    const needsBranch = activeTab === "pr" || activeTab === "local";
    if (needsBranch && !hasBranchNow) setActiveTab("plan");
  }, [activeTicketId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.metaKey && e.key === "k") { e.preventDefault(); setCommandPaletteOpen((v) => !v); return; }
      if (e.metaKey && e.key === ",") { e.preventDefault(); setSettingsOpen(true); return; }
      if (e.key === "Escape") {
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        return;
      }
      if (e.metaKey && e.key === "1") { e.preventDefault(); setActiveTab("plan"); return; }
      if (e.metaKey && e.key === "2") { e.preventDefault(); setActiveTab("session"); return; }
      if (e.metaKey && e.key === "3") { e.preventDefault(); setActiveTab("local"); return; }
      if (e.metaKey && e.key === "4") { e.preventDefault(); setActiveTab("pr"); return; }

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
    setActiveTab("plan");
  }, [refreshTasks]);

  const handleImportedTask = useCallback(async (t: TicketCard) => {
    await refreshTasks();
    setActiveTicketId(t.id);
    setActiveTab("plan");
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

  const hasBranch = !!activeTicket?.branch_name && WORKING_STATUSES.includes(activeTicket?.status || "");
  const hasTicket = !!activeTicket;

  const tabs: { key: Tab; label: string; icon: React.ReactNode; enabled: boolean; disabledReason: string }[] = [
    { key: "plan",    label: "Task",          icon: <ListChecks size={13} />,     enabled: hasTicket, disabledReason: "Select a task to view" },
    { key: "session", label: "Terminal",      icon: <SquareTerminal size={13} />, enabled: hasTicket, disabledReason: "Select a task first" },
    { key: "local",   label: "Local Preview", icon: <Globe size={13} />,          enabled: hasBranch, disabledReason: "Start work on a task to enable local preview" },
    { key: "pr",      label: "GitHub PR",     icon: <GitPullRequest size={13} />, enabled: hasBranch, disabledReason: "Start work on a task to see its PR" },
  ];

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top header — full-width, draggable, hairline bottom */}
      <header data-tauri-drag-region className="hairline-b flex shrink-0 items-center h-11 pl-[84px] pr-3">
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

        <div className="titlebar-no-drag flex items-center ml-2">
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
        </div>

        {/* Hairline separator before tabs */}
        {activeTicket && (
          <div className="mx-2 h-4 w-px bg-divider" />
        )}

        {/* Tab row inline */}
        {activeTicket && (
          <nav className="titlebar-no-drag flex items-center gap-0.5">
            {tabs.map((tab, i) => (
              <div key={tab.key} className="relative group">
                <button
                  onClick={() => tab.enabled && setActiveTab(tab.key)}
                  disabled={!tab.enabled}
                  className={`flex items-center gap-1.5 px-2.5 h-7 text-[12.5px] rounded-md transition-all duration-100 tracking-tight ${
                    !tab.enabled
                      ? "text-muted-foreground-soft/40 cursor-not-allowed"
                      : activeTab === tab.key
                        ? "bg-surface text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-surface/70"
                  }`}
                >
                  <span className={!tab.enabled ? "opacity-40" : activeTab === tab.key ? "text-primary" : "text-muted-foreground-soft"}>{tab.icon}</span>
                  {tab.label}
                  <span className={`ml-1 text-[10px] font-mono tabular-nums ${
                    activeTab === tab.key ? "text-muted-foreground" : "text-muted-foreground-soft/60"
                  }`}>⌘{i + 1}</span>
                </button>
              </div>
            ))}
          </nav>
        )}

        <div className="flex-1" />
      </header>

      {/* Main — flat, full-width, sidebar flush */}
      <div className="flex flex-1 min-h-0">
        <WorktreeSidebar
          tasks={tickets}
          activeTaskId={activeTicketId}
          onSelectTask={setActiveTicketId}
          onCreateBlankTask={handleCreateBlankTask}
          onImportedTask={handleImportedTask}
          onDeleteTask={handleDeleteTask}
          onTasksChanged={refreshTasks}
        />
        <main data-theme="light" className="flex-1 min-w-0 bg-background text-foreground">
          <TaskView
            activeTask={activeTicket}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
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

// Local preview
export function LocalPreviewTab({ activeTicket }: { activeTicket: TicketCard | null }) {
  const [previewPort, setPreviewPort] = useState(3000);

  useEffect(() => {
    invoke<{ preview_port: number } | null>("get_active_repo").then((repo) => {
      if (repo) setPreviewPort(repo.preview_port);
    }).catch(() => {});
  }, []);

  if (!activeTicket) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Select a task to preview.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b shrink-0 px-5 py-2 flex items-center gap-2">
        <Globe size={13} className="text-muted-foreground-soft" />
        <span className="font-mono text-[11px] text-muted-foreground-soft">localhost:{previewPort}</span>
      </div>
      <iframe
        src={`http://localhost:${previewPort}`}
        className="flex-1 w-full border-0 bg-white"
        title="Local preview"
      />
    </div>
  );
}

