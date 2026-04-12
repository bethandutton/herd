import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle, AlertCircle } from "lucide-react";

interface ClaudeCodeStatus {
  installed: boolean;
  path: string | null;
  authenticated: boolean;
}

export function MiddleColumn() {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus | null>(null);

  useEffect(() => {
    invoke<ClaudeCodeStatus>("check_claude_code")
      .then(setClaudeStatus)
      .catch(() => setClaudeStatus({ installed: false, path: null, authenticated: false }));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar */}
      <div className="titlebar-drag-region flex h-8 shrink-0 items-center border-b border-border px-3">
        <span className="titlebar-no-drag text-[13px] text-muted-foreground">
          &nbsp;
        </span>
      </div>

      {/* Empty state with setup checklist */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-foreground font-medium">Getting started</p>
            <p className="text-xs text-muted-foreground">
              Loop is syncing your Linear tickets. Pick one from the board on the left to start working.
            </p>
          </div>

          {/* Setup checklist */}
          <div className="rounded-md border border-border bg-surface px-4 py-3 space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Setup</p>

            <SetupItem
              done={true}
              label="Linear connected"
            />

            <SetupItem
              done={true}
              label="Repository configured"
            />

            {claudeStatus && (
              <div className="space-y-1">
                <SetupItem
                  done={claudeStatus.installed}
                  label={claudeStatus.installed ? "Claude Code installed" : "Claude Code not found"}
                />
                {!claudeStatus.installed && (
                  <p className="text-[11px] text-muted-foreground pl-5">
                    Install it:{" "}
                    <code className="font-mono bg-background px-1 rounded text-[10px]">
                      npm install -g @anthropic-ai/claude-code
                    </code>
                  </p>
                )}
                {claudeStatus.installed && (
                  <SetupItem
                    done={claudeStatus.authenticated}
                    label={claudeStatus.authenticated ? "Claude Code authenticated" : "Claude Code needs login"}
                  />
                )}
                {claudeStatus.installed && !claudeStatus.authenticated && (
                  <p className="text-[11px] text-muted-foreground pl-5">
                    Run{" "}
                    <code className="font-mono bg-background px-1 rounded text-[10px]">
                      claude auth login
                    </code>{" "}
                    in your terminal
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Settings: <kbd className="font-mono bg-surface border border-border rounded px-1 text-[10px]">⌘,</kbd>
          </p>
        </div>
      </div>
    </div>
  );
}

function SetupItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {done ? (
        <CheckCircle size={14} className="text-success shrink-0" />
      ) : (
        <AlertCircle size={14} className="text-warning shrink-0" />
      )}
      <span className={`text-xs ${done ? "text-muted-foreground" : "text-foreground"}`}>
        {label}
      </span>
    </div>
  );
}
