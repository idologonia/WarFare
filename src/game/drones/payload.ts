import { content, itemDef } from '@/content';
import type { DroneDefinition, DroneItemDefinition, DronePayload } from '@/game/types';

export const PAYLOAD_NAMES: Record<DronePayload, string> = { frag: 'осколковий', heat: 'кумулятивний', incendiary: 'запалювальний' };

export function droneDefOfItem(itemId: string): DroneDefinition | undefined {
  return content().drones.get(itemDef<DroneItemDefinition>(itemId).drone);
}
