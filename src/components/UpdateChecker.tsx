import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X } from "lucide-react";

interface UpdateInfo {
  version: string;
  body?: string;
}

export function UpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const u = await check();
        if (u) {
          setUpdate({ version: u.version, body: u.body });
          (window as any).__herdUpdate = u;
        }
      } catch (e) {
        console.debug("Update check failed:", e);
      }
    })();
  }, []);

  if (!update || dismissed) return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const u = (window as any).__herdUpdate;
      if (u) {
        await u.downloadAndInstall();
        await relaunch();
      }
    } catch (e) {
      console.error("Update install failed:", e);
      setInstalling(false);
    }
  };

  return (
    <div className="fixed bottom-3 right-3 z-50 w-72 rounded-lg bg-surface-elevated shadow-2xl ring-1 ring-divider p-3">
      <div className="flex items-start gap-2">
        <Download size={14} className="text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground">Update available</p>
          <p className="text-[11px] text-muted-foreground-soft">Version {update.version}</p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground-soft hover:text-foreground p-0.5"
        >
          <X size={12} />
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          onClick={handleInstall}
          disabled={installing}
          className="inline-flex items-center gap-1 h-6 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:brightness-110 disabled:opacity-60"
        >
          {installing ? "Installing…" : "Install & restart"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Later
        </button>
      </div>
    </div>
  );
}
