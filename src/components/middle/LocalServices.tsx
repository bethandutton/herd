import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  Plus, X, Loader2, ExternalLink, Package, GitBranch,
  Globe, Maximize2, Minimize2, Pin, PinOff,
} from "lucide-react";
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

function extractPort(text: string): number | null {
  const m = text.match(/localhost:(\d{4,5})/);
  if (!m) return null;
  const p = parseInt(m[1], 10);
  return p >= 1024 && p <= 65535 ? p : null;
}

export function LocalServices({ ticket, isFullscreen, onToggleFullscreen }: Props) {
  const [info, setInfo] = useState<LocalInfo | null>(null);
  const [activeTab, setActiveTab] = useState<string>("preview"); // "preview" or a script name
  const [menuOpen, setMenuOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("herd.pinnedScripts");
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const didSwitchRef = useRef<string | null>(null);

  const togglePin = (name: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      localStorage.setItem("herd.pinnedScripts", JSON.stringify([...next]));
      return next;
    });
  };

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<LocalInfo>("local_services_info");
      setInfo(next);
    } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Switch branch in _local when the active ticket changes
  useEffect(() => {
    if (!ticket.branch_name) return;
    if (didSwitchRef.current === ticket.id) return;
    didSwitchRef.current = ticket.id;
    invoke<string>("switch_local_branch", { branch: ticket.branch_name })
      .then(() => refresh())
      .catch((e) => setError(String(e)));
  }, [ticket.id, ticket.branch_name, refresh]);

  // Poll running services
  useEffect(() => {
    const id = window.setInterval(refresh, 4000);
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

  // Listen to ALL running services for port detection
  useEffect(() => {
    if (!info) return;
    const unsubs: Array<Promise<() => void>> = [];
    for (const r of info.running) {
      unsubs.push(
        listen<number[]>(`service_output_${r.script_name}`, (e) => {
          const text = new TextDecoder().decode(new Uint8Array(e.payload));
          const port = extractPort(text);
          if (port && !previewPort) setPreviewPort(port);
        })
      );
    }
    return () => { for (const u of unsubs) u.then((f) => f()); };
  }, [info, previewPort]);

  // Also scan existing scrollback for ports on mount
  useEffect(() => {
    if (!info) return;
    for (const r of info.running) {
      invoke<number[]>("get_local_service_scrollback", { scriptName: r.script_name })
        .then((data) => {
          if (!data?.length) return;
          const text = new TextDecoder().decode(new Uint8Array(data));
          const port = extractPort(text);
          if (port) setPreviewPort((p) => p ?? port);
        }).catch(() => {});
    }
  }, [info]);

  const runningNames = new Set((info?.running ?? []).map((r) => r.script_name));

  const startScript = async (name: string) => {
    setStarting(name);
    setError(null);
    try {
      await invoke<string>("start_local_service", { scriptName: name });
      await refresh();
      setActiveTab(name);
      setMenuOpen(false);
    } catch (e) { setError(String(e)); }
    finally { setStarting(null); }
  };

  const stopScript = async (name: string) => {
    try {
      await invoke("stop_local_service", { scriptName: name });
      await refresh();
      if (activeTab === name) setActiveTab("preview");
    } catch (e) { setError(String(e)); }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke<string>("install_local_deps");
      setActiveTab("install");
      const poll = async () => {
        const next = await invoke<LocalInfo>("local_services_info");
        setInfo(next);
        if (next.node_modules_installed) setInstalling(false);
        else window.setTimeout(poll, 2000);
      };
      poll();
    } catch (e) { setError(String(e)); setInstalling(false); }
  };

  // Build tab list: preview + each running service
  const serviceTabs = (info?.running ?? []).map((r) => r.script_name);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="hairline-b shrink-0 flex items-center px-1 h-9 gap-0.5">
        {/* Preview tab — always first */}
        <button
          onClick={() => setActiveTab("preview")}
          className={`shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] transition-colors ${
            activeTab === "preview"
              ? "bg-surface text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-surface/60"
          }`}
        >
          <Globe size={12} />
          Preview
          {previewPort && (
            <span className="text-[10px] font-mono text-muted-foreground-soft">:{previewPort}</span>
          )}
        </button>

        {/* Running service tabs */}
        {serviceTabs.map((name) => (
          <div key={name} className="shrink-0 flex items-center">
            <button
              onClick={() => setActiveTab(name)}
              className={`flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-l-md text-[12px] transition-colors ${
                activeTab === name
                  ? "bg-surface text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface/60"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
              <span className="font-mono">{name}</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); stopScript(name); }}
              className={`h-7 px-1 rounded-r-md text-muted-foreground-soft hover:text-destructive transition-colors ${
                activeTab === name ? "bg-surface" : "hover:bg-surface/60"
              }`}
              title={`Stop ${name}`}
            >
              <X size={10} />
            </button>
          </div>
        ))}

        {/* Plus button — start a new service */}
        <div className="relative shrink-0 overflow-visible" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface/60 transition-colors"
            title="Start a service"
          >
            {starting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />}
          </button>
          {menuOpen && info && (
            <div className="absolute left-0 top-9 z-[100] w-72 rounded-lg bg-surface-elevated shadow-2xl ring-1 ring-divider/40 py-1 max-h-[50vh] overflow-y-auto">
              {info.scripts.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-muted-foreground-soft">No scripts in package.json</p>
              )}
              {[...info.scripts]
                .sort((a, b) => {
                  const ap = pinned.has(a.name) ? 0 : 1;
                  const bp = pinned.has(b.name) ? 0 : 1;
                  return ap - bp;
                })
                .map((def, i, arr) => {
                  const running = runningNames.has(def.name);
                  const isPinned = pinned.has(def.name);
                  const showDivider = i > 0 && isPinned !== pinned.has(arr[i - 1].name);
                  return (
                    <div key={def.name}>
                      {showDivider && <div className="mx-2 my-1 h-px bg-divider" />}
                      <div className="flex items-center hover:bg-primary-soft transition-colors">
                        <button
                          onClick={() => running ? (() => { setActiveTab(def.name); setMenuOpen(false); })() : startScript(def.name)}
                          disabled={starting === def.name}
                          className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left min-w-0"
                        >
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${running ? "bg-success" : "bg-muted-foreground-soft/30"}`} />
                          <span className="text-[12.5px] font-mono text-foreground shrink-0">{def.name}</span>
                          <span className="text-[10px] text-muted-foreground-soft truncate flex-1">{def.command}</span>
                          {running && <span className="text-[9px] uppercase tracking-wider text-success shrink-0">running</span>}
                          {starting === def.name && <Loader2 size={10} className="animate-spin text-muted-foreground-soft shrink-0" />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); togglePin(def.name); }}
                          className={`shrink-0 flex h-6 w-6 items-center justify-center rounded mr-1 transition-colors ${
                            isPinned
                              ? "text-primary hover:text-primary/70"
                              : "text-muted-foreground-soft/40 hover:text-muted-foreground"
                          }`}
                          title={isPinned ? "Unpin" : "Pin to top"}
                        >
                          {isPinned ? <PinOff size={10} /> : <Pin size={10} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side controls */}
        {info?.current_branch && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground-soft font-mono mr-1">
            <GitBranch size={9} /> {info.current_branch}
          </span>
        )}
        {previewPort && (
          <button
            onClick={() => openUrl(`http://localhost:${previewPort}`).catch(() => window.open(`http://localhost:${previewPort}`, "_blank"))}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
            title={`Open localhost:${previewPort} in browser`}
          >
            <ExternalLink size={11} />
          </button>
        )}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
        )}
      </div>

      {/* Install deps banner */}
      {info && info.has_package_json && !info.node_modules_installed && (
        <div className="hairline-b shrink-0 px-4 py-2 flex items-center gap-3">
          <Package size={14} className="text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11.5px] text-foreground">Dependencies not installed</p>
          </div>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="inline-flex items-center gap-1 h-6 px-2.5 text-[11px] rounded-md bg-primary-soft text-primary hover:brightness-110 disabled:opacity-60"
          >
            {installing ? <Loader2 size={10} className="animate-spin" /> : null}
            {installing ? "Installing..." : `${info.package_manager} install`}
          </button>
        </div>
      )}

      {error && (
        <div className="hairline-b shrink-0 px-4 py-2 text-[11px] text-destructive">{error}</div>
      )}

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === "preview" ? (
          previewPort ? (
            <iframe
              key={`${previewPort}-${info?.current_branch ?? ""}`}
              src={`http://localhost:${previewPort}`}
              className="h-full w-full border-0 bg-white"
              title="Local preview"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-center px-6">
              <div>
                <Globe size={20} className="text-muted-foreground-soft mx-auto mb-2" />
                <p className="text-[13px] text-muted-foreground mb-1">No preview yet</p>
                <p className="text-[11.5px] text-muted-foreground-soft">
                  Start a dev server with the <Plus size={10} className="inline" /> button above.
                </p>
              </div>
            </div>
          )
        ) : (
          <ServiceTerminal scriptName={activeTab} />
        )}
      </div>
    </div>
  );
}

function ServiceTerminal({ scriptName }: { scriptName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      theme: { background: "#0c0e14", foreground: "#e1e4eb" },
      convertEol: true,
      scrollback: 10000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    // Load existing scrollback
    invoke<number[]>("get_local_service_scrollback", { scriptName }).then((data) => {
      if (data?.length) term.write(new TextDecoder().decode(new Uint8Array(data)));
    }).catch(() => {});

    // Stream live output
    const unlistenPromise = listen<number[]>(`service_output_${scriptName}`, (e) => {
      term.write(new TextDecoder().decode(new Uint8Array(e.payload)));
    });

    const ro = new ResizeObserver(() => fitAddon.fit());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      unlistenPromise.then((f) => f());
      term.dispose();
    };
  }, [scriptName]);

  return <div ref={containerRef} className="h-full w-full p-1" style={{ backgroundColor: "#0c0e14" }} />;
}
