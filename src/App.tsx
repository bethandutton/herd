import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Board } from "@/components/board/Board";
import { MiddleColumn } from "@/components/middle/MiddleColumn";
import { RightColumn } from "@/components/right/RightColumn";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

type AppView = "loading" | "onboarding" | "main";

export default function App() {
  const [view, setView] = useState<AppView>("loading");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rightColumnVisible, setRightColumnVisible] = useState(true);

  useEffect(() => {
    invoke<boolean>("has_repos")
      .then((hasRepos) => {
        setView(hasRepos ? "main" : "onboarding");
      })
      .catch(() => {
        setView("onboarding");
      });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (e.metaKey && e.key === "b") {
        e.preventDefault();
        setRightColumnVisible((v) => !v);
      }
      if (e.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setView("main");
  }, []);

  const handleRerunSetup = useCallback(() => {
    setSettingsOpen(false);
    setView("onboarding");
  }, []);

  if (view === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (view === "onboarding") {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Three-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left — Board (fixed 280px) */}
        <div className="w-[280px] min-w-[260px] shrink-0 border-r border-border bg-background overflow-hidden">
          <Board />
        </div>

        {/* Middle — Plan or Session (flexible) */}
        <div className="flex-1 min-w-0 bg-background">
          <MiddleColumn />
        </div>

        {/* Right — Local (fixed 400px) */}
        {rightColumnVisible && (
          <div className="w-[400px] min-w-[380px] shrink-0 border-l border-border bg-background overflow-hidden">
            <RightColumn />
          </div>
        )}
      </div>

      {/* Settings modal */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onRerunSetup={handleRerunSetup}
      />
    </div>
  );
}
