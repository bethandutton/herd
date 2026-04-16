import { GitBranch } from "lucide-react";
import type { TicketCard } from "@/App";
import { StatusChip, PriorityChip } from "@/components/board/chips";

interface Props {
  ticket: TicketCard;
}

export function TaskDetail({ ticket }: Props) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="max-w-[720px] mx-auto px-10 py-14 w-full">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground-soft">
            {ticket.identifier}
          </span>
        </div>

        <h1 className="font-display text-[40px] leading-[1.1] text-foreground mb-6 tracking-[-0.02em]">
          {ticket.title}
        </h1>

        <div className="flex items-center gap-2 flex-wrap mb-10">
          <StatusChip ticket={ticket} anchorPopover />
          <PriorityChip ticket={ticket} anchorPopover />
          {(ticket as any).project && (
            <span className="text-[11px] rounded-full bg-surface/80 px-2 h-5 inline-flex items-center text-muted-foreground">
              {(ticket as any).project}
            </span>
          )}
          {ticket.tags.map((tag) => (
            <span key={tag} className="text-[11px] rounded-full bg-primary-soft px-2 h-5 inline-flex items-center text-primary">
              {tag}
            </span>
          ))}
        </div>

        {ticket.branch_name && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground mb-10">
            <GitBranch size={12} className="text-muted-foreground-soft" />
            <span className="font-mono">{ticket.branch_name}</span>
          </div>
        )}

        <div className="h-px bg-divider mb-10" />

        <p className="font-display-italic text-lg text-muted-foreground-soft leading-relaxed">
          Open the <span className="text-foreground">Terminal</span> tab to start work. The plan lives in the code.
        </p>
      </div>
    </div>
  );
}
