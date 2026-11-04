import { useEffect, useState } from 'react';
import { findActivePickup, type ActivePickup } from '@/lib/pickup-request-data';

export function useActivePickup(vehicleId?: string) {
  const [match, setMatch] = useState<{ vehicleId: string; request: ActivePickup | null }>();
  useEffect(() => {
    if (!vehicleId) return;
    let current = true;
    void findActivePickup(vehicleId).then(({ data, error }) => {
      if (current && !error) setMatch({ vehicleId, request: data });
    });
    return () => { current = false; };
  }, [vehicleId]);
  return match?.vehicleId === vehicleId ? match?.request : undefined;
}
