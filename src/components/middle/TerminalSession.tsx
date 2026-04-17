import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { createTerminal, attachWebgl } from "@/lib/terminal";

interface TerminalSessionProps {
  sessionId: string;
}

export function TerminalSession({ sessionId }: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const { term, fitAddon } = createTerminal();
    term.open(containerRef.current);
    attachWebgl(term);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Load existing scrollback
    invoke<number[]>("get_scrollback", { sessionId }).then((data) => {
      if (data && data.length > 0) {
        const bytes = new Uint8Array(data);
        const text = new TextDecoder().decode(bytes);
        term.write(text);
      }
    }).catch((e) => console.error("Failed to load scrollback:", e));

    const unlistenPromise = listen<number[]>(`session_output_${sessionId}`, (event) => {
      const bytes = new Uint8Array(event.payload);
      const text = new TextDecoder().decode(bytes);
      term.write(text);
    });

    const disposable = term.onData((data) => {
      const encoded = new TextEncoder().encode(data);
      invoke("write_to_session", {
        sessionId,
        data: Array.from(encoded),
      }).catch((e) => console.error("Failed to write to session:", e));
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposable.dispose();
      resizeObserver.disconnect();
      unlistenPromise.then((f) => f());
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className="xterm-wrapper h-full w-full"
      style={{ backgroundColor: "var(--surface)" }}
    />
  );
}
