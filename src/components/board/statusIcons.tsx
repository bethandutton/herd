export type StatusIconType = "dashed" | "empty" | "quarter" | "half" | "three-quarter" | "full" | "alert";

export interface StatusDef {
  label: string;
  sortOrder: number;
  icon: StatusIconType;
  color: string;
}

// Fixed workflow order — no automation, user drags tasks between stages.
export const WORKFLOW: StatusDef[] & { byKey?: Record<string, StatusDef> } = [] as any;

// Top-to-bottom: fresh work first, closer-to-merge last.
export const STATUS_CONFIG: Record<string, StatusDef> = {
  todo:                 { label: "To do",                sortOrder: 0, icon: "dashed",        color: "#8b8d98" },
  working:              { label: "Working",              sortOrder: 1, icon: "quarter",       color: "#e5a83b" },
  requires_attention:   { label: "Requires attention",   sortOrder: 2, icon: "alert",         color: "#e5484d" },
  waiting_for_feedback: { label: "Waiting for feedback", sortOrder: 3, icon: "half",          color: "#6e6ade" },
  ready_for_merge:      { label: "Ready for merge",      sortOrder: 4, icon: "three-quarter", color: "#30a46c" },
  merged:               { label: "Merged",               sortOrder: 5, icon: "full",          color: "#30a46c" },
};

// Ordered list of status keys — used by the sidebar to render sections in a fixed order
export const STATUS_ORDER: string[] = Object.entries(STATUS_CONFIG)
  .sort((a, b) => a[1].sortOrder - b[1].sortOrder)
  .map(([k]) => k);

// Map any legacy status value in the DB to a current stage.
export function normaliseStatus(raw: string | null | undefined): string {
  if (!raw) return "todo";
  if (STATUS_CONFIG[raw]) return raw;
  const legacy: Record<string, string> = {
    backlog: "todo",
    planning: "todo",
    in_progress: "working",
    human_input: "requires_attention",
    attention_required: "requires_attention",
    waiting_for_review: "waiting_for_feedback",
    in_review: "waiting_for_feedback",
    ready_to_test: "waiting_for_feedback",
    ready_to_merge: "ready_for_merge",
    done: "ready_for_merge",
  };
  return legacy[raw] ?? "todo";
}

export function StatusCircle({ icon, color, size = 14 }: { icon: StatusIconType; color: string; size?: number }) {
  const r = 5;
  const cx = 7;
  const cy = 7;
  const circumference = 2 * Math.PI * r;

  if (icon === "alert") {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill={color} />
        <line x1="7" y1="4.5" x2="7" y2="7.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx={7} cy={9.5} r={0.75} fill="white" />
      </svg>
    );
  }

  if (icon === "full") {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill={color} />
        <path d="M5.5 7l1.2 1.2 2.3-2.4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }

  if (icon === "dashed") {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2.5 2.5" opacity="0.55" />
      </svg>
    );
  }

  if (icon === "empty") {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="1.5" opacity="0.45" />
      </svg>
    );
  }

  const fillPct = icon === "quarter" ? 0.25 : icon === "half" ? 0.5 : 0.75;
  const dashLen = circumference * fillPct;
  const gapLen = circumference - dashLen;

  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="1.5" opacity="0.22" />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={`${dashLen} ${gapLen}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </svg>
  );
}

export const PRIORITY_LABELS: Record<number, string> = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};
