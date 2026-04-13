use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::LazyLock;

// For now, store tokens in memory + SQLite Settings table
// TODO: migrate to macOS Keychain once the core flow is stable
static TOKEN_CACHE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn store_secret(key: &str, value: &str) -> Result<(), String> {
    TOKEN_CACHE
        .lock()
        .unwrap()
        .insert(key.to_string(), value.to_string());

    // Also persist to disk via settings db
    let db_path = crate::db::Database::db_path_public();
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO Settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&format!("secret_{}", key), value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    // Check memory cache first
    if let Some(val) = TOKEN_CACHE.lock().unwrap().get(key) {
        return Ok(Some(val.clone()));
    }
    // Fall back to Settings db
    let db_path = crate::db::Database::db_path_public();
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM Settings WHERE key = ?1",
            [&format!("secret_{}", key)],
            |row| row.get(0),
        )
        .ok();
    if let Some(ref val) = result {
        TOKEN_CACHE.lock().unwrap().insert(key.to_string(), val.clone());
    }
    Ok(result)
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    TOKEN_CACHE.lock().unwrap().remove(key);
    let db_path = crate::db::Database::db_path_public();
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM Settings WHERE key = ?1",
        [&format!("secret_{}", key)],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
