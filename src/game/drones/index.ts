/**
 * Дрони (FPV 7"/10", розвідувальні) — заплановано на пізніші етапи (GDD, розділ 7).
 * Дрон — окрема одиниця з батареєю; оператор вразливий. Поки лише модель даних.
 */
export interface Drone {
  id: string;
  defId: string;
  side: 'blue' | 'red';
  operatorId: string;
  battery: number;
  altitude: number;
  pos: { x: number; y: number } | null;
}
