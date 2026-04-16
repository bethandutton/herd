import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Play, Square, Loader2, ExternalLink, Package, GitBranch, ChevronDown, Terminal as TerminalIcon, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import type { TicketCard } from "@/App";

interface ServiceDef { name: string; command: string }
interface ServiceStatus { id: string; script_name: string; current_branch: string | null }
interface LocalInfo {
  scripts: ServiceDef[];
  has_package_json: boolean;
  node_modules_installed: boolean;
  package_manager: string;
  local_path: string;
  current_branch: string | null;
  running: ServiceStatus[];
}

interface Props {
  ticket: TicketCard;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

function extractPort(line: string): number | null {
  const m = line.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:?(\d{4,5})(?:\D|$)/);
  if (!m) return null;
  const p = parseInt(m[1], 10);
  if (p < 1024 || p > 65535) return null;
  return p;
}

export function LocalServices({ ticket, isFullscreen, onToggleFullscreen }: Props) {
  const [info, setInfo] = useState<LocalInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portByScript, setPortByScript] = useState<Record<string, number>>({});
  const [activeRunning, setActiveRunning] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logText, setLogText] = useState<string>("");
  const menuRef = useRef<HTMLDivElement>(null);
  const didSwitchRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<LocalInfo>("local_services_info");
      setInfo(next);
      if (!activeRunning && next.running.length > 0) {
        setActiveRunning(next.running[0].script_name);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [activeRunning]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!ticket.branch_name) return;
    if (didSwitchRef.current === ticket.id) return;
    didSwitchRef.current = ticket.id;
    invoke<string>("switch_local_branch", { branch: ticket.branch_name })
      .then(() => refresh())
      .catch((e) => setError(String(e)));
  }, [ticket.id, ticket.branch_name, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => refresh(), 3000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Subscribe to ALL running services so we can pick up ports + log latest for the visible one
  useEffect(() => {
    if (!info) return;
    const unsubs: Array<Promise<() => void>> = [];
    for (const r of info.running) {
      unsubs.push(
        listen<number[]>(`service_output_${r.script_name}`, (e) => {
          const text = new TextDecoder().decode(new Uint8Array(e.payload));
          const port = extractPort(text);
          if (port) setPortByScript((prev) => prev[r.script_name] === port ? prev : { ...prev, [r.script_name]: port });
          if (r.script_name === activeRunning) {
            setLogText((prev) => (prev + text).slice(-40_000));
          }
        })
      );
    }
    return () => { for (const u of unsubs) u.then((f) => f()); };
  }, [info, activeRunning]);

  // When switching active service in log view, fetch its scrollback
  useEffect(() => {
    if (!activeRunning || !logOpen) return;
    invoke<number[]>("get_local_service_scrollback", { scriptName: activeRunning })
      .then((data) => {
        if (data?.length) {
          const text = new TextDecoder().decode(new Uint8Array(data));
          setLogText(text);
          const port = extractPort(text);
          if (port) setPortByScript((prev) => ({ ...prev, [activeRunning]: port }));
        } else {
          setLogText("");
        }
      }).catch(() => {});
  }, [activeRunning, logOpen]);

  const runningByName = new Map((info?.running ?? []).map((r) => [r.script_name, r] as const));

  const startScript = async (name: string) => {
    setStarting(name);
    setError(null);
    try {
      await invoke<string>("start_local_service", { scriptName: name });
      await refresh();
      setActiveRunning(name);
      setMenuOpen(false);
    } catch (e) {
      setError(String(e));
    } finally { setStarting(null); }
  };

  const stopScript = async (name: string) => {
    try {
      await invoke("stop_local_service", { scriptName: name });
      await refresh();
      if (activeRunning === name) {
        setActiveRunning(info?.running?.find((r) => r.script_name !== name)?.script_name ?? null);
      }
    } catch (e) { setError(String(e)); }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke<string>("install_local_deps");
      setActiveRunning("install");
      setLogOpen(true);
      const start = Date.now();
      const poll = async () => {
        await refresh();
        const still = (await invoke<LocalInfo>("local_services_info")).node_modules_installed;
        if (still) setInstalling(false);
        else if (Date.now() - start < 300_000) window.setTimeout(poll, 2000);
        else setInstalling(false);
      };
      poll();
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  const activePort = activeRunning ? portByScript[activeRunning] : undefined;
  const primaryRunning = (info?.running ?? [])[0];
  const primaryPort = primaryRunning ? portByScript[primaryRunning.script_name] : undefined;
  const previewPort = activePort ?? primaryPort;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar — script selector, play/stop, branch, open-in-browser */}
      <div className="hairline-b shrink-0 px-3 py-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-full flex items-center gap-2 h-7 px-2 rounded-md bg-surface/60 hover:bg-surface text-left transition-colors"
          >
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground-soft shrink-0">Service</span>
            <span className="text-[12.5px] text-foreground font-mono truncate">
              {activeRunning ?? (info?.scripts?.[0]?.name ?? "—")}
            </span>
            <ChevronDown size={11} className="ml-auto text-muted-foreground-soft" />
          </button>
          {menuOpen && info && (
            <div className="absolute left-0 right-0 top-9 z-40 rounded-lg bg-surface-elevated shadow-2xl ring-1 ring-divider/40 py-1 max-h-[60vh] overflow-y-auto">
              {info.scripts.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-muted-foreground-soft">No scripts in package.json</p>
              )}
              {info.scripts.map((def) => {
                const running = runningByName.has(def.name);
                return (
                  <button
                    key={def.name}
                    onClick={() => {
                      if (running) { setActiveRunning(def.name); setMenuOpen(false); }
                      else startScript(def.name);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-primary-soft transition-colors"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${running ? "bg-success" : "bg-muted-foreground-soft/30"}`} />
                    <span className="text-[12.5px] font-mono shrink-0 text-foreground">{def.name}</span>
                    <span className="text-[10.5px] text-muted-foreground-soft truncate flex-1">{def.command}</span>
                    {starting === def.name && <Loader2 size={10} className="animate-spin text-muted-foreground-soft" />}
                    {running && <span className="text-[10px] text-success uppercase tracking-[0.08em]">running</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {activeRunning && runningByName.has(activeRunning) ? (
          <button
            onClick={() => stopScript(activeRunning)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Stop service"
          >
            <Square size={10} /> Stop
          </button>
        ) : (
          <button
            onClick={() => { const first = activeRunning ?? info?.scripts?.[0]?.name; if (first) startScript(first); }}
            disabled={!info?.scripts?.length}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] bg-primary-soft text-primary hover:brightness-110 disabled:opacity-50"
            title="Start service"
          >
            <Play size={10} /> Start
          </button>
        )}

        {previewPort && (
          <button
            onClick={() => openUrl(`http://localhost:${previewPort}`).catch(() => window.open(`http://localhost:${previewPort}`, "_blank"))}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
            title={`Open localhost:${previewPort} in browser`}
          >
            <ExternalLink size={12} />
          </button>
        )}

        <button
          onClick={() => { setLogOpen(!logOpen); }}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            logOpen ? "bg-primary-soft text-primary" : "text-muted-foreground-soft hover:text-foreground hover:bg-surface"
          }`}
          title="Toggle logs"
        >
          <TerminalIcon size={12} />
        </button>
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Expand fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        )}
      </div>

      {/* Meta strip */}
      <div className="hairline-b shrink-0 px-4 py-1.5 flex items-center gap-3 text-[10.5px] text-muted-foreground-soft">
        {info?.current_branch && (
          <span className="inline-flex items-center gap-1 font-mono">
            <GitBranch size={9} /> {info.current_branch}
          </span>
        )}
        {previewPort && (
          <span className="font-mono">localhost:{previewPort}</span>
        )}
        {info && info.has_package_json && !info.node_modules_installed && (
          <button
            onClick={handleInstall}
            disabled={installing}
            className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] bg-warning/15 text-warning hover:brightness-110 disabled:opacity-60"
          >
            {installing ? <Loader2 size={10} className="animate-spin" /> : <Package size={10} />}
            {installing ? "Installing…" : `${info.package_manager} install`}
          </button>
        )}
        {info?.node_modules_installed && (
          <button
            onClick={() => refresh()}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground-soft hover:text-foreground hover:bg-surface"
            title="Refresh"
          >
            <RefreshCw size={10} />
          </button>
        )}
      </div>

      {error && (
        <div className="hairline-b shrink-0 px-4 py-2 text-[11px] text-destructive font-mono whitespace-pre-wrap">{error}</div>
      )}

      {/* Main area — iframe preview or log panel toggle */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        {previewPort ? (
          <iframe
            key={`${previewPort}-${info?.current_branch ?? ""}`}
            src={`http://localhost:${previewPort}`}
            className="flex-1 w-full border-0 bg-white"
            title="Local preview"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center px-6 text-center">
            <div>
              <p className="text-[13px] text-muted-foreground mb-1">No preview yet.</p>
              <p className="text-[11.5px] text-muted-foreground-soft">Start a service from the dropdown above.</p>
            </div>
          </div>
        )}

        {/* Log overlay, toggled */}
        {logOpen && (
          <div className="absolute inset-x-0 bottom-0 max-h-[50%] h-[220px] bg-[#0c0e14] hairline-t overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/50 text-[10px] text-muted-foreground-soft border-b border-white/5">
              <TerminalIcon size={10} />
              <span className="font-mono">{activeRunning ?? "log"}</span>
              <button onClick={() => setLogOpen(false)} className="ml-auto text-muted-foreground-soft hover:text-foreground">×</button>
            </div>
            <pre className="flex-1 overflow-y-auto px-3 py-2 text-[11.5px] leading-[1.5] font-mono text-[#e1e4eb] whitespace-pre-wrap break-words">
              {logText || "No output yet."}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
