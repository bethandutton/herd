import { useState, useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X, Loader2 } from "lucide-react";

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check for updates every 5 minutes, and on launch after 10s
    const checkForUpdate = async () => {
      try {
        const update = await check();
        if (update) {
          setUpdateAvailable(true);
          setUpdateVersion(update.version);
          setUpdateNotes(update.body || "");
          setDismissed(false);
        }
      } catch (e) {
        // Silently fail — updater not configured or no network
        console.debug("Update check:", e);
      }
    };

    const initialTimeout = setTimeout(checkForUpdate, 10000);
    const interval = setInterval(checkForUpdate, 5 * 60 * 1000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (e) {
      console.error("Failed to install update:", e);
      setInstalling(false);
    }
  };

  if (!updateAvailable || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-border bg-surface-elevated shadow-lg p-3 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Download size={14} className="text-primary shrink-0" />
          <span className="text-xs font-medium text-foreground">Update available</span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X size={12} />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Herd {updateVersion} is ready to install.
      </p>
      {updateNotes && (
        <p className="text-[11px] text-muted-foreground/70 line-clamp-2">{updateNotes}</p>
      )}
      <button
        onClick={handleInstall}
        disabled={installing}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {installing ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Installing...
          </>
        ) : (
          <>
            <Download size={12} />
            Update and restart
          </>
        )}
      </button>
    </div>
  );
}
