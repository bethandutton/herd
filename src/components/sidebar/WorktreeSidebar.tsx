import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, Search, X, Loader2 } from "lucide-react";
import type { TicketCard } from "@/App";
import { StatusCircle, STATUS_CONFIG, normaliseStatus } from "@/components/board/statusIcons";
import type { StatusIconType } from "@/components/board/statusIcons";
import { LinearPicker } from "@/components/sidebar/LinearPicker";

interface Props {
  tasks: TicketCard[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onCreateBlankTask: (t: TicketCard) => void;
  onImportedTask: (t: TicketCard) => void;
  onDeleteTask: (id: string) => void;
}

function branchAsTitle(task: TicketCard): string {
  const source = task.branch_name?.trim() || task.title;
  return source.replace(/[-_/]+/g, " ").trim();
}

export function WorktreeSidebar({
  tasks, activeTaskId, onSelectTask, onCreateBlankTask, onImportedTask, onDeleteTask,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [thinkingIds, setThinkingIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);

  // Poll which tasks have actively-thinking sessions
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const activity = await invoke<Array<{ ticket_id: string; state: string }>>("get_session_activity");
        if (cancelled) return;
        const next = new Set<string>();
        for (const a of activity) if (a.state === "thinking") next.add(a.ticket_id);
        setThinkingIds((prev) => {
          if (prev.size === next.size && [...prev].every((id) => next.has(id))) return prev;
          return next;
        });
      } catch {}
    };
    const id = window.setInterval(tick, 1000);
    tick();
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Filter + sort by workflow order, most recently updated first within each status.
  const filtered = tasks.filter((t) =>
    !q ||
    t.title.toLowerCase().includes(q.toLowerCase()) ||
    t.identifier.toLowerCase().includes(q.toLowerCase()) ||
    (t.branch_name || "").toLowerCase().includes(q.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const ao = STATUS_CONFIG[normaliseStatus(a.status)]?.sortOrder ?? 99;
    const bo = STATUS_CONFIG[normaliseStatus(b.status)]?.sortOrder ?? 99;
    if (ao !== bo) return ao - bo;
    return b.updated_at.localeCompare(a.updated_at);
  });

  return (
    <aside className="hairline-r h-full w-full flex flex-col bg-surface text-foreground">
      <div className="flex h-10 shrink-0 items-center justify-between pl-4 pr-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground-soft font-medium">
          {tasks.length > 0 ? `${tasks.length} Task${tasks.length === 1 ? "" : "s"}` : "Tasks"}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              searchOpen ? "bg-primary-soft text-primary" : "text-muted-foreground-soft hover:text-foreground hover:bg-surface"
            }`}
            title="Search"
          >
            <Search size={12} />
          </button>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
            title="New task"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="shrink-0 px-3 pb-2">
          <div className="flex items-center gap-2 rounded-md bg-surface/70 px-2 py-1.5">
            <Search size={11} className="text-muted-foreground-soft shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setQ(""); setSearchOpen(false); }
              }}
              placeholder="Filter..."
              className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground-soft/70 outline-none"
            />
            {q && <button onClick={() => setQ("")} className="text-muted-foreground-soft hover:text-foreground"><X size={11} /></button>}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {tasks.length === 0 ? (
          <EmptySidebar onCreate={() => setPickerOpen(true)} />
        ) : (
          sorted.map((t) => {
            const def = STATUS_CONFIG[normaliseStatus(t.status)];
            return (
              <TaskRow
                key={t.id}
                task={t}
                statusIcon={def?.icon ?? "empty"}
                statusColor={def?.color ?? "#8b8d98"}
                isActive={t.id === activeTaskId}
                isThinking={thinkingIds.has(t.id)}
                onClick={() => onSelectTask(t.id)}
                onDelete={() => onDeleteTask(t.id)}
              />
            );
          })
        )}
      </div>

      <div className="hairline-t shrink-0 flex items-center justify-between px-4 h-8 text-[10px] text-muted-foreground-soft">
        <span className="flex items-center gap-1"><kbd className="font-mono">J</kbd><kbd className="font-mono">K</kbd><span className="ml-0.5">navigate</span></span>
        <span className="flex items-center gap-1"><kbd className="font-mono">⌘K</kbd><span>search</span></span>
      </div>

      <LinearPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onImported={(t) => { onImportedTask(t); }}
        onBlankCreated={(t) => { onCreateBlankTask(t); }}
        existingIds={new Set(tasks.map((t) => t.id))}
      />
    </aside>
  );
}

function EmptySidebar({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-display text-2xl text-muted-foreground mb-1">No tasks yet.</p>
      <p className="text-[12px] text-muted-foreground-soft mb-5 leading-relaxed">
        Each task gets its own worktree and terminal.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-primary-soft text-primary text-[12px] font-medium hover:brightness-110 transition"
      >
        <Plus size={12} /> Start one
      </button>
    </div>
  );
}

function TaskRow({
  task, statusIcon, statusColor, isActive, isThinking, onClick, onDelete,
}: {
  task: TicketCard;
  statusIcon: StatusIconType;
  statusColor: string;
  isActive: boolean;
  isThinking: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const label = branchAsTitle(task);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`relative group ${isActive ? "accent-stripe" : ""}`}
    >
      <button
        onClick={onClick}
        className={`w-full text-left pl-3 pr-7 py-2 flex items-center gap-2 transition-colors duration-75 ${
          isActive
            ? "bg-background text-foreground font-medium"
            : "text-foreground hover:bg-surface/40"
        }`}
      >
        {isThinking
          ? <Loader2 size={11} className="animate-spin shrink-0" style={{ color: statusColor }} />
          : <StatusCircle icon={statusIcon} color={statusColor} size={11} />}
        <p className={`text-[13px] leading-snug truncate tracking-tight flex-1 ${
          isActive ? "" : "font-normal"
        }`}>
          {label}
        </p>
      </button>
      {hover && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded transition-colors ${
            isActive
              ? "text-muted-foreground-soft hover:text-destructive hover:bg-destructive/10"
              : "text-muted-foreground-soft hover:text-destructive hover:bg-destructive/10"
          }`}
          title="Delete"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}
