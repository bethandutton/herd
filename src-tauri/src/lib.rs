mod db;
mod keychain;
mod github;
mod linear;
mod pty;
mod worktree;

use db::Database;
use linear::LinearClient;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, SubmenuBuilder};

pub struct AppState {
    pub db: Arc<Database>,
    pub sessions: Arc<pty::SessionManager>,
}

// ---- Settings commands ----

#[tauri::command]
fn get_setting(state: tauri::State<AppState>, key: String) -> Result<Option<String>, String> {
    state.db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    state
        .db
        .set_setting(&key, &value)
        .map_err(|e| e.to_string())?;
    app.emit("setting_changed", SettingChangedPayload { key, value })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct SettingChangedPayload {
    key: String,
    value: String,
}

// ---- Onboarding / Repo commands ----

#[tauri::command]
fn has_repos(state: tauri::State<AppState>) -> Result<bool, String> {
    state.db.has_repos().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_repo(
    state: tauri::State<AppState>,
    name: String,
    path: String,
    worktrees_dir: String,
    primary_branch: String,
    preview_port: i64,
) -> Result<String, String> {
    state
        .db
        .create_repo(&name, &path, &worktrees_dir, &primary_branch, preview_port)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_active_repo(state: tauri::State<AppState>) -> Result<Option<db::RepoRow>, String> {
    state.db.get_active_repo().map_err(|e| e.to_string())
}

// ---- Repo detection ----

#[derive(Clone, serde::Serialize)]
struct DetectedRepoInfo {
    name: String,
    primary_branch: String,
    worktrees_dir: String,
}

#[tauri::command]
fn detect_repo_info(path: String) -> Result<DetectedRepoInfo, String> {
    let repo_path = std::path::Path::new(&path);

    if !repo_path.join(".git").exists() && !repo_path.is_dir() {
        return Err("Not a valid directory or git repository".into());
    }

    let name = repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo")
        .to_string();

    let primary_branch = std::process::Command::new("git")
        .args(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"])
        .current_dir(&path)
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout)
                    .ok()
                    .map(|s| s.trim().trim_start_matches("origin/").to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "main".to_string());

    let parent = repo_path.parent().unwrap_or(repo_path);
    let worktrees_dir = parent
        .join(format!("{}-worktrees", name))
        .to_string_lossy()
        .to_string();

    Ok(DetectedRepoInfo {
        name,
        primary_branch,
        worktrees_dir,
    })
}

// ---- Claude Code detection ----

// ---- Task commands ----

#[derive(Clone, serde::Serialize)]
struct TicketCard {
    id: String,
    identifier: String,
    title: String,
    priority: i64,
    status: String,
    branch_name: Option<String>,
    tags: Vec<String>,
    project: Option<String>,
    assignee: Option<String>,
    created_at: String,
    updated_at: String,
}

// ---- Linear picker (read-only) ----

#[derive(Clone, serde::Serialize)]
struct LinearPickerIssue {
    id: String,
    identifier: String,
    title: String,
    status: String,
    priority: i64,
    branch_name: Option<String>,
    project: Option<String>,
    tags: Vec<String>,
    in_current_cycle: bool,
}

#[tauri::command]
async fn fetch_linear_issues_live() -> Result<Vec<LinearPickerIssue>, String> {
    let token = keychain::get_secret("linear_api_token")?
        .ok_or("No Linear API token configured")?;
    let client = LinearClient::new(&token);
    let issues = client.get_assigned_issues().await?;

    let now = chrono::Utc::now().to_rfc3339();
    Ok(issues.into_iter().map(|i| {
        let status = linear::map_linear_state_to_status(&i);
        let tags: Vec<String> = i.labels.nodes.iter().map(|l| l.name.clone()).collect();
        let in_current_cycle = i.cycle.as_ref()
            .map(|c| {
                let started = c.starts_at.as_deref().map(|s| s <= now.as_str()).unwrap_or(false);
                let not_ended = c.ends_at.as_deref().map(|e| e >= now.as_str()).unwrap_or(true);
                started && not_ended
            })
            .unwrap_or(false);
        LinearPickerIssue {
            id: i.id,
            identifier: i.identifier,
            title: i.title,
            status: status.to_string(),
            priority: i.priority,
            branch_name: i.branch_name,
            project: i.project.map(|p| p.name),
            tags,
            in_current_cycle,
        }
    }).collect())
}

#[tauri::command]
fn import_linear_task(
    state: tauri::State<AppState>,
    linear_id: String,
    identifier: String,
    title: String,
    branch_name: Option<String>,
    priority: Option<i64>,
) -> Result<TicketCard, String> {
    let repo = state.db.get_active_repo().map_err(|e| e.to_string())?
        .ok_or("No active repo")?;

    let prio = priority.unwrap_or(0);

    // Resolve a branch name — prefer Linear's, else derive from identifier + title
    let resolved_branch = worktree::resolve_branch_name(
        &identifier,
        &title,
        branch_name.as_deref(),
    );

    // Persist the task
    state.db.import_task(&linear_id, &identifier, &repo.id, &title, Some(&resolved_branch), prio)
        .map_err(|e| e.to_string())?;

    // Create a worktree from origin/primary — best-effort, non-fatal
    let _ = worktree::fetch_origin(&repo.path, &repo.primary_branch);
    let status = worktree::branch_exists(&repo.path, &resolved_branch)
        .unwrap_or(worktree::BranchStatus::DoesNotExist);
    let wt_result = match status {
        worktree::BranchStatus::DoesNotExist => {
            let base = format!("origin/{}", repo.primary_branch);
            worktree::create_worktree(&repo.path, &repo.worktrees_dir, &resolved_branch, &base)
        }
        _ => worktree::use_existing_worktree(&repo.path, &repo.worktrees_dir, &resolved_branch),
    };
    if let Ok(path) = wt_result {
        let _ = state.db.update_ticket_branch(&linear_id, &resolved_branch, &path, "");
    }

    Ok(TicketCard {
        id: linear_id,
        identifier,
        title,
        priority: prio,
        status: "todo".to_string(),
        branch_name: Some(resolved_branch),
        tags: vec![],
        project: None,
        assignee: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
fn get_tickets(state: tauri::State<AppState>) -> Result<Vec<TicketCard>, String> {
    let repo = state.db.get_active_repo().map_err(|e| e.to_string())?;
    let repo_id = match repo {
        Some(r) => r.id,
        None => return Ok(vec![]),
    };
    let rows = state.db.get_all_tickets(&repo_id).map_err(|e| e.to_string())?;
    let tickets = rows.into_iter().map(|r| {
        let tags: Vec<String> = serde_json::from_str(&r.tags).unwrap_or_default();
        TicketCard {
            id: r.id,
            identifier: r.identifier,
            title: r.title,
            priority: r.priority,
            status: r.status,
            branch_name: r.branch_name,
            tags,
            project: None, // Not stored in SQLite yet
            assignee: None,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }).collect();
    Ok(tickets)
}

#[tauri::command]
fn update_ticket_status(state: tauri::State<AppState>, ticket_id: String, status: String) -> Result<(), String> {
    state.db.update_ticket_status(&ticket_id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_task(
    state: tauri::State<AppState>,
    title: String,
    description: Option<String>,
    priority: Option<i64>,
) -> Result<TicketCard, String> {
    let repo = state.db.get_active_repo().map_err(|e| e.to_string())?
        .ok_or("No active repo")?;

    let id = uuid::Uuid::new_v4().to_string();
    let next = state.db.next_task_number(&repo.id).map_err(|e| e.to_string())?;
    let identifier = format!("T-{:03}", next);
    let prio = priority.unwrap_or(0);

    state.db.create_task(
        &id,
        &identifier,
        &repo.id,
        &title,
        description.as_deref().unwrap_or(""),
        prio,
    ).map_err(|e| e.to_string())?;

    Ok(TicketCard {
        id,
        identifier,
        title,
        priority: prio,
        status: "todo".to_string(),
        branch_name: None,
        tags: vec![],
        project: None,
        assignee: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}


#[tauri::command]
fn update_ticket_priority(state: tauri::State<AppState>, ticket_id: String, priority: i64) -> Result<(), String> {
    state.db.update_ticket_priority(&ticket_id, priority).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_task(state: tauri::State<AppState>, ticket_id: String) -> Result<(), String> {
    state.db.delete_task(&ticket_id).map_err(|e| e.to_string())
}

// ---- Session / Worktree commands ----

#[tauri::command]
async fn start_ticket(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    ticket_id: String,
) -> Result<StartTicketResult, String> {
    let repo = state.db.get_active_repo().map_err(|e| e.to_string())?
        .ok_or("No active repo configured")?;

    // Load the task from the local DB to derive a branch name
    let tickets = state.db.get_all_tickets(&repo.id).map_err(|e| e.to_string())?;
    let ticket = tickets.iter().find(|t| t.id == ticket_id)
        .ok_or("Task not found")?;

    let branch_name = worktree::resolve_branch_name(
        &ticket.identifier,
        &ticket.title,
        ticket.branch_name.as_deref(),
    );

    // Fetch origin
    worktree::fetch_origin(&repo.path, &repo.primary_branch)?;

    // Check if branch exists
    let status = worktree::branch_exists(&repo.path, &branch_name)?;
    let worktree_path = match status {
        worktree::BranchStatus::DoesNotExist => {
            let base_ref = format!("origin/{}", repo.primary_branch);
            worktree::create_worktree(&repo.path, &repo.worktrees_dir, &branch_name, &base_ref)?
        }
        _ => {
            worktree::use_existing_worktree(&repo.path, &repo.worktrees_dir, &branch_name)?
        }
    };

    // Copy env files
    let copy_patterns = state.db.get_setting("copy_files")
        .ok()
        .flatten()
        .unwrap_or_else(|| ".env*".to_string());
    let patterns: Vec<String> = copy_patterns.split(',').map(|s| s.trim().to_string()).collect();
    let local_path = std::path::Path::new(&repo.worktrees_dir).join("_local");
    if local_path.exists() {
        let _ = worktree::copy_env_files(&local_path.to_string_lossy(), &worktree_path, &patterns);
    }

    // Find claude CLI
    let claude_path = std::process::Command::new("which")
        .arg("claude")
        .output()
        .ok()
        .and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string()) } else { None })
        .ok_or("Claude Code CLI not found. Install it first.")?;

    // Create session
    let session_id = uuid::Uuid::new_v4().to_string();
    let scrollback_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Herd")
        .join("scrollbacks");
    let scrollback_path = scrollback_dir.join(format!("{}.log", session_id));

    state.sessions.spawn_session(
        &session_id,
        &ticket_id,
        &worktree_path,
        &claude_path,
        &scrollback_path.to_string_lossy(),
        app.clone(),
    )?;

    // Update ticket in DB
    let _ = state.db.update_ticket_status(&ticket_id, "in_progress");
    let _ = state.db.update_ticket_branch(&ticket_id, &branch_name, &worktree_path, &session_id);

    Ok(StartTicketResult {
        session_id,
        branch_name,
        worktree_path,
    })
}

#[derive(Clone, serde::Serialize)]
struct StartTicketResult {
    session_id: String,
    branch_name: String,
    worktree_path: String,
}

#[tauri::command]
fn get_scrollback(state: tauri::State<AppState>, session_id: String) -> Result<Vec<u8>, String> {
    state.sessions.get_scrollback(&session_id)
}

#[tauri::command]
fn write_to_session(state: tauri::State<AppState>, session_id: String, data: Vec<u8>) -> Result<(), String> {
    state.sessions.write_to_session(&session_id, &data)
}

#[tauri::command]
fn kill_session(state: tauri::State<AppState>, session_id: String) -> Result<(), String> {
    state.sessions.kill_session(&session_id)
}

// ---- GitHub commands ----

#[tauri::command]
async fn check_pr_status(state: tauri::State<'_, AppState>, branch_name: String) -> Result<Option<PrInfo>, String> {
    let token = match keychain::get_secret("github_api_token")? {
        Some(t) => t,
        None => return Ok(None),
    };

    let repo = state.db.get_active_repo().map_err(|e| e.to_string())?
        .ok_or("No active repo")?;

    let (owner, repo_name) = github::parse_owner_repo(&repo.path)?;
    let client = github::GitHubClient::new(&token);

    let pr = match client.get_pr_by_branch(&owner, &repo_name, &branch_name).await? {
        Some(pr) => pr,
        None => return Ok(None),
    };

    let reviews = client.get_pr_reviews(&owner, &repo_name, pr.number).await.unwrap_or_default();
    let comments = client.get_pr_comments(&owner, &repo_name, pr.number).await.unwrap_or_default();

    let approved = reviews.iter().any(|r| r.state == "APPROVED");
    let changes_requested = reviews.iter().any(|r| r.state == "CHANGES_REQUESTED");
    let comment_count = comments.len() as i64;

    Ok(Some(PrInfo {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        draft: pr.draft,
        merged: pr.merged.unwrap_or(false),
        approved,
        changes_requested,
        comment_count,
    }))
}

#[derive(Clone, serde::Serialize)]
struct PrInfo {
    number: i64,
    title: String,
    url: String,
    state: String,
    draft: bool,
    merged: bool,
    approved: bool,
    changes_requested: bool,
    comment_count: i64,
}

// ---- Embedded PR webview (child of main window) ----

fn find_pr_webview(app: &tauri::AppHandle) -> Option<tauri::Webview> {
    let window = app.get_webview_window("main")?;
    window
        .webviews()
        .into_iter()
        .find(|(label, _)| label == "pr-embed")
        .map(|(_, wv)| wv)
}

#[tauri::command]
async fn embed_pr_webview(
    app: tauri::AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use tauri::webview::WebviewBuilder;
    use tauri::{LogicalPosition, LogicalSize, WebviewUrl};

    let parsed: tauri::Url = url.parse().map_err(|e: url::ParseError| format!("Invalid URL: {}", e))?;

    if let Some(existing) = find_pr_webview(&app) {
        existing
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e: tauri::Error| e.to_string())?;
        existing
            .set_size(LogicalSize::new(width, height))
            .map_err(|e: tauri::Error| e.to_string())?;
        existing
            .show()
            .map_err(|e: tauri::Error| e.to_string())?;
        existing
            .navigate(parsed)
            .map_err(|e: tauri::Error| e.to_string())?;
        return Ok(());
    }

    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    // WebviewWindow wraps a Window that supports add_child when the "unstable" feature is enabled
    window
        .as_ref()
        .window()
        .add_child(
            WebviewBuilder::new("pr-embed", WebviewUrl::External(parsed)),
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e: tauri::Error| format!("Failed to add child webview: {}", e))?;

    Ok(())
}

#[tauri::command]
fn resize_pr_webview(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};
    if let Some(wv) = find_pr_webview(&app) {
        wv.set_position(LogicalPosition::new(x, y))
            .map_err(|e: tauri::Error| e.to_string())?;
        wv.set_size(LogicalSize::new(width, height))
            .map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_pr_webview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = find_pr_webview(&app) {
        wv.hide().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}


// ---- Keychain commands ----

#[tauri::command]
fn store_token(key: String, value: String) -> Result<(), String> {
    keychain::store_secret(&key, &value)
}

#[tauri::command]
fn get_token(key: String) -> Result<Option<String>, String> {
    keychain::get_secret(&key)
}

#[tauri::command]
fn delete_token(key: String) -> Result<(), String> {
    keychain::delete_secret(&key)
}

// ---- App entry point ----

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            db: Arc::new(db),
            sessions: Arc::new(pty::SessionManager::new()),
        })
        .setup(|app| {
            // Build native macOS menu
            let app_submenu = SubmenuBuilder::new(app, "Herd")
                .about(None)
                .separator()
                .item(
                    &tauri::menu::MenuItem::with_id(
                        app,
                        "preferences",
                        "Preferences...",
                        true,
                        Some("CmdOrCtrl+,"),
                    )?,
                )
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View")
                .item(
                    &tauri::menu::MenuItem::with_id(
                        app,
                        "toggle_right",
                        "Toggle Right Panel",
                        true,
                        Some("CmdOrCtrl+B"),
                    )?,
                )
                .separator()
                .fullscreen()
                .build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .build()?;

            app.set_menu(menu)?;

            // Start background GitHub polling task (60s)
            {
                let handle = app.handle().clone();
                let db = app.state::<AppState>().db.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                        let gh_token = match keychain::get_secret("github_api_token") {
                            Ok(Some(t)) => t,
                            _ => continue,
                        };
                        let repo = match db.get_active_repo() {
                            Ok(Some(r)) => r,
                            _ => continue,
                        };
                        let (owner, repo_name) = match github::parse_owner_repo(&repo.path) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        let gh_client = github::GitHubClient::new(&gh_token);
                        let viewer_login = gh_client.get_viewer_login().await.unwrap_or_default();

                        // Get tickets with branches from DB
                        let tickets = match db.get_all_tickets(&repo.id) {
                            Ok(t) => t,
                            Err(_) => continue,
                        };

                        for ticket in &tickets {
                            let branch = match &ticket.branch_name {
                                Some(b) if !b.is_empty() => b.clone(),
                                _ => continue,
                            };

                            // Check for PR
                            if let Ok(Some(pr)) = gh_client.get_pr_by_branch(&owner, &repo_name, &branch).await {
                                // Check for new comments from others
                                let comments = gh_client.get_pr_comments(&owner, &repo_name, pr.number).await.unwrap_or_default();
                                let reviews = gh_client.get_pr_reviews(&owner, &repo_name, pr.number).await.unwrap_or_default();

                                let has_new_external_comments = comments.iter().any(|c| c.user.login != viewer_login);
                                let approved = reviews.iter().any(|r| r.state == "APPROVED");
                                let merged = pr.merged.unwrap_or(false);

                                let new_status = if merged {
                                    "done"
                                } else if approved {
                                    "ready_to_merge"
                                } else if has_new_external_comments && ticket.status != "human_input" {
                                    "human_input"
                                } else if ticket.status == "in_progress" {
                                    "waiting_for_review"
                                } else {
                                    &ticket.status
                                };

                                if new_status != ticket.status {
                                    let _ = db.update_ticket_status(&ticket.id, new_status);
                                    let _ = handle.emit("tickets_updated", ());
                                }
                            }
                        }
                    }
                });
            }

            // Handle menu events
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                match event.id().as_ref() {
                    "preferences" => {
                        let _ = app_handle.emit("open_settings", ());
                    }
                    "toggle_right" => {
                        let _ = app_handle.emit("toggle_right_column", ());
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_setting,
            set_setting,
            has_repos,
            create_repo,
            get_active_repo,
            detect_repo_info,
            get_tickets,
            update_ticket_status,
            update_ticket_priority,
            create_task,
            delete_task,
            fetch_linear_issues_live,
            import_linear_task,
            start_ticket,
            get_scrollback,
            write_to_session,
            kill_session,
            check_pr_status,
            embed_pr_webview,
            resize_pr_webview,
            hide_pr_webview,
            store_token,
            get_token,
            delete_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
