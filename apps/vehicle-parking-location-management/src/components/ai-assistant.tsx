import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, LoaderCircle, Send, Sparkles, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ChatMessage = {
  role: 'assistant' | 'user';
  content: string;
};

const suggestions = [
  'What can you help me with in VPLM?',
  'Help me plan a vehicle transfer workflow.',
  'How should I check parking availability?',
];

export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hi! I’m the VPLM AI assistant. I can explain workflows and help you plan parking operations. This prototype does not yet read live vehicle records or perform actions. Please do not enter confidential or personal information.',
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open, busy]);

  const sendMessage = async (event?: FormEvent, suggestedMessage?: string) => {
    event?.preventDefault();
    const message = (suggestedMessage ?? input).trim();
    if (!message || busy) return;

    setMessages((current) => [...current, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);

    if (!supabase) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: 'AI chat requires a configured Supabase connection and a signed-in account. Guest/local mode is not supported for this online assistant.',
        },
      ]);
      setBusy(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { message },
      });
      if (error) throw error;
      if (typeof data?.reply !== 'string' || !data.reply.trim()) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'The AI service returned an empty response.');
      }
      setMessages((current) => [...current, { role: 'assistant', content: data.reply }]);
    } catch (error) {
      let detail = error instanceof Error ? error.message : 'Unknown error';
      if (typeof error === 'object' && error !== null && 'context' in error && error.context instanceof Response) {
        const responseBody = await error.context.clone().json().catch(() => null) as { error?: unknown } | null;
        if (typeof responseBody?.error === 'string') detail = responseBody.error;
      }
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: `I couldn’t get a reply from the AI assistant. ${detail}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="VPLM AI assistant"
          className="flex h-[min(600px,calc(100dvh-110px))] w-[min(390px,calc(100vw-28px))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-foreground/15">
                <Bot size={22} aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold">VPLM AI Assistant</h2>
                <p className="text-xs opacity-80">Preview · Gemini AI</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close AI assistant"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 transition hover:bg-primary-foreground/15"
            >
              <X size={20} />
            </button>
          </header>

          <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
            Testing mode: don’t enter confidential, personal, or live vehicle data. Replies are AI-generated and may be incorrect.
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'ml-auto rounded-br-sm bg-primary text-primary-foreground'
                    : 'mr-auto rounded-bl-sm bg-muted text-foreground'
                }`}
              >
                {message.content}
              </div>
            ))}
            {messages.length === 1 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-muted-foreground">Try asking:</p>
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={busy}
                    onClick={() => void sendMessage(undefined, suggestion)}
                    className="block w-full rounded-xl border border-border px-3 py-2 text-left text-xs transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div className="mr-auto flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                <LoaderCircle size={15} className="animate-spin" />
                Thinking…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(event) => void sendMessage(event)} className="flex items-end gap-2 border-t border-border p-3">
            <label className="sr-only" htmlFor="vplm-ai-message">Message the VPLM AI assistant</label>
            <textarea
              id="vplm-ai-message"
              rows={1}
              maxLength={2000}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Ask about a workflow…"
              className="max-h-28 min-h-10 flex-1 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={busy || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={17} />}
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        aria-label={open ? 'Close VPLM AI assistant' : 'Open VPLM AI assistant'}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-xl transition hover:scale-[1.02] hover:opacity-95"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
        <span>{open ? 'Close assistant' : 'Ask VPLM AI'}</span>
      </button>
    </div>
  );
}
