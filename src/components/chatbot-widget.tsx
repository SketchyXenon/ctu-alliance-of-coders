"use client";

import * as React from "react";
import { Bot, Send, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** Stable id per bubble so list keys survive message splices. */
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I'm the Alliance of Coders assistant. Ask me about announcements, officers, FAQs, or policies on this site.",
};

const MAX_INPUT = 1000;

/**
 * ChatbotWidget - floating, content-grounded site assistant.
 *
 * Renders only when the admin has enabled the assistant (GET /api/chat). The
 * button sits bottom-left so it never collides with BackToTop (bottom-right).
 * All answers come from the server route, which grounds the model in website
 * content and refuses off-scope/code/image/malware requests.
 *
 * Per 05-ui-ux: full state set (loading/disabled/error), keyboard accessible,
 * plain copy, consistent navy/gold + token styling, respects reduced motion.
 */
export function ChatbotWidget() {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Probe whether the assistant is enabled. Never renders the button if not.
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/chat", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((d: { enabled?: boolean }) => {
        if (!cancelled) setEnabled(!!d.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll to the latest message + focus the input when opened.
  React.useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, messages.length]);

  // Close on Escape (WCAG 2.1.2 / dialog convention).
  React.useEffect(() => {
    if (!open) return;
    function onPanelKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onPanelKeyDown);
    return () => window.removeEventListener("keydown", onPanelKeyDown);
  }, [open]);

  if (enabled === false) return null;

  async function send() {
    const content = input.trim();
    if (!content || loading) return;
    if (content.length > MAX_INPUT) {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: "Your message is too long. Please shorten it and try again.",
        },
      ]);
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: newId(), role: "user", content },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    // Send only the recent turns; the server re-validates and grounds.
    const payload = nextMessages
      .filter((m) => m !== WELCOME)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error ?? "Something went wrong. Please try again.";
        // 429/503 are expected under rate limits / when disabled.
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "assistant", content: msg },
        ]);
      } else if (typeof data?.reply === "string") {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "assistant", content: data.reply },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: "I couldn't generate a response. Please try again.",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: "Network error. Please check your connection and try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function resetChat() {
    setMessages([WELCOME]);
  }

  return (
    <>
      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Alliance of Coders assistant"
          aria-modal="false"
          className={cn(
            "fixed bottom-20 left-4 z-50 flex max-h-[70vh] w-[min(92vw,24rem)] flex-col overflow-hidden rounded-xl",
            "border border-border/70 bg-card shadow-2xl shadow-ink-900/20",
            "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-gradient-to-br from-ink-700 to-ink-900 px-4 py-3">
            <div className="flex items-center gap-2 text-white">
              <span className="flex size-7 items-center justify-center rounded-full bg-teal-500/20 text-teal-300">
                <Bot className="size-4" aria-hidden="true" />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold">AoC Assistant</div>
                <div className="text-[10px] uppercase tracking-wider text-white/60">
                  Website-only answers
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={resetChat}
                className="h-7 px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Clear conversation"
              >
                Clear
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="size-7 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Close assistant"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="max-h-[40vh] flex-1 overflow-y-auto">
            <div className="space-y-3 p-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex gap-1" aria-hidden="true">
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                  </span>
                  <span className="sr-only">Assistant is typing</span>
                </div>
              )}
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-border/60 p-3">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about announcements, officers, FAQ..."
              rows={2}
              maxLength={MAX_INPUT}
              disabled={loading}
              aria-label="Message the assistant"
              className="resize-none text-sm"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                Enter to send, Shift+Enter for a new line
              </span>
              <Button
                size="sm"
                onClick={() => void send()}
                disabled={loading || !input.trim()}
                className="gap-1.5"
                aria-label="Send message"
              >
                <Send className="size-3.5" aria-hidden="true" />
                Send
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Floating button (bottom-left; avoids BackToTop on the right) */}
      {!open && (
        <Button
          onClick={() => setOpen(true)}
          aria-label="Open the Alliance of Coders assistant"
          className={cn(
            "fixed bottom-6 left-6 z-50 h-12 gap-2 rounded-full px-4",
            "bg-gradient-to-br from-ink-700 to-ink-900 text-teal-400",
            "shadow-lg shadow-ink-900/30 ring-1 ring-teal-400/30",
            "hover:from-ink-600 hover:to-ink-800 hover:text-teal-300 hover:ring-teal-400/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2",
          )}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          <span className="text-sm font-medium">Ask AoC</span>
        </Button>
      )}
    </>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed",
          isUser ? "bg-teal-500 text-ink-900" : "bg-muted text-foreground",
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
