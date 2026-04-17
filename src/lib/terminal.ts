import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";

const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Build an xterm.js Terminal with Herd's standard theme, font, and addons. */
export function createTerminal(overrides: Partial<ITerminalOptions> = {}): {
  term: Terminal;
  fitAddon: FitAddon;
} {
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    fontSize: 13,
    fontFamily:
      "'JetBrainsMono Nerd Font', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontWeight: 400,
    fontWeightBold: 600,
    letterSpacing: 0.3,
    lineHeight: 1.35,
    allowTransparency: true,
    macOptionIsMeta: true,
    rightClickSelectsWord: true,
    scrollback: 10000,
    smoothScrollDuration: 80,
    convertEol: true,
    minimumContrastRatio: 4.5,
    theme: {
      background: css("--surface", "#0f1117"),
      foreground: css("--foreground", "#e6e6e6"),
      cursor: css("--primary", "#7aa2f7"),
      cursorAccent: css("--surface", "#0f1117"),
      selectionBackground: "rgba(122, 162, 247, 0.25)",
      black: "#1a1b26",         red: "#f7768e",
      green: "#9ece6a",         yellow: "#e0af68",
      blue: "#7aa2f7",          magenta: "#bb9af7",
      cyan: "#7dcfff",          white: "#c0caf5",
      brightBlack: "#414868",   brightRed: "#ff7a93",
      brightGreen: "#b9f27c",   brightYellow: "#ff9e64",
      brightBlue: "#7da6ff",    brightMagenta: "#bb9af7",
      brightCyan: "#0db9d7",    brightWhite: "#c0caf5",
    },
    ...overrides,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  return { term, fitAddon };
}

/** Attach the WebGL renderer. Safe no-op if the browser can't create the context. */
export function attachWebgl(term: Terminal) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // WebGL unavailable — xterm falls back to the DOM renderer.
  }
}
