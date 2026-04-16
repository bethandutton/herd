import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { FolderOpen } from "lucide-react";

type Step = "welcome" | "github" | "repo" | "done";

interface RepoInfo {
  name: string;
  primary_branch: string;
  worktrees_dir: string;
}

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [githubToken, setGithubToken] = useState("");

  const [repoPath, setRepoPath] = useState("");
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);

  const saveGithub = async () => {
    setError(null);
    setLoading(true);
    try {
      if (githubToken.trim()) {
        await invoke("store_token", { key: "github_api_token", value: githubToken });
      }
      setStep("repo");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

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
      setStep("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-tauri-drag-region className="flex h-screen w-screen items-center justify-center bg-background relative overflow-hidden">
      {/* Ambient warm glow */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary opacity-[0.05] blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-primary opacity-[0.03] blur-3xl" />

      <div className="relative w-full max-w-md px-10 py-8">
        {step === "welcome" && (
          <div className="space-y-6 text-center">
            <h1 className="font-display text-6xl tracking-[-0.02em] text-foreground">
              Herd<span className="font-display-italic text-primary">.</span>
            </h1>
            <p className="text-[14px] text-muted-foreground leading-[1.6] max-w-sm mx-auto">
              A workspace for running terminals across Git worktrees.
              Each task gets its own branch and terminal. Spawn Claude Code, Codex,
              or any agent you like, and switch between them without losing flow.
            </p>
            <Button onClick={() => setStep("github")} className="w-full">
              Get started
            </Button>
          </div>
        )}

        {step === "github" && (
          <div className="space-y-4">
            <h2 className="font-display text-3xl tracking-[-0.015em]">
              Connect GitHub <span className="font-display-italic text-muted-foreground-soft text-xl">optional</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Paste a token with <code className="font-mono bg-surface/60 px-1 rounded text-[12px]">repo</code> scope
              to see PR status and comments in Herd.{" "}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=Herd"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                Create one →
              </a>
            </p>
            <PasswordInput
              placeholder="ghp_..."
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("welcome")}>Back</Button>
              <Button variant="ghost" onClick={() => setStep("repo")}>Skip</Button>
              <Button onClick={saveGithub} disabled={loading} className="flex-1">
                {loading ? "Saving..." : "Continue"}
              </Button>
            </div>
          </div>
        )}

        {step === "repo" && (
          <div className="space-y-4">
            <h2 className="font-display text-3xl tracking-[-0.015em]">Pick your project</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Choose a local Git clone. Herd auto-detects the default branch and creates
              worktrees alongside it.
            </p>

            <button
              onClick={pickFolder}
              className="flex w-full items-center gap-3 rounded-md bg-surface-elevated/60 px-3 py-3 text-left hover:bg-surface-elevated transition-colors"
            >
              <FolderOpen size={18} className="shrink-0 text-muted-foreground" />
              {repoPath ? (
                <span className="font-mono text-xs text-foreground truncate">{repoPath}</span>
              ) : (
                <span className="text-sm text-muted-foreground">Choose a folder...</span>
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
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("github")}>Back</Button>
              <Button onClick={setupRepo} disabled={!repoInfo || loading} className="flex-1">
                {loading ? "Setting up..." : "Complete setup"}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-5 text-center">
            <h2 className="font-display text-4xl tracking-[-0.02em]">
              All <span className="font-display-italic text-primary">set.</span>
            </h2>
            <p className="text-[14px] text-muted-foreground">Your workspace is ready.</p>
            <Button onClick={onComplete} className="w-full">Open Herd</Button>
          </div>
        )}
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
