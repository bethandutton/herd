<img src="public/app-icon.png" width="80" alt="Herd app icon" />

# Herd

A macOS desktop app for working on multiple tasks in parallel, each in its own Git worktree with its own terminal. Spawn Claude Code, Codex, or any CLI agent you like. Switch between tasks without losing flow.

## What it does

- **Per-task worktrees** every task gets a Git branch and a dedicated worktree, created automatically from your primary branch
- **Dedicated terminal per task** xterm.js pointed at the worktree, run whatever agent or command you want
- **Linear picker** plus button opens a list of Linear issues assigned to you (optional, read-only)
- **GitHub PR viewer** embeds the real github.com page inside the app for any task with a branch
- **Local preview** iframe against localhost for frontend work
- **Drag-to-reassign status** five stages (Planning, Working, Requires attention, Waiting for feedback, Ready for merge), you drag tasks between them
- **Keyboard-first** Cmd+K palette, j/k navigation, Cmd+1/2/3/4 tabs

## Install

Download the latest `.dmg` from [Releases](../../releases), or build from source:

```bash
# Prerequisites: macOS, Rust, Node.js 20+
git clone https://github.com/bethandutton/herd.git
cd herd
npm install
npm run tauri dev
```

## Setup

First launch walks you through:

1. **GitHub token** (optional) enables the PR tab
2. **Project folder** pick a local Git clone, Herd auto-detects the primary branch

In Settings you can also add a **Linear token** to enable the task picker.

Tokens are stored in the macOS Keychain. Herd only talks to Linear and GitHub when you press a button, with your own keys.

## Privacy

No telemetry. No crash reporting. No analytics.

## License

MIT, see [LICENSE](LICENSE).
