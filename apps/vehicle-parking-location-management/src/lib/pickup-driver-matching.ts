import type { PickupDriver } from '@/lib/pickup-request-data';

const normalizeName = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

function isNearName(query: string, name: string, limit: number) {
  const left = Array.from(query);
  const right = Array.from(name);
  if (Math.abs(left.length - right.length) > limit) return false;

  const distances = Array.from({ length: left.length + 1 }, (_, row) =>
    Array.from({ length: right.length + 1 }, (_, column) => row === 0 ? column : column === 0 ? row : 0));
  for (let row = 1; row <= left.length; row++) {
    for (let column = 1; column <= right.length; column++) {
      distances[row][column] = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + Number(left[row - 1] !== right[column - 1]),
      );
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        distances[row][column] = Math.min(distances[row][column], distances[row - 2][column - 2] + 1);
      }
    }
  }
  return distances[left.length][right.length] <= limit;
}

export function findPickupDrivers(query: string, drivers: PickupDriver[]): PickupDriver[] {
  const name = normalizeName(query);
  if (!name) return [];
  const candidates = drivers.map(driver => ({ driver, name: normalizeName(driver.name) }));
  const exact = candidates.filter(candidate => candidate.name === name);
  if (exact.length) return exact.map(candidate => candidate.driver);

  const length = Array.from(name).length;
  if (length < 3) return [];
  return candidates.filter(candidate => {
    const terms = name.includes(' ') ? [candidate.name] : candidate.name.split(' ');
    return terms.some(term => term.startsWith(name)
      || (length >= 4 && isNearName(name, term, length >= 8 ? 2 : 1)));
  }).map(candidate => candidate.driver);
}
