import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Bot, CircleParking, LoaderCircle, MapPin, MoveRight, Route, Search, Send, Sparkles, X } from 'lucide-react';
import { mapParkingLocationId, supportsXParkingLocation, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import { supabase } from '@/lib/supabase';
import { VplmCodexPet } from '@/components/vplm-codex-pet';

type ChatMessage = {
  role: 'assistant' | 'user';
  content: string;
};

type AssistantFunction = 'find' | 'assign' | 'transfer' | 'road-test' | 'availability';

type TransferFlow = {
  vehicleId?: string;
  step: 'vehicle' | 'taking' | 'destination' | 'parked';
  selectedDestinationId?: string;
  destinationId?: string;
};

type AiAssistantProps = {
  vehicles: Vehicle[];
  locations: ParkingLocation[];
  role: string;
  canAssign: boolean;
  canTransfer: boolean;
  canRequestInitialRoadTest: boolean;
  locationLabel: (locationId?: string) => string;
  onAssign: (plateNumber: string, vehicle?: Vehicle) => boolean;
  onInitialRoadTest: (vehicleId: string) => boolean;
  onTransfer: (vehicleId: string, destinationId: string, notes: string) => boolean;
};

const directory: { id: AssistantFunction | 'help'; key: string; label: string; description: string; example: string; icon: typeof Search }[] = [
  { id: 'find', key: 'FIND', label: 'Find vehicle', description: 'Look up registration, model, colour, and current bay.', example: 'Find 938848', icon: Search },
  { id: 'assign', key: 'ASSIGN', label: 'Add / Assign', description: 'Open the validated vehicle intake and bay assignment form.', example: 'Assign 938848', icon: CircleParking },
  { id: 'transfer', key: 'TRANSFER', label: 'Transfer', description: 'Guide a confirmed vehicle move to an available bay.', example: 'Transfer 938848', icon: MoveRight },
  { id: 'road-test', key: 'IRT', label: 'Initial Road Test', description: 'Technical Leaders can start an IRT request for a registered vehicle.', example: 'IRT 938848', icon: Route },
  { id: 'availability', key: 'BAY', label: 'Bay availability', description: 'Check available spaces by zone or bay number.', example: 'BAY B', icon: MapPin },
  { id: 'help', key: 'HELP', label: 'Function directory', description: 'Show shortcuts, supported tasks, and example prompts.', example: 'HELP', icon: BookOpen },
];

const normalize = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeLocation = (value: string): string => normalize(mapParkingLocationId(value) ?? value);
const isYes = (value: string): boolean => /^(yes|y|yeah|yep)\b/i.test(value.trim());
const isNo = (value: string): boolean => /^(no|n|nope)\b/i.test(value.trim());

const shortcutHelp = directory
  .map(({ key, label, description, example }) => `${key} · ${label}: ${description} Example: “${example}”.`)
  .join('\n');

export default function AiAssistant({
  vehicles,
  locations,
  role,
  canAssign,
  canTransfer,
  canRequestInitialRoadTest,
  locationLabel,
  onAssign,
  onInitialRoadTest,
  onTransfer,
}: AiAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeFunction, setActiveFunction] = useState<AssistantFunction | null>(null);
  const [transferFlow, setTransferFlow] = useState<TransferFlow | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Hi! Choose a VPLM function below or type HELP to see the directory. Vehicle searches and bay checks use the current workspace; transfers are only recorded after parking confirmation.',
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open, busy, transferFlow, activeFunction]);

  const addAssistantMessage = (content: string) => {
    setMessages((current) => [...current, { role: 'assistant', content }]);
  };

  const activeFlowVehicle = transferFlow?.vehicleId
    ? vehicles.find((vehicle) => vehicle.id === transferFlow.vehicleId && vehicle.status !== 'Delivered')
    : undefined;

  const availableDestinations = transferFlow && activeFlowVehicle
    ? locations.filter((location) =>
        location.status === 'Available' &&
        !vehicles.some((vehicle) => vehicle.status !== 'Delivered' && normalizeLocation(vehicle.currentLocationId ?? '') === normalizeLocation(location.id)) &&
        (activeFlowVehicle.xParking !== 'Yes' || supportsXParkingLocation(location)),
      )
    : [];

  const findVehicle = (message: string): { registration?: string; vehicle?: Vehicle; duplicates?: Vehicle[] } => {
    const activeVehicles = vehicles.filter((vehicle) => vehicle.status !== 'Delivered' && normalize(vehicle.plateNumber));
    const normalizedMessage = normalize(message);
    const exactTokens = new Set((message.match(/[A-Z0-9-]+/gi) ?? []).map(normalize));
    const exactMatches = activeVehicles.filter((vehicle) => exactTokens.has(normalize(vehicle.plateNumber)));
    const matches = exactMatches.length
      ? exactMatches
      : activeVehicles.filter((vehicle) => normalizedMessage.includes(normalize(vehicle.plateNumber)));
    const longestMatchLength = Math.max(0, ...matches.map((vehicle) => normalize(vehicle.plateNumber).length));
    const bestMatches = matches.filter((vehicle) => normalize(vehicle.plateNumber).length === longestMatchLength);
    if (bestMatches.length === 1) return { registration: bestMatches[0].plateNumber, vehicle: bestMatches[0] };
    if (bestMatches.length > 1) return { duplicates: bestMatches };
    return { registration: message.match(/[A-Z0-9-]*\d[A-Z0-9-]*/i)?.[0] };
  };

  const showVehicleDetails = (vehicle: Vehicle, offerTransfer: boolean) => {
    const bay = vehicle.currentLocationId ? locationLabel(vehicle.currentLocationId) : 'not parked in a bay';
    const details = `${vehicle.plateNumber} — ${vehicle.brand} ${vehicle.model}, ${vehicle.color}. Current bay: ${bay}.`;
    if (!offerTransfer) {
      addAssistantMessage(details);
      return;
    }
    if (!vehicle.currentLocationId) {
      addAssistantMessage(`${details} This vehicle has no active bay assignment, so a transfer cannot be started.`);
      return;
    }
    if (!canTransfer) {
      addAssistantMessage(`${details} Your role can look up this vehicle but cannot transfer it.`);
      return;
    }
    setActiveFunction('transfer');
    setTransferFlow({ vehicleId: vehicle.id, step: 'taking' });
    addAssistantMessage(`${details}\nAre you taking it?`);
  };

  const showBayAvailability = (query: string) => {
    const occupiedIds = new Set(vehicles
      .filter((vehicle) => vehicle.status !== 'Delivered' && vehicle.currentLocationId)
      .map((vehicle) => normalizeLocation(vehicle.currentLocationId ?? '')));
    const zones = [...new Set(locations.map((location) => location.zone))].sort();
    const bayToken = query.match(/\b[A-Z]+[- ]?\d{1,3}\b/i)?.[0];
    const normalizedBayToken = bayToken ? normalize(bayToken) : '';
    const requestedBay = locations.find((location) =>
      normalizedBayToken === normalize(`${location.zone}${Number(location.bayNumber)}`),
    );
    if (requestedBay) {
      const occupied = occupiedIds.has(normalizeLocation(requestedBay.id));
      const status = occupied ? 'occupied' : requestedBay.status.toLowerCase();
      addAssistantMessage(`${requestedBay.zone}-${requestedBay.bayNumber} is ${status}${requestedBay.remarks ? ` · ${requestedBay.remarks}` : ''}.`);
      return;
    }

    const requestedZone = query.match(/\b(?:zone|in|bay|bays)\s+([A-Z][A-Z0-9-]*)\b/i)?.[1]
      ?? query.match(/\b([A-Z])\s+(?:zone|bays?)\b/i)?.[1];
    const selectedZones = requestedZone
      ? zones.filter((zone) => normalize(zone) === normalize(requestedZone))
      : zones;
    if (requestedZone && !selectedZones.length) {
      addAssistantMessage(`I couldn’t find zone ${requestedZone}. Available zones: ${zones.join(', ')}.`);
      return;
    }

    const summary = selectedZones.map((zone) => {
      const zoneLocations = locations.filter((location) => location.zone === zone);
      const available = zoneLocations.filter((location) =>
        location.status === 'Available' && !occupiedIds.has(normalizeLocation(location.id)),
      );
      const examples = available.slice(0, 8).map((location) => `${location.zone}-${location.bayNumber}`);
      return `${zone}: ${available.length} of ${zoneLocations.length} bays available${examples.length ? ` (${examples.join(', ')}${available.length > examples.length ? ', …' : ''})` : ''}.`;
    });
    addAssistantMessage(`${summary.join('\n')}\nAsk for a zone or a bay (for example, “BAY B” or “Is B-47 available?”) for a focused check.`);
  };

  const runFunction = (action: AssistantFunction, query: string) => {
    const registration = findVehicle(query);
    if (action === 'availability') {
      setActiveFunction(null);
      showBayAvailability(query);
      return;
    }

    if (action === 'find' || action === 'transfer') {
      if (registration.duplicates) {
        setActiveFunction(null);
        addAssistantMessage(`More than one vehicle matches. Please enter the full registration: ${registration.duplicates.map((vehicle) => vehicle.plateNumber).join(', ')}.`);
        return;
      }
      if (registration.vehicle) {
        if (action === 'find') {
          setActiveFunction(null);
          showVehicleDetails(registration.vehicle, false);
        } else if (!canTransfer) {
          setActiveFunction(null);
          addAssistantMessage('Your role does not have permission to transfer vehicles.');
        } else {
          setActiveFunction('transfer');
          setTransferFlow({ vehicleId: registration.vehicle.id, step: 'taking' });
          showVehicleDetails(registration.vehicle, true);
        }
        return;
      }
      if (registration.registration) {
        setActiveFunction(null);
        addAssistantMessage(`I could not find ${registration.registration} in the current workspace.`);
      } else {
        setActiveFunction(action);
        addAssistantMessage('Please enter the vehicle registration number.');
      }
      return;
    }

    if (action === 'assign') {
      if (!canAssign) {
        setActiveFunction(null);
        addAssistantMessage('Your role does not have permission to add or assign vehicles.');
        return;
      }
      if (!registration.registration) {
        setActiveFunction('assign');
        addAssistantMessage('Enter the vehicle registration number to open the validated Add / Assign form. You can complete the vehicle details and choose a bay there.');
        return;
      }
      if (registration.vehicle?.currentLocationId) {
        setActiveFunction(null);
        addAssistantMessage(`${registration.vehicle.plateNumber} already has an active bay assignment. Use Transfer to move it instead.`);
        return;
      }
      const opened = onAssign(registration.registration, registration.vehicle);
      setActiveFunction(null);
      addAssistantMessage(opened
        ? `The Add / Assign form is ready for ${registration.vehicle?.plateNumber ?? registration.registration}. Review or complete the vehicle details and select a bay; nothing is saved until you submit the form.`
        : 'I could not open Add / Assign. Check your permission and the vehicle’s current assignment.');
      return;
    }

    if (action === 'road-test') {
      if (role !== 'TechnicalLeader' || !canRequestInitialRoadTest) {
        setActiveFunction(null);
        addAssistantMessage('The assistant can initiate an Initial Road Test (IRT) request only for a Technical Leader. Use the Road Tests screen if your role provides access.');
        return;
      }
      if (registration.duplicates) {
        setActiveFunction(null);
        addAssistantMessage(`More than one vehicle matches. Please enter the full registration: ${registration.duplicates.map((vehicle) => vehicle.plateNumber).join(', ')}.`);
        return;
      }
      if (!registration.vehicle) {
        setActiveFunction(registration.registration ? null : 'road-test');
        addAssistantMessage(registration.registration
          ? `I could not find ${registration.registration} in the current workspace. An IRT request requires an existing vehicle.`
          : 'Enter the registered vehicle number. IRT means Initial Road Test.');
        return;
      }
      const opened = onInitialRoadTest(registration.vehicle.id);
      setActiveFunction(null);
      addAssistantMessage(opened
        ? `The Initial Road Test request is open for ${registration.vehicle.plateNumber}. Review the vehicle, add job-card or purpose details if needed, then select Create assignment. The request is not created until you submit it.`
        : 'I could not open the Initial Road Test request. Check that you are signed in as a Technical Leader.');
    }
  };

  const startFunction = (action: AssistantFunction | 'help') => {
    setTransferFlow(null);
    setActiveFunction(null);
    if (action === 'help') {
      addAssistantMessage(`VPLM function directory and shortcuts:\n${shortcutHelp}\n\nYou can click a function or type its shortcut. “Help” and “Directory” show this list.`);
      return;
    }
    if (action === 'transfer') {
      setActiveFunction('transfer');
      setTransferFlow({ step: 'vehicle' });
      addAssistantMessage('Transfer function selected. Enter the vehicle registration to begin the confirmation flow.');
      return;
    }
    setActiveFunction(action);
    if (action === 'find') addAssistantMessage('Find vehicle selected. Enter a registration number to see its vehicle details and current bay.');
    if (action === 'assign') addAssistantMessage('Add / Assign selected. Enter the vehicle registration; I’ll open the validated form so you can complete details and choose a bay.');
    if (action === 'road-test') addAssistantMessage('Initial Road Test Request selected. A Technical Leader can enter a registered vehicle number to open the IRT request form.');
    if (action === 'availability') {
      setActiveFunction(null);
      showBayAvailability('');
    }
  };

  const continueTransferFlow = (answer: string) => {
    if (!transferFlow) return;

    if (transferFlow.step === 'vehicle') {
      if (!canTransfer) {
        setTransferFlow(null);
        setActiveFunction(null);
        addAssistantMessage('Your role does not have permission to transfer vehicles.');
        return;
      }
      const match = findVehicle(answer);
      if (match.duplicates) {
        addAssistantMessage(`More than one vehicle matches. Please enter the full registration: ${match.duplicates.map((vehicle) => vehicle.plateNumber).join(', ')}.`);
        return;
      }
      if (!match.vehicle) {
        addAssistantMessage(match.registration
          ? `I could not find ${match.registration} in the current workspace. Enter a registered vehicle number to continue.`
          : 'Please enter a registered vehicle number to continue.');
        return;
      }
      if (!match.vehicle.currentLocationId) {
        setTransferFlow(null);
        setActiveFunction(null);
        addAssistantMessage(`${match.vehicle.plateNumber} has no active bay assignment, so it cannot be transferred.`);
        return;
      }
      setTransferFlow({ vehicleId: match.vehicle.id, step: 'taking' });
      showVehicleDetails(match.vehicle, true);
      return;
    }

    if (transferFlow.step === 'taking') {
      if (isNo(answer)) {
        setTransferFlow(null);
        setActiveFunction(null);
        addAssistantMessage('Okay. No transfer has been started.');
        return;
      }
      if (isYes(answer)) {
        setTransferFlow({ ...transferFlow, step: 'destination', selectedDestinationId: undefined });
        addAssistantMessage('Where are you planning to park it? Choose an available bay below, or type its label (for example, B-47).');
        return;
      }
      addAssistantMessage('Please answer Yes or No: are you taking this vehicle?');
      return;
    }

    if (transferFlow.step === 'destination') {
      const typedBay = normalize(answer);
      const typedDestination = locations.find((location) =>
        typedBay === normalize(`${location.zone}-${location.bayNumber}`) ||
        typedBay === normalize(`${location.zone}-${Number(location.bayNumber)}`) ||
        typedBay === normalizeLocation(location.id),
      );
      const destinationId = transferFlow.selectedDestinationId ?? typedDestination?.id;
      const destination = availableDestinations.find((location) => location.id === destinationId);
      if (!destination) {
        addAssistantMessage('That bay is not available for this vehicle. Choose one of the available bays shown below.');
        return;
      }
      setTransferFlow({ ...transferFlow, step: 'parked', destinationId: destination.id, selectedDestinationId: undefined });
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
    if (!activeFlowVehicle || !transferFlow.destinationId) {
      setTransferFlow(null);
      setActiveFunction(null);
      addAssistantMessage('The vehicle or destination is no longer available. Search for the vehicle again to start over.');
      return;
    }

    const destination = locations.find((location) => location.id === transferFlow.destinationId);
    const completed = onTransfer(
      activeFlowVehicle.id,
      transferFlow.destinationId,
      'Transfer confirmed in VPLM AI assistant after user verified parking.',
    );
    if (completed) {
      setTransferFlow(null);
      setActiveFunction(null);
      addAssistantMessage(`Transfer recorded: ${activeFlowVehicle.plateNumber} is now assigned to ${destination ? `${destination.zone}-${destination.bayNumber}` : 'the selected bay'}.`);
    } else {
      addAssistantMessage('The transfer could not be recorded. Check the selected bay and your transfer permissions, then try again.');
    }
  };

  const getCommand = (message: string): AssistantFunction | 'help' | undefined => {
    const command = message.trim().toLowerCase();
    if (/^(help|directory|function directory|function list|list functions|functions|\/help|help me)$/i.test(command) || /\b(function directory|list functions|help me)\b/i.test(command)) return 'help';
    if (/^(find|\/find|fnd)(\b|$)/i.test(command) || /\b(find|search|look up)\s+(?:vehicle|car)\b/i.test(command)) return 'find';
    if (/^(assign|add|\/assign|asn)(\b|$)/i.test(command) || /\b(add|assign)\s+(?:a\s+)?vehicle\b/i.test(command)) return 'assign';
    if (/^(transfer|\/transfer|trf)(\b|$)/i.test(command) || /\btransfer\s+(?:vehicle|car)\b/i.test(command)) return 'transfer';
    if (/^(irt|\/irt|road[\s-]*test)(\b|$)/i.test(command) || /\b(initial road test|road test request)\b/i.test(command)) return 'road-test';
    if (/^(bay|\/bay|availability)(\b|$)/i.test(command) ||
      /\b(bay availability|parking availability|available bays)\b/i.test(command) ||
      (/\b(available|availability|occupied|free)\b/i.test(command) && /\b[A-Z]+[- ]?\d{1,3}\b/i.test(message))) return 'availability';
    return undefined;
  };

  const sendMessage = async (event?: FormEvent, suggestedMessage?: string) => {
    event?.preventDefault();
    const message = (suggestedMessage ?? input).trim();
    if (!message || busy) return;

    setMessages((current) => [...current, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);

    if (transferFlow) {
      continueTransferFlow(message);
      setBusy(false);
      return;
    }

    if (activeFunction) {
      runFunction(activeFunction, message);
      setBusy(false);
      return;
    }

    const command = getCommand(message);
    if (command === 'help') {
      startFunction('help');
      setBusy(false);
      return;
    }
    if (command) {
      if (command === 'transfer') {
        if (!canTransfer) {
          setActiveFunction(null);
          addAssistantMessage('Your role does not have permission to transfer vehicles.');
          setBusy(false);
          return;
        }
        setActiveFunction('transfer');
        const match = findVehicle(message);
        if (match.vehicle && canTransfer) {
          setTransferFlow({ vehicleId: match.vehicle.id, step: 'taking' });
          showVehicleDetails(match.vehicle, true);
        } else if (match.registration && !match.vehicle) {
          setActiveFunction(null);
          addAssistantMessage(`I could not find ${match.registration} in the current workspace.`);
        } else {
          setTransferFlow({ step: 'vehicle' });
          addAssistantMessage('Transfer function selected. Enter the vehicle registration to begin the confirmation flow.');
        }
      } else {
        const isShortcutOnly = directory.some((item) => item.key.toLowerCase() === message.trim().toLowerCase());
        if (isShortcutOnly || message.trim().startsWith('/')) {
          startFunction(command);
        } else {
          runFunction(command, message);
        }
      }
      setBusy(false);
      return;
    }

    const directVehicle = findVehicle(message);
    if (directVehicle.vehicle) {
      showVehicleDetails(directVehicle.vehicle, true);
      setBusy(false);
      return;
    }
    const isRegistrationOnly = /^[A-Z0-9 -]{3,18}$/i.test(message) && /\d/.test(message);
    const hasLookupIntent = /\b(vehicle|plate|registration|where|find|search|lookup|look up|parked)\b/i.test(message);
    if (directVehicle.registration && (isRegistrationOnly || hasLookupIntent)) {
      addAssistantMessage(`I could not find ${directVehicle.registration} in the current workspace.`);
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
          className="flex h-[min(680px,calc(100dvh-110px))] w-[min(420px,calc(100vw-28px))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-foreground/15">
                <Bot size={22} aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold">VPLM AI Assistant</h2>
                <p className="text-xs opacity-80">Workspace functions · Gemini AI</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Show function directory"
                onClick={() => startFunction('help')}
                className="rounded-lg p-2 transition hover:bg-primary-foreground/15"
              >
                <BookOpen size={19} />
              </button>
              <button
                type="button"
                aria-label="Close AI assistant"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 transition hover:bg-primary-foreground/15"
              >
                <X size={20} />
              </button>
            </div>
          </header>

          <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
            Workspace data is used for vehicle and bay lookups. Transfers and requests are saved only after you submit their app forms and confirmations. AI answers may be incorrect.
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`max-w-[95%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'ml-auto rounded-br-sm bg-primary text-primary-foreground'
                    : 'mr-auto rounded-bl-sm bg-muted text-foreground'
                }`}
              >
                {message.content}
              </div>
            ))}

            {transferFlow?.step === 'taking' && (
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Yes')} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Yes</button>
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('No')} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">No</button>
              </div>
            )}

            {transferFlow?.step === 'destination' && (
              <div className="space-y-2 rounded-xl bg-muted p-3">
                <label className="block text-xs font-medium" htmlFor="assistant-destination">Available destination bay</label>
                <select
                  id="assistant-destination"
                  value={transferFlow.selectedDestinationId ?? ''}
                  onChange={(event) => setTransferFlow({ ...transferFlow, selectedDestinationId: event.target.value || undefined })}
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
                  disabled={busy || (!transferFlow.selectedDestinationId && availableDestinations.length === 0)}
                  onClick={() => continueTransferFlow(transferFlow.selectedDestinationId ?? '')}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Confirm destination
                </button>
              </div>
            )}

            {transferFlow?.step === 'parked' && (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Yes')} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Yes, parked</button>
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Not yet')} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">Not yet</button>
                <button type="button" disabled={busy} onClick={() => { setTransferFlow(null); setActiveFunction(null); addAssistantMessage('Transfer cancelled. No vehicle or bay data was changed.'); }} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
              </div>
            )}

            {messages.length === 1 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold text-muted-foreground">Function directory · use a button or shortcut</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {directory.map(({ id, key, label, description, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      disabled={busy}
                      onClick={() => startFunction(id)}
                      className="rounded-xl border border-border p-3 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold"><Icon size={16} />{label}<span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{key}</span></span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>
                    </button>
                  ))}
                </div>
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
              placeholder={transferFlow?.step === 'destination' ? 'Or type a bay, e.g. B-47…' : 'Enter a prompt or function shortcut…'}
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

      <VplmCodexPet awake={open} onToggle={() => setOpen(current => !current)} />
    </div>
  );
}
