import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, Search, X, ChevronDown, ChevronRight } from "lucide-react";
import type { TicketCard } from "@/App";
import { StatusCircle, STATUS_CONFIG, STATUS_ORDER, normaliseStatus } from "@/components/board/statusIcons";
import { LinearPicker } from "@/components/sidebar/LinearPicker";

interface Props {
  tasks: TicketCard[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onCreateBlankTask: (t: TicketCard) => void;
  onImportedTask: (t: TicketCard) => void;
  onDeleteTask: (id: string) => void;
  onTasksChanged: () => void;
}

const COLLAPSED_KEY = "herd.sidebar.collapsedSections";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function branchAsTitle(task: TicketCard): string {
  const source = task.branch_name?.trim() || task.title;
  return source.replace(/[-_/]+/g, " ").trim();
}

export function WorktreeSidebar({
  tasks, activeTaskId, onSelectTask, onCreateBlankTask, onImportedTask, onDeleteTask, onTasksChanged,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(collapsed)));
  }, [collapsed]);

  const toggleCollapse = (status: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  const filtered = tasks.filter((t) =>
    !q ||
    t.title.toLowerCase().includes(q.toLowerCase()) ||
    t.identifier.toLowerCase().includes(q.toLowerCase()) ||
    (t.branch_name || "").toLowerCase().includes(q.toLowerCase())
  );

  const grouped: Record<string, TicketCard[]> = {};
  for (const status of STATUS_ORDER) grouped[status] = [];
  for (const t of filtered) {
    const key = normaliseStatus(t.status);
    (grouped[key] ||= []).push(t);
  }
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  const handleTaskDragStart = (taskId: string) => (e: React.DragEvent) => {
    setDragTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", taskId); } catch {}
  };

  const handleTaskDragEnd = () => {
    setDragTaskId(null);
    setDropTargetStatus(null);
  };

  const handleSectionDragOver = (status: string) => (e: React.DragEvent) => {
    if (!dragTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetStatus !== status) setDropTargetStatus(status);
  };

  const handleSectionDrop = (status: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = dragTaskId;
    setDragTaskId(null);
    setDropTargetStatus(null);
    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (normaliseStatus(task.status) === status) return;
    try {
      await invoke("update_ticket_status", { ticketId: taskId, status });
      onTasksChanged();
    } catch (err) {
      console.error("update_ticket_status failed:", err);
    }
  };

  return (
    <aside className="hairline-r w-[268px] min-w-[248px] shrink-0 flex flex-col bg-background">
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
          STATUS_ORDER.map((status) => {
            const items = grouped[status] || [];
            const def = STATUS_CONFIG[status];
            const isCollapsed = collapsed.has(status);
            const isDropTarget = dropTargetStatus === status;
            return (
              <div
                key={status}
                onDragOver={handleSectionDragOver(status)}
                onDrop={handleSectionDrop(status)}
                className={`mb-2 last:mb-1 transition-colors rounded-sm ${
                  isDropTarget ? "bg-primary-soft/50" : ""
                }`}
              >
                <button
                  onClick={() => toggleCollapse(status)}
                  className="flex w-full items-center gap-1.5 pl-2 pr-3 h-7 hover:bg-surface/40 transition-colors rounded-sm"
                >
                  {isCollapsed
                    ? <ChevronRight size={11} className="text-muted-foreground-soft/70" />
                    : <ChevronDown size={11} className="text-muted-foreground-soft/70" />}
                  <StatusCircle icon={def?.icon ?? "empty"} color={def?.color ?? "#8b8d98"} size={10} />
                  <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground-soft font-medium">
                    {def?.label ?? status}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground-soft ml-auto">{items.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="min-h-[4px]">
                    {items.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        isActive={t.id === activeTaskId}
                        isDragging={dragTaskId === t.id}
                        onClick={() => onSelectTask(t.id)}
                        onDelete={() => onDeleteTask(t.id)}
                        onDragStart={handleTaskDragStart(t.id)}
                        onDragEnd={handleTaskDragEnd}
                      />
                    ))}
                    {items.length === 0 && (
                      <div className={`mx-2 my-0.5 h-6 rounded border border-dashed ${
                        isDropTarget ? "border-primary/50" : "border-transparent"
                      } transition-colors`} />
                    )}
                  </div>
                )}
              </div>
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
  task, isActive, isDragging, onClick, onDelete, onDragStart, onDragEnd,
}: {
  task: TicketCard;
  isActive: boolean;
  isDragging: boolean;
  onClick: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [hover, setHover] = useState(false);
  const label = branchAsTitle(task);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`relative group cursor-grab active:cursor-grabbing transition-opacity ${
        isActive ? "accent-stripe" : ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <button
        onClick={onClick}
        className={`w-full text-left pl-4 pr-7 py-2 flex items-center transition-colors duration-75 ${
          isActive
            ? "bg-surface/80 text-foreground"
            : "text-foreground hover:bg-surface/40"
        }`}
      >
        <p className={`text-[13px] leading-snug truncate tracking-tight ${
          isActive ? "font-medium" : "font-normal"
        }`}>
          {label}
        </p>
      </button>
      {hover && !isDragging && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-muted-foreground-soft hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Delete"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}
