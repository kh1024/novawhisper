// Floating Ask-Nova bubble — bottom right, available on every page.
// Streams replies via the nova-chat edge function. Sends light page context.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles, X, Send, Loader2, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/lib/settings";
import { toast } from "sonner";
import { Hint } from "@/components/Hint";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "nova.chat.history";
const MAX_KEEP = 30;

function routeLabel(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  return pathname.replace(/^\//, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function loadHistory(): Msg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_KEEP) : [];
  } catch {
    return [];
  }
}

export function NovaChatBubble() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>(() => loadHistory());
  const [sending, setSending] = useState(false);
  const [settings] = useSettings();
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_KEEP))); } catch { /* ignore */ }
  }, [messages]);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const pageContext = useMemo(() => ({
    route: routeLabel(location.pathname),
    focusedSymbol: null,
    visibleSymbols: settings.tickerSymbols.slice(0, 12),
  }), [location.pathname, settings.tickerSymbols]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nova-chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: next,
          pageContext,
          model: settings.aiModel,
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) toast.error("Rate limited — try again in a moment.");
        else if (resp.status === 402) toast.error("AI credits exhausted. Add credits in Workspace settings.");
        else toast.error("Nova couldn't reply right now.");
        setMessages((prev) => prev.slice(0, -1)); // drop the user msg so they can retry
        setInput(text);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;

      while (!done) {
        const { value, done: rDone } = await reader.read();
        if (rDone) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(json);
            const c = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (c) upsertAssistant(c);
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("nova chat error", e);
        toast.error("Connection lost.");
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clear = () => {
    abortRef.current?.abort();
    setMessages([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-2xl shadow-primary/40 hover:scale-105 transition-transform flex items-center justify-center group"
          aria-label="Ask Nova"
        >
          <Sparkles className="h-6 w-6" />
          <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-bullish ring-2 ring-background animate-pulse" />
          <span className="absolute right-16 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md bg-popover text-popover-foreground border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Ask Nova
          </span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[380px] max-w-[calc(100vw-2.5rem)] h-[560px] max-h-[calc(100vh-2.5rem)] rounded-xl border border-border bg-popover/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-gradient-to-r from-primary/10 to-transparent">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold">Ask Nova</div>
                <div className="text-[10px] text-muted-foreground -mt-0.5">on {pageContext.route}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Hint label="Clear this conversation">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clear} aria-label="Clear chat">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Hint>
              )}
              <Hint label="Close Nova chat">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </Hint>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center pt-6 px-2 space-y-3">
                <div className="text-xs text-muted-foreground">
                  Ask anything about a ticker, a strategy, or what you're seeing on this page.
                </div>
                <div className="grid gap-1.5">
                  {[
                    "What should I watch this week?",
                    "Explain theta decay simply",
                    "Why did NVDA drop today?",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="text-[11px] text-left px-2 py-1.5 rounded border border-border bg-surface/40 hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-6 px-3 py-2 rounded-lg bg-primary/15 border border-primary/30 text-foreground"
                    : "mr-6 px-3 py-2 rounded-lg bg-surface/60 border border-border/50 text-foreground/95 [&_strong]:text-foreground [&_strong]:font-semibold [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:list-disc [&_li]:my-0.5 [&_code]:bg-background/60 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono"
                }`}
              >
                {m.role === "assistant" ? <ReactMarkdown>{m.content || "…"}</ReactMarkdown> : m.content}
              </div>
            ))}
            {sending && messages[messages.length - 1]?.role === "user" && (
              <div className="mr-6 px-3 py-2 rounded-lg bg-surface/60 border border-border/50 text-muted-foreground text-xs flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Nova is thinking…
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border p-2 flex gap-2 items-end bg-background/50">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask Nova anything…"
              rows={1}
              className="resize-none min-h-[40px] max-h-32 text-sm"
              disabled={sending}
            />
            <Hint label={sending ? "Nova is thinking…" : "Send message (Enter)"}>
              <Button
                size="icon"
                onClick={send}
                disabled={sending || !input.trim()}
                className="h-10 w-10 flex-shrink-0"
                aria-label="Send"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </Hint>
          </div>
        </div>
      )}
    </>
  );
}
