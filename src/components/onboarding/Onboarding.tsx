import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";

interface RepoInfo {
  name: string;
  primary_branch: string;
  worktrees_dir: string;
}

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [repoPath, setRepoPath] = useState("");
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);

  const pickFolder = async () => {
    setError(null);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const path = selected as string;
      setRepoPath(path);
      const info = await invoke<RepoInfo>("detect_repo_info", { path });
      setRepoInfo(info);
    } catch (e) {
      setError(String(e));
    }
  };

  const setupRepo = async () => {
    if (!repoInfo) return;
    setError(null);
    setLoading(true);
    try {
      await invoke("create_repo", {
        name: repoInfo.name,
        path: repoPath,
        worktreesDir: repoInfo.worktrees_dir,
        primaryBranch: repoInfo.primary_branch,
        previewPort: 3000,
      });
      onComplete();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-tauri-drag-region className="flex h-screen w-screen items-center justify-center bg-background relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary opacity-[0.05] blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-primary opacity-[0.03] blur-3xl" />

      <div className="relative w-full max-w-md px-10 py-8 space-y-6 text-center">
        <h1 className="font-display text-6xl tracking-[-0.02em] text-foreground">
          Herd<span className="font-display-italic text-primary">.</span>
        </h1>
        <p className="text-[14px] text-muted-foreground leading-[1.6] max-w-sm mx-auto">
          A workspace for running terminals across Git worktrees.
          Each task gets its own branch and terminal. Spawn Claude Code, Codex, or any agent you like,
          and switch between them without losing flow.
        </p>

        <div className="pt-2 space-y-3 text-left">
          <button
            onClick={pickFolder}
            className="flex w-full items-center gap-3 rounded-md bg-surface-elevated/60 px-3 py-3 hover:bg-surface-elevated transition-colors"
          >
            <FolderOpen size={18} className="shrink-0 text-muted-foreground" />
            {repoPath ? (
              <span className="font-mono text-xs text-foreground truncate">{repoPath}</span>
            ) : (
              <span className="text-sm text-muted-foreground">Pick a local Git clone</span>
            )}
          </button>

          {repoInfo && (
            <div className="rounded-md bg-surface-elevated/40 px-3 py-2 space-y-1">
              <Row label="Name" value={repoInfo.name} mono />
              <Row label="Branch" value={repoInfo.primary_branch} mono />
              <Row label="Worktrees" value={repoInfo.worktrees_dir} mono />
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <Button onClick={setupRepo} disabled={!repoInfo || loading} className="w-full">
          {loading ? "Setting up..." : "Open workspace"}
        </Button>

        <p className="text-[11px] text-muted-foreground-soft/80">
          You can connect GitHub and Linear later from Settings.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-xs text-foreground truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
