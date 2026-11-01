import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, LoaderCircle, Send, Sparkles, X } from 'lucide-react';
import { mapParkingLocationId, supportsXParkingLocation, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import { supabase } from '@/lib/supabase';

type ChatMessage = {
  role: 'assistant' | 'user';
  content: string;
};

type TransferFlow = {
  vehicleId: string;
  step: 'taking' | 'destination' | 'parked';
  selectedDestinationId?: string;
  destinationId?: string;
};

type AiAssistantProps = {
  vehicles: Vehicle[];
  locations: ParkingLocation[];
  canTransfer: boolean;
  locationLabel: (locationId?: string) => string;
  onTransfer: (vehicleId: string, destinationId: string, notes: string) => boolean;
};

const suggestions = [
  'What can you help me with in VPLM?',
  'Help me plan a vehicle transfer workflow.',
  'How should I check parking availability?',
];

const normalize = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeLocation = (value: string): string => normalize(mapParkingLocationId(value) ?? value);
const isYes = (value: string): boolean => /^(yes|y|yeah|yep)\b/i.test(value.trim());
const isNo = (value: string): boolean => /^(no|n|nope)\b/i.test(value.trim());

export default function AiAssistant({ vehicles, locations, canTransfer, locationLabel, onTransfer }: AiAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<TransferFlow | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hi! I can answer VPLM workflow questions and look up vehicles in this workspace. For transfers, I’ll ask you to confirm each step and will record the move only after you confirm the vehicle is parked in its new bay.',
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open, busy, flow]);

  const addAssistantMessage = (content: string) => {
    setMessages((current) => [...current, { role: 'assistant', content }]);
  };

  const activeFlowVehicle = flow ? vehicles.find((vehicle) => vehicle.id === flow.vehicleId && vehicle.status !== 'Delivered') : undefined;
  const availableDestinations = flow && activeFlowVehicle
    ? locations.filter((location) =>
        location.status === 'Available' &&
        !vehicles.some((vehicle) => vehicle.status !== 'Delivered' && normalizeLocation(vehicle.currentLocationId ?? '') === normalizeLocation(location.id)) &&
        (activeFlowVehicle.xParking !== 'Yes' || supportsXParkingLocation(location)),
      )
    : [];

  const continueTransferFlow = (answer: string) => {
    if (!flow) return;

    if (flow.step === 'taking') {
      if (isNo(answer)) {
        setFlow(null);
        addAssistantMessage('Okay. No transfer has been started.');
        return;
      }
      if (isYes(answer)) {
        setFlow({ ...flow, step: 'destination', selectedDestinationId: undefined });
        addAssistantMessage('Where are you planning to park it? Choose an available bay below, or type its label (for example, B-47).');
        return;
      }
      addAssistantMessage('Please answer Yes or No: are you taking this vehicle?');
      return;
    }

    if (flow.step === 'destination') {
      const typedBay = normalize(answer);
      const typedDestination = locations.find((location) =>
        typedBay === normalize(`${location.zone}-${location.bayNumber}`) ||
        typedBay === normalize(`${location.zone}-${Number(location.bayNumber)}`) ||
        typedBay === normalizeLocation(location.id),
      );
      const destinationId = flow.selectedDestinationId ?? typedDestination?.id;
      const destination = availableDestinations.find((location) => location.id === destinationId);
      if (!destination) {
        addAssistantMessage('That bay is not available for this vehicle. Choose one of the available bays shown below.');
        return;
      }
      setFlow({ ...flow, step: 'parked', destinationId: destination.id, selectedDestinationId: undefined });
      addAssistantMessage(`Please park ${activeFlowVehicle?.plateNumber} in ${destination.zone}-${destination.bayNumber}. Have you parked it there?`);
      return;
    }

    if (isNo(answer) || /^not yet\b/i.test(answer.trim())) {
      addAssistantMessage('No transfer has been recorded. Confirm Yes here once the vehicle is physically parked in the selected bay.');
      return;
    }
    if (!isYes(answer)) {
      addAssistantMessage('Please confirm Yes once it is parked, or choose Not yet. Nothing is recorded before confirmation.');
      return;
    }
    if (!activeFlowVehicle || !flow.destinationId) {
      setFlow(null);
      addAssistantMessage('The vehicle or destination is no longer available. Search for the vehicle again to start over.');
      return;
    }

    setBusy(true);
    const destination = locations.find((location) => location.id === flow.destinationId);
    const completed = onTransfer(
      activeFlowVehicle.id,
      flow.destinationId,
      'Transfer confirmed in VPLM AI assistant after user verified parking.',
    );
    if (completed) {
      setFlow(null);
      addAssistantMessage(`Transfer recorded: ${activeFlowVehicle.plateNumber} is now assigned to ${destination ? `${destination.zone}-${destination.bayNumber}` : 'the selected bay'}.`);
    } else {
      addAssistantMessage('The transfer could not be recorded. Check the selected bay and your transfer permissions, then try again.');
    }
    setBusy(false);
  };

  const findVehicleLookup = (message: string): { handled: boolean; vehicle?: Vehicle; duplicateMatches?: Vehicle[] } => {
    const normalizedMessage = normalize(message);
    const activeVehicles = vehicles.filter((vehicle) => vehicle.status !== 'Delivered' && normalize(vehicle.plateNumber));
    const exactTokens = new Set((message.match(/[A-Z0-9-]+/gi) ?? []).map(normalize));
    const exactMatches = activeVehicles.filter((vehicle) => exactTokens.has(normalize(vehicle.plateNumber)));
    const matches = exactMatches.length ? exactMatches : activeVehicles.filter((vehicle) => normalizedMessage.includes(normalize(vehicle.plateNumber)));
    const longestMatchLength = Math.max(0, ...matches.map((vehicle) => normalize(vehicle.plateNumber).length));
    const bestMatches = matches.filter((vehicle) => normalize(vehicle.plateNumber).length === longestMatchLength);
    if (bestMatches.length === 1) return { handled: true, vehicle: bestMatches[0] };
    if (bestMatches.length > 1) return { handled: true, duplicateMatches: bestMatches };

    const hasLookupIntent = /\b(search|find|lookup|look up|where|vehicle|plate|registration|details|model|color|colour|parked)\b/i.test(message);
    const hasRegistrationToken = /\b[A-Z0-9-]*\d[A-Z0-9-]*\b/i.test(message);
    const isRegistrationOnly = /^[A-Z0-9 -]{3,18}$/i.test(message.trim()) && /\d/.test(message);
    if (isRegistrationOnly || (hasRegistrationToken && hasLookupIntent)) return { handled: true };
    return { handled: false };
  };

  const sendMessage = async (event?: FormEvent, suggestedMessage?: string) => {
    event?.preventDefault();
    const message = (suggestedMessage ?? input).trim();
    if (!message || busy) return;

    setMessages((current) => [...current, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);

    if (flow) {
      continueTransferFlow(message);
      setBusy(false);
      return;
    }

    const lookup = findVehicleLookup(message);
    if (lookup.handled) {
      if (lookup.duplicateMatches) {
        addAssistantMessage(`More than one active vehicle matches that registration: ${lookup.duplicateMatches.map((vehicle) => vehicle.plateNumber).join(', ')}. Please search using the full registration.`);
      } else if (!lookup.vehicle) {
        addAssistantMessage('I could not find that registration in the current workspace.');
      } else {
        const vehicle = lookup.vehicle;
        const bay = vehicle.currentLocationId ? locationLabel(vehicle.currentLocationId) : 'not parked in a bay';
        const details = `${vehicle.plateNumber} — ${vehicle.brand} ${vehicle.model}, ${vehicle.color}. Current bay: ${bay}.`;
        if (!vehicle.currentLocationId) {
          addAssistantMessage(`${details} This vehicle has no active bay assignment, so a transfer cannot be started.`);
        } else if (!canTransfer) {
          addAssistantMessage(`${details} Your role can look up this vehicle but cannot transfer it.`);
        } else {
          setFlow({ vehicleId: vehicle.id, step: 'taking' });
          addAssistantMessage(`${details}\nAre you taking it?`);
        }
      }
      setBusy(false);
      return;
    }

    if (!supabase) {
      addAssistantMessage('AI chat requires a configured Supabase connection and a signed-in account. Guest/local mode is not supported for this online assistant.');
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
      addAssistantMessage(data.reply);
    } catch (error) {
      let detail = error instanceof Error ? error.message : 'Unknown error';
      if (typeof error === 'object' && error !== null && 'context' in error && error.context instanceof Response) {
        const responseBody = await error.context.clone().json().catch(() => null) as { error?: unknown } | null;
        if (typeof responseBody?.error === 'string') detail = responseBody.error;
      }
      addAssistantMessage(`I couldn’t get a reply from the AI assistant. ${detail}`);
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
            Vehicle lookups use this workspace. Transfers are recorded only after you confirm the vehicle is parked in its new bay. AI answers may be incorrect.
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

            {flow?.step === 'taking' && (
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Yes')} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Yes</button>
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('No')} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">No</button>
              </div>
            )}

            {flow?.step === 'destination' && (
              <div className="space-y-2 rounded-xl bg-muted p-3">
                <label className="block text-xs font-medium" htmlFor="assistant-destination">Available destination bay</label>
                <select
                  id="assistant-destination"
                  value={flow.selectedDestinationId ?? ''}
                  onChange={(event) => setFlow({ ...flow, selectedDestinationId: event.target.value || undefined })}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select a bay</option>
                  {availableDestinations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.zone}-{location.bayNumber}{location.section ? ` · ${location.section}` : ''}
                    </option>
                  ))}
                </select>
                {availableDestinations.length === 0 && <p className="text-xs text-muted-foreground">No eligible bays are currently available.</p>}
                <button
                  type="button"
                  disabled={busy || (!flow.selectedDestinationId && availableDestinations.length === 0)}
                  onClick={() => continueTransferFlow(flow.selectedDestinationId ?? '')}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Confirm destination
                </button>
              </div>
            )}

            {flow?.step === 'parked' && (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Yes')} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Yes, parked</button>
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Not yet')} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">Not yet</button>
                <button type="button" disabled={busy} onClick={() => { setFlow(null); addAssistantMessage('Transfer cancelled. No vehicle or bay data was changed.'); }} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
              </div>
            )}

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
              placeholder={flow?.step === 'destination' ? 'Or type a bay, e.g. B-47…' : 'Ask about a workflow or vehicle…'}
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
