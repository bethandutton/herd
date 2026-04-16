# Changelog

## v0.3.0 Quiet Editorial

A ground-up rework of the workspace model and the visual design.

### Model
- Tasks are now local-first. Linear is a one-shot picker, not a background sync.
- Five-stage workflow (Planning, Working, Requires attention, Waiting for feedback, Ready for merge), manual drag between stages, no automation.
- Each task row in the sidebar shows the branch name with dashes as spaces.
- Sections collapse, preferences saved per session.
- Plus button opens a picker of your Linear issues (assigned to you), or creates a blank task with a chosen title.

### UI
- Flat full-width layout, no floating boxes.
- Single top header with project dropdown, back/forward, tabs.
- Dark app shell, white content area for reading and terminal.
- Editorial serif for titles (Instrument Serif), system font stack for everything else.
- Tonal palette: warm neutral background, saffron accent.
- Linear-style status circles, priority bars, draggable rows.

### Under the hood
- Dropped the markdown plan editor and every dep it pulled in (react-markdown, remark-gfm, @uiw/react-md-editor).
- Dropped the services runner, local branch switcher, per-worktree env JSON.
- Removed GitHub PR comments list (the embedded webview handles it).
- Tauri 2 child webview for the GitHub PR tab.
- `data-tauri-drag-region` for reliable window dragging.
- Auto-updater plugin restored.

## v0.2.0 Full workflow

(Legacy, pre-rework.)

### Board
- Flat ticket list with Linear-style status circle icons
- Filter by status, sort by status/priority/created/updated/title
- Search tickets by title or ID
- Right-click context menu: copy ID, open in Linear
- Create new tickets via Linear API
- Background polling with SQLite persistence
- Dynamic status mapping from Linear workflow states

### Plan editor
- Markdown preview with full GFM support
- Save to Linear
- Enhance with Claude via Anthropic API
- Conflict detection
- Loading state for preview mode

### Claude Code sessions
- Per-ticket Git worktrees (auto-created from origin/main)
- Claude Code spawned in PTY per worktree
- xterm.js terminal with live output
- Session persistence across ticket switches
- Scrollback buffered to disk

### Local environment
- Shared _local worktree with branch switching
- Service runner: detects package.json scripts
- Browser preview iframe

### GitHub integration
- GitHub REST API client for PRs, reviews, comments
- Background polling (60s) for PR status
- Auto status transitions
- PR tab with info bar and embedded webview

### UI
- Tab-based layout (Plan, Session, Local, PR)
- Cmd+K command palette with fuzzy search
- Keyboard shortcuts: j/k navigation, Cmd+1-4 tab switching
- Floating panel design with gray canvas background
- Traffic light positioning

### Settings
- Anthropic API key field for Enhance with Claude
- Token persistence on save
- Theme, density, font size controls

### Release
- GitHub Actions workflow for macOS builds (Apple Silicon + Intel)
- Code signing and notarization support

## v0.1.0 Skeleton

- Tauri app initialized with React, TypeScript, Tailwind CSS
- Three-column resizable layout
- CSS variable theming, density controls, font size controls
- SQLite database, macOS Keychain integration
- First-run onboarding flow
- Settings panel
