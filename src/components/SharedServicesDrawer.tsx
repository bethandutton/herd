import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { createTerminal, attachWebgl } from "@/lib/terminal";
import { Plus, X, Loader2, Play, Settings as SettingsIcon, Server, Search, Pin, PinOff } from "lucide-react";

interface ServiceDef { name: string; command: string }
interface ServiceStatus { id: string; script_name: string; current_branch: string | null }
interface HerdConfig { frontend: string | null; shared: string[] }
interface SharedInfo {
  scripts: ServiceDef[];
  configured_shared: string[];
  frontend: string | null;
  has_package_json: boolean;
  node_modules_installed: boolean;
  package_manager: string;
  repo_path: string;
  running: ServiceStatus[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SharedServicesDrawer({ open, onClose }: Props) {
  const [info, setInfo] = useState<SharedInfo | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [suggested, setSuggested] = useState<HerdConfig | null>(null);
  const [menuQuery, setMenuQuery] = useState("");
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("herd.pinnedSharedScripts");
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuInputRef = useRef<HTMLInputElement>(null);

  const togglePin = (name: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      localStorage.setItem("herd.pinnedSharedScripts", JSON.stringify([...next]));
      return next;
    });
  };

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<SharedInfo>("shared_services_info");
      setInfo(next);
    } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(refresh, 4000);
    return () => window.clearInterval(id);
  }, [open, refresh]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Autofocus search when the menu opens; reset query when it closes.
  useEffect(() => {
    if (menuOpen) setTimeout(() => menuInputRef.current?.focus(), 0);
    else setMenuQuery("");
  }, [menuOpen]);

  useEffect(() => {
    if (!info) return;
    if (!activeTab && info.running.length > 0) setActiveTab(info.running[0].script_name);
    if (activeTab && !info.running.some((r) => r.script_name === activeTab)) {
      setActiveTab(info.running[0]?.script_name ?? null);
    }
  }, [info, activeTab]);

  const runningNames = new Set((info?.running ?? []).map((r) => r.script_name));
  const configuredSet = new Set(info?.configured_shared ?? []);
  const needsConfig = !!info && !info.configured_shared.length && !info.frontend;

  // Pre-fetch the suggestion when the drawer opens into the empty state, so
  // we can show the user exactly what we'd write rather than a bare CTA.
  useEffect(() => {
    if (!needsConfig || suggested || configuring) return;
    invoke<HerdConfig>("suggest_herd_config")
      .then((s) => setSuggested(s))
      .catch(() => {});
  }, [needsConfig, suggested, configuring]);

  const startScript = async (name: string) => {
    setStarting(name);
    setError(null);
    try {
      await invoke<string>("start_shared_service", { scriptName: name });
      await refresh();
      setActiveTab(name);
      setMenuOpen(false);
    } catch (e) { setError(String(e)); }
    finally { setStarting(null); }
  };

  const stopScript = async (name: string) => {
    try {
      await invoke("stop_shared_service", { scriptName: name });
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const openSetup = async () => {
    setError(null);
    try {
      if (!suggested) {
        const s = await invoke<HerdConfig>("suggest_herd_config");
        setSuggested(s);
      }
      setConfiguring(true);
    } catch (e) { setError(String(e)); }
  };

  const saveConfig = async () => {
    if (!suggested) return;
    try {
      await invoke("save_herd_config", { config: suggested });
      setConfiguring(false);
      setSuggested(null);
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  if (!open) return null;

  // Scripts that appear in the `+` menu: whatever the user configured as shared,
  // or the full list if no config yet.
  const menuScripts = info
    ? info.scripts.filter((s) => configuredSet.size === 0 || configuredSet.has(s.name))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <div
        className="w-[560px] h-full bg-surface-elevated shadow-2xl flex flex-col hairline-l"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "herd-slide-in 220ms cubic-bezier(0.32, 0.72, 0, 1)" }}
      >
        {/* Header */}
        <div className="hairline-b shrink-0 flex items-center justify-between px-3 h-11">
          <div className="flex items-center gap-2">
            <Server size={13} className="text-primary" />
            <span className="text-[12.5px] font-medium text-foreground">Shared services</span>
            <span className="text-[10px] text-muted-foreground-soft">Persistent across all branches</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={openSetup}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
              title="Configure .herd.json"
            >
              <SettingsIcon size={12} />
            </button>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface transition-colors"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Signpost / empty config card */}
        {needsConfig && !configuring && (
          <div className="shrink-0 m-3 rounded-lg bg-primary-soft/50 ring-1 ring-divider/40 px-4 py-3">
            <p className="text-[12.5px] text-foreground font-medium mb-1">One backend, many frontends</p>
            <p className="text-[11.5px] text-muted-foreground leading-relaxed mb-3">
              Shared services (API, workflow engine, DB, queues) run once from your main repo checkout —
              not per-worktree. Each task's frontend runs in its own worktree on its own port.
            </p>

            {suggested ? (
              <div className="rounded-md bg-background/60 ring-1 ring-divider/40 p-3 mb-3 space-y-2">
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground-soft">
                  Based on your <span className="font-mono">package.json</span>, we suggest
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-[10.5px] text-muted-foreground-soft w-16 shrink-0">Frontend</span>
                  {suggested.frontend ? (
                    <span className="text-[12px] font-mono text-foreground">{suggested.frontend}</span>
                  ) : (
                    <span className="text-[11px] italic text-muted-foreground-soft">
                      No obvious dev script — edit to set one
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[10.5px] text-muted-foreground-soft w-16 shrink-0">Shared</span>
                  {suggested.shared.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {suggested.shared.map((s) => (
                        <span key={s} className="text-[11px] font-mono text-foreground bg-surface rounded px-1.5 py-0.5">{s}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] italic text-muted-foreground-soft">
                      None auto-detected — add scripts to run alongside your frontend
                    </span>
                  )}
                </div>
                <p className="text-[10.5px] text-muted-foreground-soft pt-1">
                  Saved to <span className="font-mono">.herd.json</span> at the repo root — edit by hand anytime.
                </p>
              </div>
            ) : (
              <div className="rounded-md bg-background/60 ring-1 ring-divider/40 p-3 mb-3">
                <p className="text-[11px] text-muted-foreground-soft inline-flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" />
                  Scanning package.json…
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={saveConfig}
                disabled={!suggested}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:brightness-110 transition disabled:opacity-50"
              >
                Use these defaults
              </button>
              <button
                onClick={openSetup}
                disabled={!suggested}
                className="h-7 px-2.5 rounded-md text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors disabled:opacity-50"
              >
                Edit first…
              </button>
            </div>
          </div>
        )}

        {/* Configure dialog */}
        {configuring && suggested && (
          <div className="shrink-0 m-3 rounded-lg bg-surface ring-1 ring-divider/40 p-4 space-y-3">
            <p className="text-[12.5px] text-foreground font-medium">Suggested config</p>
            <div>
              <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground-soft mb-1">Frontend (Globe button)</p>
              <input
                type="text"
                value={suggested.frontend ?? ""}
                onChange={(e) => setSuggested({ ...suggested, frontend: e.target.value || null })}
                placeholder="dev:app"
                className="w-full bg-background text-foreground text-[12px] font-mono rounded-md px-2 py-1.5 ring-1 ring-divider/40 focus:outline-none focus:ring-primary"
              />
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground-soft mb-1">Shared services (Play button)</p>
              <input
                type="text"
                value={suggested.shared.join(", ")}
                onChange={(e) => setSuggested({ ...suggested, shared: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder="dev:api, dev:workflow"
                className="w-full bg-background text-foreground text-[12px] font-mono rounded-md px-2 py-1.5 ring-1 ring-divider/40 focus:outline-none focus:ring-primary"
              />
              <p className="text-[10.5px] text-muted-foreground-soft mt-1">Comma-separated. Must match script names in package.json.</p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={saveConfig}
                className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:brightness-110"
              >
                Save to .herd.json
              </button>
              <button
                onClick={() => { setConfiguring(false); setSuggested(null); }}
                className="h-7 px-2.5 rounded-md text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tab bar */}
        {!needsConfig && !configuring && (
          <div className="hairline-b shrink-0 flex items-center px-1 h-9 gap-0.5">
            {info?.running.map((r) => (
              <div key={r.script_name} className="shrink-0 flex items-center">
                <button
                  onClick={() => setActiveTab(r.script_name)}
                  className={`flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-l-md text-[12px] transition-colors ${
                    activeTab === r.script_name
                      ? "bg-surface text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface/60"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
                  <span className="font-mono">{r.script_name}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); stopScript(r.script_name); }}
                  className={`h-7 px-1 rounded-r-md text-muted-foreground-soft hover:text-destructive transition-colors ${
                    activeTab === r.script_name ? "bg-surface" : "hover:bg-surface/60"
                  }`}
                  title={`Stop ${r.script_name}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}

            <div className="relative shrink-0 overflow-visible" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground-soft hover:text-foreground hover:bg-surface/60 transition-colors"
                title="Start a service"
              >
                {starting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />}
              </button>
              {menuOpen && info && (
                <div className="absolute left-0 top-9 z-[100] w-80 rounded-lg bg-surface-elevated shadow-2xl ring-1 ring-divider/40 flex flex-col max-h-[60vh]">
                  <div className="shrink-0 px-2 pt-2 pb-1">
                    <div className="flex items-center gap-2 rounded-md bg-surface/70 px-2 py-1.5">
                      <Search size={11} className="text-muted-foreground-soft shrink-0" />
                      <input
                        ref={menuInputRef}
                        type="text"
                        value={menuQuery}
                        onChange={(e) => setMenuQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}
                        placeholder="Search scripts…"
                        className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground-soft/70 outline-none"
                      />
                      {menuQuery && (
                        <button onClick={() => setMenuQuery("")} className="text-muted-foreground-soft hover:text-foreground">
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto pb-1">
                    {(() => {
                      const q = menuQuery.trim().toLowerCase();
                      const matching = menuScripts.filter((s) =>
                        !q || s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q)
                      );
                      const sorted = [...matching].sort((a, b) => {
                        const ap = pinned.has(a.name) ? 0 : 1;
                        const bp = pinned.has(b.name) ? 0 : 1;
                        if (ap !== bp) return ap - bp;
                        return a.name.localeCompare(b.name);
                      });
                      if (sorted.length === 0) {
                        return (
                          <p className="px-3 py-2 text-[11px] text-muted-foreground-soft">
                            {menuScripts.length === 0
                              ? "No shared scripts configured. Click the gear to edit .herd.json."
                              : `No match for "${menuQuery}"`}
                          </p>
                        );
                      }
                      return sorted.map((def, i, arr) => {
                        const running = runningNames.has(def.name);
                        const isPinned = pinned.has(def.name);
                        const showDivider = i > 0 && isPinned !== pinned.has(arr[i - 1].name);
                        return (
                          <div key={def.name}>
                            {showDivider && <div className="mx-2 my-1 h-px bg-divider" />}
                            <div className="flex items-center hover:bg-primary-soft transition-colors">
                              <button
                                onClick={() => running ? (setActiveTab(def.name), setMenuOpen(false)) : startScript(def.name)}
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
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground-soft font-mono mr-2 truncate" title={info?.repo_path}>
              {info?.repo_path.split("/").slice(-1)[0]}
            </span>
          </div>
        )}

        {error && (
          <div className="hairline-b shrink-0 px-4 py-2 text-[11px] text-destructive">{error}</div>
        )}

        {/* Tab content */}
        <div className="flex-1 min-h-0">
          {!needsConfig && !configuring && activeTab ? (
            <SharedTerminal scriptName={activeTab} />
          ) : !needsConfig && !configuring && (
            <div className="flex h-full items-center justify-center text-center px-6">
              <div>
                <Play size={20} className="text-muted-foreground-soft mx-auto mb-2" />
                <p className="text-[13px] text-muted-foreground mb-1">No services running</p>
                <p className="text-[11.5px] text-muted-foreground-soft">
                  Click <Plus size={10} className="inline" /> to start a shared service.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SharedTerminal({ scriptName }: { scriptName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const { term, fitAddon } = createTerminal({ cursorBlink: false, disableStdin: true });
    term.open(containerRef.current);
    attachWebgl(term);
    fitAddon.fit();

    invoke<number[]>("get_shared_service_scrollback", { scriptName }).then((data) => {
      if (data?.length) term.write(new TextDecoder().decode(new Uint8Array(data)));
    }).catch(() => {});

    const unlistenPromise = listen<number[]>(`shared_service_output_${scriptName}`, (e) => {
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
