"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Loader2, User, Bot, Trash2, Lightbulb } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAIAssistant, type ChatMessage } from "@/lib/api";
import { SectionHeader } from "@/components/shared";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CONTEXTS: { id: "customer" | "cook" | "manager" | "admin" | "general"; label: string; emoji: string; suggestions: string[] }[] = [
  {
    id: "customer", label: "Customer Assistant", emoji: "🍽️",
    suggestions: [
      "What services do you offer and how much do they cost?",
      "I'm vegan and cooking for 6 people — what do you recommend?",
      "How do I book a cook for a birthday event next Saturday?",
      "Can I get the same cook every week for meal prep?",
    ],
  },
  {
    id: "cook", label: "Cook Copilot", emoji: "👨‍🍳",
    suggestions: [
      "How can I improve my rating and get more bookings?",
      "What certifications do I need to work in East Legon?",
      "How do payouts work and when will I be paid?",
      "Help me set up my weekly availability.",
    ],
  },
  {
    id: "manager", label: "Manager Copilot", emoji: "📋",
    suggestions: [
      "Two cooks called in sick — how should I reassign today's jobs?",
      "Which regions have the lowest completion rate this week?",
      "How does the matching engine rank cooks?",
      "What's the best dispatch strategy for peak hours?",
    ],
  },
  {
    id: "admin", label: "Admin Copilot", emoji: "⚙️",
    suggestions: [
      "How do I enable the restaurant marketplace for Accra?",
      "What feature flags are available and what do they do?",
      "How do I add a new service and pricing rule?",
      "What KPIs should I monitor for multi-country expansion?",
    ],
  },
  {
    id: "general", label: "Platform Guide", emoji: "✨",
    suggestions: [
      "What is Eks-Food and what problem does it solve?",
      "How does the payment system work with Payswap?",
      "What modules are on the product roadmap?",
      "Is Eks-Food available outside Ghana?",
    ],
  },
];

export function AIAssistantModule() {
  const [contextId, setContextId] = useState<typeof CONTEXTS[number]["id"]>("customer");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const assistant = useAIAssistant();

  const ctx = CONTEXTS.find((c) => c.id === contextId)!;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, assistant.isPending]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || assistant.isPending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    try {
      const res = await assistant.mutateAsync({ message: trimmed, history: messages, context: contextId });
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e) {
      toast.error("Assistant unavailable", { description: e instanceof Error ? e.message : undefined });
      setMessages([...next, { role: "assistant", content: "I'm having trouble responding right now. Please try again." }]);
    }
  };

  const switchContext = (id: typeof contextId) => {
    setContextId(id);
    setMessages([]);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-5xl flex-col px-4 py-6 lg:px-8">
      <SectionHeader
        title="AI Assistant"
        description="Role-aware copilots grounded in live platform data — customers, cooks, managers & admins."
        action={
          <Select value={contextId} onValueChange={(v) => switchContext(v as typeof contextId)}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONTEXTS.map((c) => <SelectItem key={c.id} value={c.id}><span className="mr-1">{c.emoji}</span>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Context banner */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full brand-gradient text-xs text-white">{ctx.emoji}</div>
          <div className="flex-1">
            <div className="text-sm font-semibold">{ctx.label}</div>
            <div className="text-[11px] text-muted-foreground">Grounded in live Eks-Food data · Powered by GLM</div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setMessages([])}>
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl brand-gradient text-white shadow-lg">
                <Sparkles className="h-7 w-7" />
              </div>
              <h3 className="text-base font-semibold">{ctx.label}</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">Ask anything about Eks-Food. Try one of these to start:</p>
              <div className="mt-4 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                {ctx.suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)} className="group flex items-start gap-2 rounded-lg border border-border p-3 text-left text-xs transition-colors hover:bg-muted/60">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-foreground/80 group-hover:text-foreground">{s}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <MessageBubble key={i} message={m} />)
          )}
          {assistant.isPending && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full brand-gradient text-white"><Bot className="h-4 w-4" /></div>
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-3">
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex items-end gap-2"
          >
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
                }}
                placeholder={`Message the ${ctx.label}…`}
                rows={1}
                className="max-h-32 w-full resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-xl" disabled={!input.trim() || assistant.isPending}>
              {assistant.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">AI can make mistakes. Verify important information.</p>
        </div>
      </Card>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white", isUser ? "bg-foreground" : "brand-gradient")}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed", isUser ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted")}>
        {message.content}
      </div>
    </div>
  );
}
