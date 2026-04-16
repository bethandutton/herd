import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check } from "lucide-react";
import type { TicketCard } from "@/App";
import { StatusCircle, STATUS_CONFIG, PRIORITY_LABELS, STATUS_ORDER, normaliseStatus } from "@/components/board/statusIcons";

function Popover({
  anchor, children, onClose,
}: {
  anchor: HTMLElement;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rect = anchor.getBoundingClientRect();
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        onClose();
      }
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 w-48 rounded-lg bg-surface-elevated py-1 shadow-2xl ring-1 ring-divider"
      style={{ left: rect.left, top: rect.bottom + 4 }}
    >
      {children}
    </div>
  );
}

function PriorityBars({ priority, size = 12 }: { priority: number; size?: number }) {
  if (priority === 0) return null;
  if (priority === 1) return <AlertTriangle size={size} className="text-destructive shrink-0" />;
  const filled = priority === 2 ? 3 : priority === 3 ? 2 : 1;
  const barColor = priority === 2 ? "bg-warning" : "bg-muted-foreground";
  return (
    <div className="flex items-end gap-[2px] h-3 shrink-0">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`w-[3px] rounded-sm ${i <= filled ? barColor : "bg-muted-foreground/20"}`}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </div>
  );
}

export function StatusChip({ ticket, anchorPopover }: { ticket: TicketCard; anchorPopover?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const status = normaliseStatus(ticket.status);
  const def = STATUS_CONFIG[status];
  if (!def) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { if (anchorPopover) { e.stopPropagation(); setOpen(!open); } }}
        className="inline-flex items-center gap-1.5 h-5 px-1.5 rounded-full text-[11px] font-medium"
        style={{ backgroundColor: `${def.color}1a`, color: def.color }}
        title={anchorPopover ? "Change status" : def.label}
      >
        <StatusCircle icon={def.icon} color={def.color} size={11} />
        <span>{def.label}</span>
      </button>
      {open && btnRef.current && (
        <Popover anchor={btnRef.current} onClose={() => setOpen(false)}>
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Status</div>
          {STATUS_ORDER.map((key) => {
            const config = STATUS_CONFIG[key];
            return (
              <button
                key={key}
                onClick={(e) => {
                  e.stopPropagation();
                  invoke("update_ticket_status", { ticketId: ticket.id, status: key }).catch(() => {});
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-primary/10 transition-colors duration-75"
              >
                <StatusCircle icon={config.icon} color={config.color} />
                <span className="flex-1">{config.label}</span>
                {status === key && <Check size={11} className="text-primary shrink-0" />}
              </button>
            );
          })}
        </Popover>
      )}
    </>
  );
}

export function PriorityChip({ ticket, anchorPopover }: { ticket: TicketCard; anchorPopover?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  if (!ticket.priority) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { if (anchorPopover) { e.stopPropagation(); setOpen(!open); } }}
        className="inline-flex items-center gap-1 h-5 px-1.5 rounded-full text-[11px] text-muted-foreground bg-muted-foreground/10"
        title={anchorPopover ? "Change priority" : PRIORITY_LABELS[ticket.priority]}
      >
        <PriorityBars priority={ticket.priority} />
        <span>{PRIORITY_LABELS[ticket.priority]}</span>
      </button>
      {open && btnRef.current && (
        <Popover anchor={btnRef.current} onClose={() => setOpen(false)}>
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Priority</div>
          {[
            { value: 1, label: "Urgent" },
            { value: 2, label: "High" },
            { value: 3, label: "Medium" },
            { value: 4, label: "Low" },
            { value: 0, label: "None" },
          ].map((p) => (
            <button
              key={p.value}
              onClick={(e) => {
                e.stopPropagation();
                invoke("update_ticket_priority", { ticketId: ticket.id, priority: p.value }).catch(() => {});
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-primary/10 transition-colors duration-75"
            >
              <span className="w-3 flex justify-center">
                <PriorityBars priority={p.value} />
              </span>
              <span className="flex-1">{p.label}</span>
              {ticket.priority === p.value && <Check size={11} className="text-primary shrink-0" />}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}
