import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { createTerminal, attachWebgl } from "@/lib/terminal";
import {
  Loader2, ExternalLink, Package, GitBranch,
  Globe, Maximize2, Minimize2, Terminal as TerminalIcon, Settings as SettingsIcon,
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
interface HerdConfig { frontend: string | null; shared: string[] }

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
  const [config, setConfig] = useState<HerdConfig | null>(null);
  const [activeTab, setActiveTab] = useState<"browser" | "terminal">("browser");
  const [starting, setStarting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const didSwitchRef = useRef<string | null>(null);
  const didAutoStartRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<LocalInfo>("local_services_info");
      setInfo(next);
    } catch (e) { setError(String(e)); }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<HerdConfig>("get_herd_config");
      setConfig(c);
    } catch { setConfig({ frontend: null, shared: [] }); }
  }, []);

  useEffect(() => { refresh(); loadConfig(); }, [refresh, loadConfig]);

  // Switch branch in _local when the active ticket changes.
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

  // Listen for port on the frontend script output.
  useEffect(() => {
    if (!info || !config?.frontend) return;
    const frontendRunning = info.running.some((r) => r.script_name === config.frontend);
    if (!frontendRunning) return;
    const p = listen<number[]>(`service_output_${config.frontend}`, (e) => {
      const text = new TextDecoder().decode(new Uint8Array(e.payload));
      const port = extractPort(text);
      if (port && !previewPort) setPreviewPort(port);
    });
    return () => { p.then((f) => f()); };
  }, [info, config, previewPort]);

  // Scan existing scrollback for port on mount.
  useEffect(() => {
    if (!info || !config?.frontend) return;
    if (!info.running.some((r) => r.script_name === config.frontend)) return;
    invoke<number[]>("get_local_service_scrollback", { scriptName: config.frontend })
      .then((data) => {
        if (!data?.length) return;
        const text = new TextDecoder().decode(new Uint8Array(data));
        const port = extractPort(text);
        if (port) setPreviewPort((p) => p ?? port);
      }).catch(() => {});
  }, [info, config]);

  // Auto-start the configured frontend script when the drawer opens and
  // dependencies are installed. Reset the port when we switch tasks.
  useEffect(() => {
    if (!info || !config?.frontend) return;
    if (!info.node_modules_installed) return;
    const running = info.running.some((r) => r.script_name === config.frontend);
    if (running) return;
    if (didAutoStartRef.current === ticket.id) return;
    didAutoStartRef.current = ticket.id;
    setPreviewPort(null);
    setStarting(true);
    invoke<string>("start_local_service", { scriptName: config.frontend })
      .then(() => refresh())
      .catch((e) => setError(String(e)))
      .finally(() => setStarting(false));
  }, [info, config, ticket.id, refresh]);

  const frontendRunning = info?.running.some((r) => r.script_name === config?.frontend);

  const stopFrontend = async () => {
    if (!config?.frontend) return;
    try {
      await invoke("stop_local_service", { scriptName: config.frontend });
      setPreviewPort(null);
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const restartFrontend = async () => {
    await stopFrontend();
    didAutoStartRef.current = null;
  };

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke<string>("install_local_deps");
      setActiveTab("terminal");
      const poll = async () => {
        const next = await invoke<LocalInfo>("local_services_info");
        setInfo(next);
        if (next.node_modules_installed) setInstalling(false);
        else window.setTimeout(poll, 2000);
      };
      poll();
    } catch (e) { setError(String(e)); setInstalling(false); }
  };

  // Config missing: signpost
  const needsFrontendConfig = config !== null && !config.frontend;

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="hairline-b shrink-0 flex items-center px-1 h-9 gap-0.5">
        <button
          onClick={() => setActiveTab("browser")}
          className={`shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] transition-colors ${
            activeTab === "browser"
              ? "bg-surface text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-surface/60"
          }`}
        >
          <Globe size={12} />
          Browser
          {previewPort && <span className="text-[10px] font-mono text-muted-foreground-soft">:{previewPort}</span>}
        </button>
        <button
          onClick={() => setActiveTab("terminal")}
          className={`shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] transition-colors ${
            activeTab === "terminal"
              ? "bg-surface text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-surface/60"
          }`}
        >
          <TerminalIcon size={12} />
          Terminal
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${frontendRunning ? "bg-success" : "bg-muted-foreground-soft/30"}`} />
        </button>

        <div className="flex-1" />

        {info?.current_branch && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground-soft font-mono mr-1">
            <GitBranch size={9} /> {info.current_branch}
          </span>
        )}
        {frontendRunning && (
          <button
            onClick={restartFrontend}
            className="shrink-0 h-7 px-2 rounded-md text-[10.5px] text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
            title="Restart dev server"
          >
            Restart
          </button>
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
        {needsFrontendConfig ? (
          <div className="h-full flex items-center justify-center text-center px-8">
            <div className="max-w-sm">
              <SettingsIcon size={20} className="text-muted-foreground-soft mx-auto mb-3" />
              <p className="text-[13px] text-foreground font-medium mb-1.5">No frontend script configured</p>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed mb-3">
                Globe runs your per-worktree dev server (e.g. <span className="font-mono">dev:app</span>).
                Open the <span className="font-medium">Play button</span> in the top header to set up <span className="font-mono">.herd.json</span>.
              </p>
            </div>
          </div>
        ) : activeTab === "browser" ? (
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
                <p className="text-[13px] text-muted-foreground mb-1">
                  {starting ? "Starting dev server…" : frontendRunning ? "Waiting for port…" : "Not running"}
                </p>
                <p className="text-[11.5px] text-muted-foreground-soft">
                  Running <span className="font-mono">{config?.frontend}</span>. Check the Terminal tab for output.
                </p>
              </div>
            </div>
          )
        ) : (
          config?.frontend ? <ServiceTerminal scriptName={config.frontend} /> : null
        )}
      </div>
    </div>
  );
}

function ServiceTerminal({ scriptName }: { scriptName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const { term, fitAddon } = createTerminal({ cursorBlink: false, disableStdin: true });
    term.open(containerRef.current);
    attachWebgl(term);
    fitAddon.fit();

    invoke<number[]>("get_local_service_scrollback", { scriptName }).then((data) => {
      if (data?.length) term.write(new TextDecoder().decode(new Uint8Array(data)));
    }).catch(() => {});

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

  return <div ref={containerRef} className="xterm-wrapper h-full w-full" style={{ backgroundColor: "var(--surface)" }} />;
}
