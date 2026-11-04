import { findActivePickup, loadPickupVehicleLocation, pickupLocationWarning, pickupParkingNotice } from '@/lib/pickup-request-data';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Bot, CarFront, CircleParking, LoaderCircle, MapPin, MoveRight, Route, Search, Send, Sparkles, X } from 'lucide-react';
import { mapParkingLocationId, supportsXParkingLocation, type Movement, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import { parseAssistantBay } from '@/lib/assistant-bay';
import { assistantDisplay, assistantLanguages, isAssistantLanguage, readAssistantLanguage } from '@/lib/assistant-language';
import { supabase } from '@/lib/supabase';
import { VplmCodexPet } from '@/components/vplm-codex-pet';

import { AssistantRoadTest, type RoadTestChatHandle } from '@/components/assistant-road-test';
import { AssistantPickup } from '@/components/assistant-pickup';
import { loadRoadTests, type RoadTestType } from '@/lib/road-test-data';

type ChatMessage = {
  role: 'assistant' | 'user';
  content: string;
  language?: keyof typeof assistantLanguages;
};

type AssistantFunction = 'find' | 'assign' | 'transfer' | 'road-test' | 'availability' | 'pickup-request';

type TransferFlow = {
  vehicleId?: string;
  step: 'vehicle' | 'taking' | 'destination' | 'parked';
  selectedDestinationId?: string;
  destinationId?: string;
  destinationIsXParking?: boolean;
};

type AiAssistantProps = {
  vehicles: Vehicle[];
  locations: ParkingLocation[];
  movements: Movement[];
  role: string;
  actor: string;
  userId: string;
  canAccessRoadTests: boolean;
  onRoadTestLocationChange: React.ComponentProps<typeof AssistantRoadTest>['onLocationChange'];
  canAssign: boolean;
  canTransfer: boolean;
  locationLabel: (locationId?: string) => string;
  onAssign: (plateNumber: string, vehicle?: Vehicle) => boolean;
  onTransfer: (vehicleId: string, destinationId: string, notes: string, toXParking?: boolean) => boolean;
};

const directory: { id: AssistantFunction | 'help'; key: string; label: string; description: string; example: string; icon: typeof Search }[] = [
  { id: 'find', key: 'FIND', label: 'Find vehicle', description: 'Look up registration, model, colour, and current bay.', example: 'Find 938848', icon: Search },
  { id: 'assign', key: 'ASSIGN', label: 'Add / Assign', description: 'Open the validated vehicle intake and bay assignment form.', example: 'Assign 938848', icon: CircleParking },
  { id: 'transfer', key: 'TRANSFER', label: 'Transfer', description: 'Guide a confirmed vehicle move to an available bay.', example: 'Transfer 938848', icon: MoveRight },
  { id: 'road-test', key: 'IRT', label: 'Road tests', description: 'Type IRT or FRT, then use chat to select, start, and finish a task. Technical Leaders can also create a task.', example: 'IRT 938848', icon: Route },
  { id: 'pickup-request', key: 'PICKUP', label: 'Vehicle pickup request', description: 'Request a parked vehicle pickup for Reception or Workshop.', example: 'PICKUP 938848', icon: CarFront },
  { id: 'availability', key: 'BAY', label: 'Bay availability', description: 'Check available spaces by zone or bay number.', example: 'BAY B', icon: MapPin },
  { id: 'help', key: 'HELP', label: 'Function directory', description: 'Show shortcuts, supported tasks, and example prompts.', example: 'HELP', icon: BookOpen },
];

const isClearCommand = (message: string) => /^\/?clear(?: chat(?: history)?)?$/i.test(message.trim());
const normalize = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeLocation = (value: string): string => normalize(mapParkingLocationId(value) ?? value);
const isYes = (value: string): boolean => /^(yes|y|yeah|yep)\b/i.test(value.trim());
const isNo = (value: string): boolean => /^(no|n|nope)\b/i.test(value.trim());

const shortcutHelp = directory
  .map(({ key, label, description, example }) => `${key} · ${label}: ${description} Example: “${example}”.`)
  .concat('CLEAR · Clear chat history')
  .join('\n');

export default function AiAssistant({
  vehicles,
  locations,
  movements,
  role,
  actor,
  userId,
  canAccessRoadTests,
  onRoadTestLocationChange,
  canAssign,
  canTransfer,
  locationLabel,
  onAssign,
  onTransfer,
}: AiAssistantProps) {
  const replyKey = `vplm-assistant-language:${userId}`;
  const displayKey = `vplm-assistant-display-language:${userId}`;
  const [language, setLanguage] = useState(() => readAssistantLanguage(replyKey));
  const [displayLanguage, setDisplayLanguage] = useState(() => readAssistantLanguage(displayKey));
  const languageText = assistantDisplay[displayLanguage];
  useEffect(() => {
    setLanguage(readAssistantLanguage(replyKey));
    setDisplayLanguage(readAssistantLanguage(displayKey));
  }, [displayKey, replyKey]);
  const changeLanguage = (value: string, display: boolean) => {
    if (!isAssistantLanguage(value)) return;
    if (display) setDisplayLanguage(value);
    else setLanguage(value);
    try {
      window.localStorage.setItem(display ? displayKey : replyKey, value);
    } catch {
      // Keep the selected language for this session.
    }
  };

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeFunction, setActiveFunction] = useState<AssistantFunction | null>(null);
  const [transferFlow, setTransferFlow] = useState<TransferFlow | null>(null);
  const [roadTest, setRoadTest] = useState<{ type: RoadTestType; vehicleId?: string; resumeId?: string }>();
  const roadTestChat = useRef<RoadTestChatHandle>(null);
  const responseVersion = useRef(0);
  const [pickupPlate, setPickupPlate] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Hi! Choose a VPLM function below or type HELP to see the directory. Vehicle searches and bay checks use the current workspace; transfers are only recorded after parking confirmation.',
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open, busy, transferFlow, activeFunction, roadTest, pickupPlate]);

  const addAssistantMessage = (content: string, language?: ChatMessage['language']) => {
    setMessages((current) => [...current, { role: 'assistant', content, language }]);
  };

  const activeFlowVehicle = transferFlow?.vehicleId
    ? vehicles.find((vehicle) => vehicle.id === transferFlow.vehicleId && vehicle.status !== 'Delivered')
    : undefined;

  const availableDestinations = transferFlow && activeFlowVehicle
    ? locations.filter((location) =>
        location.status !== 'Reserved' &&
        location.status !== 'Maintenance' &&
        !vehicles.some((vehicle) => vehicle.status !== 'Delivered' && normalizeLocation(vehicle.currentLocationId ?? '') === normalizeLocation(location.id)),
      )
    : [];
  const availableXParkingDestinations = transferFlow
    ? locations.filter((location) =>
        supportsXParkingLocation(location) &&
        !vehicles.some((vehicle) => vehicle.status !== 'Delivered' && vehicle.xParking === 'Yes' && normalizeLocation(vehicle.currentLocationId ?? '') === normalizeLocation(location.id)),
      )
    : [];

  const findVehicle = (message: string): { registration?: string; vehicle?: Vehicle; duplicates?: Vehicle[] } => {
    const activeVehicles = vehicles.filter(vehicle => normalize(vehicle.plateNumber));
    const normalizedMessage = normalize(message);
    const exactTokens = new Set((message.match(/[A-Z0-9-]+/gi) ?? []).map(normalize));
    const exactMatches = activeVehicles.filter((vehicle) => exactTokens.has(normalize(vehicle.plateNumber)));
    const matches = exactMatches.length
      ? exactMatches
      : activeVehicles.filter((vehicle) => normalizedMessage.includes(normalize(vehicle.plateNumber)));
    const longestMatchLength = Math.max(0, ...matches.map((vehicle) => normalize(vehicle.plateNumber).length));
    const bestMatches = matches.filter((vehicle) => normalize(vehicle.plateNumber).length === longestMatchLength);
    const current = bestMatches.filter(vehicle => vehicle.status !== 'Delivered');
    if (current.length === 1) return { registration: current[0].plateNumber, vehicle: current[0] };
    if (!current.length && bestMatches.length > 1) {
      const recent = [...bestMatches].sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? ''))[0];
      if (recent.deliveredAt) return { registration: recent.plateNumber, vehicle: recent };
    }
    if (bestMatches.length === 1) return { registration: bestMatches[0].plateNumber, vehicle: bestMatches[0] };
    if (bestMatches.length > 1) return { duplicates: bestMatches };
    return { registration: message.match(/[A-Z0-9-]*\d[A-Z0-9-]*/i)?.[0] };
  };

  const ownRunningRoadTest = (vehicle: Vehicle) => role === 'TechnicalLeader' && canAccessRoadTests
    ? loadRoadTests().find(test => test.vehicleId === vehicle.id && test.status === 'In Road Test'
      && (test.startedById ? test.startedById === userId : test.startedBy?.trim().toLowerCase() === actor.trim().toLowerCase()))
    : undefined;

  const showVehicleDetails = async (vehicle: Vehicle, offerTransfer: boolean) => {
    const details = `${vehicle.plateNumber} — ${vehicle.brand} ${vehicle.model}, ${vehicle.color}.`;
    const version = responseVersion.current;
    const own = ownRunningRoadTest(vehicle);
    const pickup = vehicle.status !== 'Delivered' ? await findActivePickup(vehicle.id) : undefined;
    const live = pickup?.data ? await loadPickupVehicleLocation(vehicle.id) : undefined;
    if (version !== responseVersion.current) return;
    const currentLocationId = live && !live.error ? live.data?.location_id ?? undefined : vehicle.currentLocationId;
    const pickupNotice = pickup?.data ? pickupParkingNotice(pickup.data, locations) : '';
    const pickupMoved = pickup?.data && normalizeLocation(currentLocationId ?? '') !== normalizeLocation(pickup.data.origin_location_id);
    const pickupDetails = [pickupNotice, pickupMoved ? pickupLocationWarning : ''].filter(Boolean).join('\n');
    if (vehicle.status === 'Delivered' || !currentLocationId || own) {
      const test = loadRoadTests().find(item => item.vehicleId === vehicle.id && item.status === 'In Road Test');
      const lastMovement = movements.filter(item => item.vehicleId === vehicle.id)
        .sort((a, b) => b.actionDateTime.localeCompare(a.actionDateTime))[0];
      const lastBay = lastMovement?.toLocationId ?? lastMovement?.fromLocationId;
      const status = vehicle.status === 'Delivered' ? 'Delivered' : test ? 'In Road Test' : pickup?.data?.status === 'In Transit' ? 'In Transit' : vehicle.status;
      const from = vehicle.status === 'Delivered' ? vehicle.finalParkingBay || (lastBay ? locationLabel(lastBay) : '')
        : (test?.departureLocationId ?? pickup?.data?.origin_location_id ?? lastBay);
      const place = from && vehicle.status !== 'Delivered' ? locationLabel(from) : from;
      const seenAt = vehicle.deliveredAt ?? test?.startTimestamp ?? pickup?.data?.accepted_at ?? lastMovement?.actionDateTime;
      const time = seenAt ? new Date(seenAt).toLocaleString('en-GB', { timeZone: 'Asia/Qatar' }) : '';
      addAssistantMessage(`${details}\nLast Seen: ${status}${place ? ` · ${place}` : ''}${time ? ` · ${time}` : ''}.${pickup?.error ? ' Pickup status could not be checked.' : ''}${pickupDetails ? `\n${pickupDetails}` : ''}`);
      if (own && vehicle.status !== 'Delivered') {
        setActiveFunction(null);
        setTransferFlow(null);
        setRoadTest({ type: own.testType ?? 'Initial Road Test', resumeId: own.id });
        addAssistantMessage('Did you complete the road test? Reply Yes or No.');
      }
      return;
    }
    const parkedDetails = `${details} Current bay: ${locationLabel(currentLocationId)}.${pickupDetails ? `\n${pickupDetails}` : ''}`;
    if (normalizeLocation(currentLocationId) !== normalizeLocation(vehicle.currentLocationId ?? '')) {
      addAssistantMessage(`${parkedDetails}\nRefresh the workspace before transferring this vehicle.`);
      return;
    }
    if (!offerTransfer) {
      addAssistantMessage(parkedDetails);
      return;
    }
    if (!canTransfer) {
      addAssistantMessage(`${parkedDetails} Your role can look up this vehicle but cannot transfer it.`);
      return;
    }
    setActiveFunction('transfer');
    setTransferFlow({ vehicleId: vehicle.id, step: 'taking' });
    addAssistantMessage(`${parkedDetails}\n${languageText.taking}`);
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
    if (action === 'pickup-request') {
      if (role === 'Guest Users') {
        setActiveFunction(null);
        addAssistantMessage('Guest profiles can view live pickup requests from Pickup Requests.');
        return;
      }
      setActiveFunction(null);
      const plate = findVehicle(query).vehicle?.plateNumber
        ?? query.replace(/^(?:\/?pickup(?: request)?|pick up|request vehicle pickup|request pickup)\b\s*/i, '').trim();
      setPickupPlate(plate);
      return;
    }

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
          void showVehicleDetails(registration.vehicle, false);
        } else if (!canTransfer) {
          setActiveFunction(null);
          addAssistantMessage('Your role does not have permission to transfer vehicles.');
        } else {
          setActiveFunction('transfer');
          setTransferFlow({ vehicleId: registration.vehicle.id, step: 'taking' });
          void showVehicleDetails(registration.vehicle, true);
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
      if (registration.vehicle?.status !== 'Delivered' && registration.vehicle?.currentLocationId) {
        setActiveFunction(null);
        addAssistantMessage(`${registration.vehicle.plateNumber} already has an active bay assignment. Use Transfer to move it instead.`);
        return;
      }
      const opened = onAssign(registration.registration, registration.vehicle?.status === 'Delivered' ? undefined : registration.vehicle);
      setActiveFunction(null);
      addAssistantMessage(opened
        ? `The Add / Assign form is ready for ${registration.vehicle?.plateNumber ?? registration.registration}. Review or complete the vehicle details and select a bay; nothing is saved until you submit the form.`
        : 'I could not open Add / Assign. Check your permission and the vehicle’s current assignment.');
      return;
    }

    if (action === 'road-test') {
      setActiveFunction(null);
      if (!canAccessRoadTests) return addAssistantMessage('Your role does not have access to Road Tests.');
      const type = /^\/?frt\b/i.test(query.trim()) ? 'Final Road Test' : 'Initial Road Test';
      const vehicle = registration.vehicle?.status !== 'Delivered' ? registration.vehicle : undefined;
      const own = vehicle && ownRunningRoadTest(vehicle);
      setRoadTest(own ? { type: own.testType ?? type, resumeId: own.id } : { type, vehicleId: vehicle?.id });
      addAssistantMessage(own ? 'Did you complete the road test? Reply Yes or No.'
        : vehicle ? 'Reply Yes to start, or No to close.' : 'Enter a vehicle number in chat or select a pending task below.');
    }
  };

  const startFunction = (action: AssistantFunction | 'help') => {
    setTransferFlow(null);
    setActiveFunction(null);
    setRoadTest(undefined);
    setPickupPlate(undefined);
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
    if (action === 'pickup-request') {
      if (role === 'Guest Users') {
        setActiveFunction(null);
        addAssistantMessage('Guest profiles can view live pickup requests from Pickup Requests.');
        return;
      }
      setPickupPlate('');
      return;
    }
    if (action === 'road-test') {
      if (canAccessRoadTests) runFunction('road-test', 'IRT');
      else addAssistantMessage('Your role does not have access to Road Tests.');
      return;
    }
    setActiveFunction(action);
    if (action === 'find') addAssistantMessage('Find vehicle selected. Enter a registration number to see its vehicle details and current bay.');
    if (action === 'assign') addAssistantMessage('Add / Assign selected. Enter the vehicle registration; I’ll open the validated form so you can complete details and choose a bay.');
    if (action === 'availability') {
      setActiveFunction(null);
      showBayAvailability('');
    }
  };

  const cancelTransfer = () => {
    setTransferFlow(null);
    setActiveFunction(null);
    addAssistantMessage('Transfer cancelled. No vehicle or bay data was changed.');
  };

  const continueTransferFlow = (answer: string) => {
    if (!transferFlow) return;
    if (/^(cancel|cancel transfer)$/i.test(answer.trim())) return cancelTransfer();

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
      if (!match.vehicle.currentLocationId || match.vehicle.status === 'Delivered') {
        setTransferFlow(null);
        setActiveFunction(null);
        void showVehicleDetails(match.vehicle, false);
        return;
      }
      setTransferFlow({ vehicleId: match.vehicle.id, step: 'taking' });
      void showVehicleDetails(match.vehicle, true);
      return;
    }

    if (transferFlow.step === 'taking') {
      if (isNo(answer) || answer.trim() === languageText.no) {
        setTransferFlow(null);
        setActiveFunction(null);
        addAssistantMessage('Okay. No transfer has been started.');
        return;
      }
      if (isYes(answer) || answer.trim() === languageText.yes) {
        setTransferFlow({ ...transferFlow, step: 'destination', selectedDestinationId: undefined });
        addAssistantMessage(languageText.where, displayLanguage);
        return;
      }
      addAssistantMessage('Please answer Yes or No: are you taking this vehicle?');
      return;
    }

    if (transferFlow.step === 'destination') {
      const typed = answer ? parseAssistantBay(answer, locations) : undefined;
      const selected = transferFlow.selectedDestinationId;
      const destinationId = typed ? typed.location?.id : selected?.replace(/^(?:bay|xparking):/, '');
      const destinationIsXParking = typed ? typed.xParking : selected?.startsWith('xparking:') ?? false;
      const destination = (destinationIsXParking ? availableXParkingDestinations : availableDestinations).find((location) => location.id === destinationId);
      if (!destination) {
        addAssistantMessage(languageText.unavailable, displayLanguage);
        return;
      }
      setTransferFlow({ ...transferFlow, step: 'parked', destinationId: destination.id, destinationIsXParking, selectedDestinationId: undefined });
      addAssistantMessage(`Please park ${activeFlowVehicle?.plateNumber} in ${destinationIsXParking ? 'the X Parking space ' : ''}${destination.zone}-${destination.bayNumber}. Have you parked it there?`);
      return;
    }

    if (isNo(answer) || /^not yet\b/i.test(answer.trim())) {
      addAssistantMessage('No transfer has been recorded. Confirm Yes here once the vehicle is physically parked in the selected bay.');
      return;
    }
    if (!isYes(answer) && answer.trim() !== languageText.yes) {
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
      transferFlow.destinationIsXParking,
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
    if (/^(irt|\/irt|frt|\/frt|road[\s-]*test)(\b|$)/i.test(command) || /\b(initial road test|road test request)\b/i.test(command)) return 'road-test';
    if (/^(pickup|\/pickup|pick up|pickup request|request vehicle|request pickup)(\b|$)/i.test(command) ||
      /\b(?:request|schedule)\s+(?:a\s+)?vehicle\s+pickup\b/i.test(command)) return 'pickup-request';
    if (/^(bay|\/bay|availability)(\b|$)/i.test(command) ||
      /\b(bay availability|parking availability|available bays)\b/i.test(command) ||
      (/\b(available|availability|occupied|free)\b/i.test(command) && /\b[A-Z]+[- ]?\d{1,3}\b/i.test(message))) return 'availability';
    return undefined;
  };

  const sendMessage = async (event?: FormEvent, suggestedMessage?: string) => {
    event?.preventDefault();
    const message = (suggestedMessage ?? input).trim();
    if (!message) return;
    if (isClearCommand(message)) {
      responseVersion.current++;
      setMessages([]);
      setInput('');
      setActiveFunction(null);
      setTransferFlow(null);
      setRoadTest(undefined);
      setPickupPlate(undefined);
      setBusy(false);
      return;
    }
    if (busy) return;
    const version = ++responseVersion.current;
    setMessages((current) => [...current, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);

    if (/^\/?(?:irt|frt)\b/i.test(message)) {
      setTransferFlow(null);
      setPickupPlate(undefined);
      runFunction('road-test', message);
      setBusy(false);
      return;
    }
    if (pickupPlate !== undefined || roadTest) {
      if (pickupPlate !== undefined) setPickupPlate(message);
      else roadTestChat.current?.answer(message);
      setBusy(false);
      return;
    }

    if (getCommand(message) === 'pickup-request') {
      setActiveFunction(null);
      setTransferFlow(null);
      runFunction('pickup-request', message);
      setBusy(false);
      return;
    }

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
          setActiveFunction(null);
          void showVehicleDetails(match.vehicle, true);
        } else if (match.registration && !match.vehicle) {
          setActiveFunction(null);
          addAssistantMessage(`I could not find ${match.registration} in the current workspace.`);
        } else {
          setTransferFlow({ step: 'vehicle' });
          addAssistantMessage('Transfer function selected. Enter the vehicle registration to begin the confirmation flow.');
        }
      } else {
        const isShortcutOnly = directory.some((item) => item.key.toLowerCase() === message.trim().toLowerCase());
        if (isShortcutOnly || (command !== 'pickup-request' && message.trim().startsWith('/'))) {
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
      void showVehicleDetails(directVehicle.vehicle, true);
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
        body: { message, language },
      });
      if (error) throw error;
      if (typeof data?.reply !== 'string' || !data.reply.trim()) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'The AI service returned an empty response.');
      }
      if (version === responseVersion.current) addAssistantMessage(data.reply, language);
    } catch (error) {
      let detail = error instanceof Error ? error.message : 'Unknown error';
      if (typeof error === 'object' && error !== null && 'context' in error && error.context instanceof Response) {
        const responseBody = await error.context.clone().json().catch(() => null) as { error?: unknown } | null;
        if (typeof responseBody?.error === 'string') detail = responseBody.error;
      }
      if (version === responseVersion.current) addAssistantMessage(`I couldn’t get a reply from the AI assistant. ${detail}`);
    } finally {
      if (version === responseVersion.current) setBusy(false);
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
                <p className="text-xs opacity-80" lang={displayLanguage}>{languageText.subtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={languageText.help}
                onClick={() => startFunction('help')}
                className="rounded-lg p-2 transition hover:bg-primary-foreground/15"
              >
                <BookOpen size={19} />
              </button>
              <button
                type="button"
                aria-label={languageText.close}
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 transition hover:bg-primary-foreground/15"
              >
                <X size={20} />
              </button>
            </div>
          </header>

          <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
            <div className="mb-2 grid grid-cols-2 gap-2" lang={displayLanguage}>
              {([true, false] as const).map(display => (
                <label key={String(display)} className="grid min-w-0 gap-1 font-medium text-foreground">
                  {display ? languageText.display : languageText.reply}
                  <select value={display ? displayLanguage : language} onChange={event => changeLanguage(event.target.value, display)}
                    className="min-h-9 w-full rounded-lg border border-input bg-background px-2">
                    {Object.entries(assistantLanguages).map(([code, name]) => (
                      <option key={code} value={code} lang={code}>{name}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            Workspace data is used for vehicle and bay lookups. Transfers and requests are saved only after you submit their app forms and confirmations. AI answers may be incorrect.
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                lang={message.language}
                className={`max-w-[95%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'ml-auto rounded-br-sm bg-primary text-primary-foreground'
                    : 'mr-auto rounded-bl-sm bg-muted text-foreground'
                }`}
              >
                {message.content}
              </div>
            ))}

            {roadTest && canAccessRoadTests && <AssistantRoadTest key={`${roadTest.type}:${roadTest.vehicleId ?? ''}:${roadTest.resumeId ?? ''}`} ref={roadTestChat}
              type={roadTest.type} initialVehicleId={roadTest.vehicleId} resumeId={roadTest.resumeId}
              canCreate={role === 'TechnicalLeader'} findOwnRunningTest={ownRunningRoadTest} userId={userId} onMessage={addAssistantMessage} vehicles={vehicles} locations={locations}
              actor={actor} onLocationChange={onRoadTestLocationChange} onClose={message => {
                setRoadTest(undefined);
                if (message) addAssistantMessage(message);
              }} />}
            {role !== 'Guest Users' && pickupPlate !== undefined && <AssistantPickup key={pickupPlate} vehicles={vehicles.filter(vehicle => vehicle.status !== 'Delivered')} locations={locations}
              initialPlate={pickupPlate} actor={actor} userId={userId} onClose={message => {
                setPickupPlate(undefined);
                if (message) addAssistantMessage(message);
              }} />}

            {transferFlow?.step === 'taking' && (
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Yes')} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{languageText.yes}</button>
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('No')} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">{languageText.no}</button>
              </div>
            )}

            {transferFlow?.step === 'destination' && (
              <div className="space-y-2 rounded-xl bg-muted p-3">
                <label className="block text-xs font-medium" htmlFor="assistant-destination">{languageText.destination}</label>
                <select
                  id="assistant-destination"
                  value={transferFlow.selectedDestinationId ?? ''}
                  onChange={(event) => setTransferFlow({ ...transferFlow, selectedDestinationId: event.target.value || undefined })}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="">{languageText.selectBay}</option>
                  {availableDestinations.map((location) => (
                    <option key={`bay:${location.id}`} value={`bay:${location.id}`}>
                      {location.zone}-{location.bayNumber}{location.section ? ` · ${location.section}` : ''}
                    </option>
                  ))}
                  {availableXParkingDestinations.map((location) => (
                    <option key={`xparking:${location.id}`} value={`xparking:${location.id}`}>
                      X Parking · {location.zone}-{location.bayNumber}
                    </option>
                  ))}
                </select>
                {availableDestinations.length === 0 && availableXParkingDestinations.length === 0 && <p className="text-xs text-muted-foreground">No eligible spaces are currently available.</p>}
                <button
                  type="button"
                  disabled={busy || !transferFlow.selectedDestinationId}
                  onClick={() => continueTransferFlow('')}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {languageText.confirm}
                </button>
                <button type="button" disabled={busy} onClick={() => cancelTransfer()}
                  className="ml-2 rounded-lg border border-border px-4 py-2 text-sm">{languageText.cancel}</button>
              </div>
            )}

            {transferFlow?.step === 'parked' && (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Yes')} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Yes, parked</button>
                <button type="button" disabled={busy} onClick={() => continueTransferFlow('Not yet')} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">Not yet</button>
                <button type="button" disabled={busy} onClick={cancelTransfer} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
              </div>
            )}

            {messages.length <= 1 && !roadTest && pickupPlate === undefined && (
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
                {languageText.thinking}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(event) => void sendMessage(event)} className="flex items-end gap-2 border-t border-border p-3">
            <label className="sr-only" htmlFor="vplm-ai-message">Message the VPLM AI assistant</label>
            <textarea
              id="vplm-ai-message"
              lang={displayLanguage}
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
              placeholder={transferFlow?.step === 'destination' ? 'B47 · W01 · A46X' : roadTest ? 'Type your road-test reply…' : languageText.prompt}
              className="max-h-28 min-h-10 flex-1 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              aria-label={languageText.send}
              disabled={!input.trim() || (busy && !isClearCommand(input))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={17} />}
            </button>
          </form>
        </section>
      )}

      <VplmCodexPet awake={open} busy={busy} onToggle={() => setOpen(current => !current)} />
    </div>
  );
}
