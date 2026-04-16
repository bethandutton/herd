use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

const BUFFER_MAX: usize = 200_000;

struct ServiceProcess {
    script_name: String,
    current_branch: Mutex<Option<String>>,
    #[allow(dead_code)]
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    buffer: Arc<Mutex<Vec<u8>>>,
}

pub struct ServiceManager {
    /// Keyed by script name, not task — services are shared across all tasks.
    services: Mutex<HashMap<String, ServiceProcess>>,
}

#[derive(Clone, serde::Serialize)]
pub struct ServiceDef {
    pub name: String,
    pub command: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ServiceStatus {
    pub id: String,
    pub script_name: String,
    pub current_branch: Option<String>,
}

fn detect_package_manager(worktree_path: &str) -> String {
    let root = std::path::Path::new(worktree_path);
    if root.join("pnpm-lock.yaml").exists() { return "pnpm".to_string(); }
    if root.join("yarn.lock").exists() { return "yarn".to_string(); }
    "npm".to_string()
}

impl ServiceManager {
    pub fn new() -> Self {
        ServiceManager { services: Mutex::new(HashMap::new()) }
    }

    pub fn start_service(
        &self,
        script_name: &str,
        worktree_path: &str,
        branch: Option<&str>,
        app_handle: tauri::AppHandle,
    ) -> Result<String, String> {
        self.spawn(script_name, worktree_path, branch, app_handle, false)
    }

    pub fn start_install(
        &self,
        worktree_path: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<String, String> {
        self.spawn("install", worktree_path, None, app_handle, true)
    }

    fn spawn(
        &self,
        script_name: &str,
        worktree_path: &str,
        branch: Option<&str>,
        app_handle: tauri::AppHandle,
        is_install: bool,
    ) -> Result<String, String> {
        // If already running, noop.
        if let Ok(services) = self.services.lock() {
            if services.contains_key(script_name) {
                return Ok(script_name.to_string());
            }
        }

        let pkg_mgr = detect_package_manager(worktree_path);
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 120, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(&pkg_mgr);
        if is_install {
            cmd.arg("install");
        } else {
            cmd.args(["run", script_name]);
        }
        cmd.cwd(worktree_path);
        cmd.env("TERM", "xterm-256color");

        let child = pair.slave.spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn service: {}", e))?;

        let writer = pair.master.take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
        let buffer_clone = buffer.clone();
        let sid = script_name.to_string();

        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            let event_name = format!("service_output_{}", sid);
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = &chunk[..n];
                        if let Ok(mut buf) = buffer_clone.lock() {
                            buf.extend_from_slice(data);
                            if buf.len() > BUFFER_MAX {
                                let excess = buf.len() - BUFFER_MAX;
                                buf.drain(..excess);
                            }
                        }
                        let _ = app_handle.emit(&event_name, data.to_vec());
                    }
                    Err(_) => break,
                }
            }
        });

        self.services.lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .insert(script_name.to_string(), ServiceProcess {
                script_name: script_name.to_string(),
                current_branch: Mutex::new(branch.map(|s| s.to_string())),
                writer,
                child,
                buffer,
            });

        Ok(script_name.to_string())
    }

    pub fn get_scrollback(&self, script_name: &str) -> Result<Vec<u8>, String> {
        let services = self.services.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let svc = services.get(script_name)
            .ok_or_else(|| format!("Service {} not found", script_name))?;
        let buf = svc.buffer.lock().map_err(|e| e.to_string())?;
        Ok(buf.clone())
    }

    pub fn stop_service(&self, script_name: &str) -> Result<(), String> {
        let mut services = self.services.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(mut svc) = services.remove(script_name) {
            let _ = svc.child.kill();
            let _ = svc.child.wait();
        }
        Ok(())
    }

    pub fn stop_all(&self) -> Result<(), String> {
        let mut services = self.services.lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        for (_, mut svc) in services.drain() {
            let _ = svc.child.kill();
            let _ = svc.child.wait();
        }
        Ok(())
    }

    pub fn list_running(&self) -> Vec<ServiceStatus> {
        if let Ok(services) = self.services.lock() {
            services.iter().map(|(id, svc)| ServiceStatus {
                id: id.clone(),
                script_name: svc.script_name.clone(),
                current_branch: svc.current_branch.lock().ok().and_then(|b| b.clone()),
            }).collect()
        } else {
            vec![]
        }
    }

    /// Update the "current branch" label on every running service after a checkout.
    pub fn update_current_branch(&self, branch: &str) {
        if let Ok(services) = self.services.lock() {
            for (_, svc) in services.iter() {
                if let Ok(mut cb) = svc.current_branch.lock() {
                    *cb = Some(branch.to_string());
                }
            }
        }
    }
}

/// Detect scripts from a package.json and report whether deps are installed.
pub fn detect_scripts(worktree_path: &str) -> Result<(Vec<ServiceDef>, bool, bool, String), String> {
    let root = std::path::Path::new(worktree_path);
    let pkg_path = root.join("package.json");
    let has_package_json = pkg_path.exists();
    if !has_package_json {
        return Ok((vec![], false, false, "npm".to_string()));
    }
    let content = std::fs::read_to_string(&pkg_path)
        .map_err(|e| format!("Failed to read package.json: {}", e))?;
    let pkg: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse package.json: {}", e))?;
    let scripts = pkg.get("scripts")
        .and_then(|s| s.as_object())
        .map(|scripts| scripts.iter().map(|(name, cmd)| ServiceDef {
            name: name.clone(),
            command: cmd.as_str().unwrap_or("").to_string(),
        }).collect())
        .unwrap_or_default();
    let node_modules_installed = root.join("node_modules").is_dir();
    let package_manager = detect_package_manager(worktree_path);
    Ok((scripts, has_package_json, node_modules_installed, package_manager))
}
