import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Sparkles, Save, Loader2 } from "lucide-react";
import type { TicketCard } from "@/App";

interface PlanEditorProps {
  ticket: TicketCard;
}

export function PlanEditor({ ticket }: PlanEditorProps) {
  const [content, setContent] = useState(ticket.title);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load the ticket description from Linear (cached locally)
  useEffect(() => {
    invoke<string | null>("get_ticket_description", { ticketId: ticket.id })
      .then((desc) => {
        if (desc) {
          setContent(desc);
          setDirty(false);
        }
      })
      .catch(() => {
        // No description cached yet, that's fine
      });
  }, [ticket.id]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("save_plan_to_linear", {
        ticketId: ticket.id,
        content,
      });
      setDirty(false);
    } catch (e) {
      console.error("Failed to save plan:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleEnhance = async () => {
    setEnhancing(true);
    try {
      const enhanced = await invoke<string>("enhance_plan", {
        ticketId: ticket.id,
        title: ticket.title,
        currentPlan: content,
      });
      setContent(enhanced);
      setDirty(true);
    } catch (e) {
      console.error("Failed to enhance plan:", e);
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="titlebar-drag-region flex h-10 shrink-0 items-center justify-between border-b border-border px-4 pt-5">
        <div className="titlebar-no-drag flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-muted-foreground shrink-0">
            {ticket.identifier}
          </span>
          <span className="text-[13px] text-foreground truncate">
            {ticket.title}
          </span>
          {dirty && (
            <span className="text-[10px] text-warning shrink-0">unsaved</span>
          )}
        </div>
        <div className="titlebar-no-drag flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEnhance}
            disabled={enhancing}
            title="Enhance with Claude"
          >
            {enhancing ? (
              <Loader2 size={13} className="animate-spin mr-1" />
            ) : (
              <Sparkles size={13} className="mr-1" />
            )}
            Enhance
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            title="Save to Linear (⌘↩)"
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin mr-1" />
            ) : (
              <Save size={13} className="mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto p-8">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          className="w-full h-full min-h-[300px] resize-none bg-transparent text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          placeholder="Write your plan here..."
          spellCheck={false}
        />
      </div>
    </div>
  );
}
