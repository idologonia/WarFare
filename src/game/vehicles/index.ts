/**
 * Техніка (МТ-ЛБ, М113, L200, T4) — запланована на пізніші етапи (GDD, розділ 7).
 * Тут лише модель даних, щоб формат збережень і сценаріїв був готовий до розширення.
 */
export interface VehicleComponent {
  id: 'engine' | 'tracks' | 'wheels' | 'weapon' | 'hull';
  hp: number;
  maxHp: number;
}

export interface Vehicle {
  id: string;
  defId: string;
  side: 'blue' | 'red';
  components: VehicleComponent[];
  seats: { role: 'driver' | 'gunner' | 'passenger'; unitId: string | null }[];
}
