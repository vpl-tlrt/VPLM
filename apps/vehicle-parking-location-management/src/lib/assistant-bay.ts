import { parkingRecordKey, type ParkingLocation } from '@/lib/parking-data';

export function parseAssistantBay(answer: string, locations: ParkingLocation[]) {
  const compact = answer.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = compact.match(/^X(?:PARKING|PARK)?(?=[A-Z]+\d)/)?.[0];
  const suffix = compact.match(/(?<=\d)X(?:PARKING|PARK)?$/)?.[0];
  const xParking = Boolean(prefix || suffix);
  const label = compact.slice(prefix?.length ?? 0, suffix ? -suffix.length : undefined);
  const shorthand = /^([ABCWR]|LX?|WORKSHOP|RECEPTION)(\d+)$/.exec(label);
  if (shorthand) {
    const [, alias, number] = shorthand;
    const lexus = alias === 'L' || alias === 'LX';
    const zone = alias === 'W' || alias === 'WORKSHOP' ? 'Workshop'
      : lexus || alias === 'R' || alias === 'RECEPTION' ? 'Reception' : alias;
    return { xParking, location: locations.find(item => item.zone === zone && item.bayNumber
      && Number(item.bayNumber) === Number(number) && (!lexus || /lexus/i.test(`${item.section} ${item.lane}`))) };
  }
  const location = locations.find(item => parkingRecordKey(item.id) === parkingRecordKey(answer)
    || `${item.zone}${item.bayNumber}`.toUpperCase().replace(/[^A-Z0-9]/g, '') === label);
  return { xParking, location };
}
