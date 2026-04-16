import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TicketCard } from "@/App";
import { StatusChip, PriorityChip } from "@/components/board/chips";

interface Props {
  ticket: TicketCard;
}

const descriptionCache = new Map<string, string>();
const imageCache = new Map<string, string>();

function LinearImage({ src, alt }: { src?: string; alt?: string }) {
  const [resolved, setResolved] = useState<string | null>(
    src && imageCache.has(src) ? imageCache.get(src)! : null
  );
  useEffect(() => {
    if (!src) return;
    if (!src.startsWith("https://uploads.linear.app/")) {
      setResolved(src);
      return;
    }
    const cached = imageCache.get(src);
    if (cached) { setResolved(cached); return; }
    let cancelled = false;
    invoke<number[]>("fetch_linear_image", { url: src })
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)]);
        const u = URL.createObjectURL(blob);
        imageCache.set(src, u);
        setResolved(u);
      })
      .catch(() => { if (!cancelled) setResolved(src); });
    return () => { cancelled = true; };
  }, [src]);

  if (!resolved) {
    return <span className="inline-block my-3 h-24 w-full max-w-md rounded-md bg-surface-elevated/40" aria-label={alt || "loading image"} />;
  }
  return <img src={resolved} alt={alt || ""} className="max-w-full rounded-md my-3" loading="lazy" />;
}

export function TaskDetail({ ticket }: Props) {
  const [content, setContent] = useState<string | null>(() => descriptionCache.get(ticket.id) ?? null);
  const [loading, setLoading] = useState(content === null);

  useEffect(() => {
    const cached = descriptionCache.get(ticket.id);
    if (cached !== undefined) {
      setContent(cached);
      setLoading(false);
      return;
    }
    setContent(null);
    setLoading(true);
    invoke<string | null>("fetch_linear_description", { ticketId: ticket.id })
      .then((desc) => {
        const val = desc || "";
        descriptionCache.set(ticket.id, val);
        setContent(val);
      })
      .catch(() => { setContent(""); })
      .finally(() => setLoading(false));
  }, [ticket.id]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-8 py-10 w-full">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground-soft">
            {ticket.identifier}
          </span>
        </div>

        <h1 className="font-display text-[32px] leading-[1.15] text-foreground mb-5 tracking-[-0.02em]">
          {ticket.title}
        </h1>

        <div className="flex items-center gap-2 flex-wrap mb-6">
          <StatusChip ticket={ticket} anchorPopover />
          <PriorityChip ticket={ticket} anchorPopover />
          {(ticket as any).project && (
            <span className="text-[11px] rounded-full bg-surface/80 px-2 h-5 inline-flex items-center text-muted-foreground">
              {(ticket as any).project}
            </span>
          )}
          {ticket.tags.map((tag) => (
            <span key={tag} className="text-[11px] rounded-full bg-primary-soft px-2 h-5 inline-flex items-center text-primary">
              {tag}
            </span>
          ))}
        </div>

        {ticket.branch_name && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground mb-6">
            <GitBranch size={12} className="text-muted-foreground-soft" />
            <span className="font-mono">{ticket.branch_name}</span>
          </div>
        )}

        <div className="h-px bg-divider mb-6" />

        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground-soft py-6">
            <Loader2 size={13} className="animate-spin" />
            Loading description…
          </div>
        )}

        {!loading && (!content || !content.trim()) && (
          <p className="font-display-italic text-muted-foreground-soft text-[15px]">
            No description. The plan lives in the code.
          </p>
        )}

        {!loading && content && content.trim() && (
          <div className="task-markdown text-[14.5px] leading-[1.7] text-foreground">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              children={content}
              components={{
                img: ({ src, alt }) => <LinearImage src={src as string | undefined} alt={alt} />,
                h1: ({ children }) => <h2 className="font-display text-[22px] leading-tight mt-6 mb-2 tracking-[-0.015em]">{children}</h2>,
                h2: ({ children }) => <h3 className="text-[16px] font-semibold tracking-tight mt-5 mb-1.5">{children}</h3>,
                h3: ({ children }) => <h4 className="text-[13px] font-semibold mt-4 mb-1 uppercase tracking-[0.06em] text-muted-foreground">{children}</h4>,
                p:  ({ children }) => <p className="mb-3">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1 marker:text-muted-foreground-soft">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1 marker:text-muted-foreground-soft tabular-nums">{children}</ol>,
                li: ({ children }) => <li className="leading-[1.6]">{children}</li>,
                code: ({ children, className }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return (
                      <pre className="bg-surface/60 rounded-md p-3 my-3 overflow-x-auto">
                        <code className="font-mono text-[12.5px]">{children}</code>
                      </pre>
                    );
                  }
                  return <code className="font-mono text-[12.5px] bg-surface/70 px-[0.3em] py-[0.05em] rounded">{children}</code>;
                },
                pre: ({ children }) => <>{children}</>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-[3px] decoration-primary/40 hover:decoration-primary transition-colors">
                    {children}
                  </a>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="relative pl-4 pr-3 py-2 my-4 bg-primary-soft/40 rounded-r-md italic before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary before:rounded-r">
                    {children}
                  </blockquote>
                ),
                hr: () => <div className="h-px bg-divider my-6" />,
                input: ({ checked, ...props }) => (
                  <input type="checkbox" checked={checked} readOnly className="mr-1.5 h-3.5 w-3.5 rounded accent-primary align-middle" {...props} />
                ),
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="font-display-italic">{children}</em>,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
