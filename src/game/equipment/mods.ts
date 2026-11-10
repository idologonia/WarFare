/**
 * Модифікації зброї (планка, коліматор, магніфер, приціл 4х, підствольний модуль тощо) — заплановано.
 * Сумісність залежить від моделі (WeaponDefinition.modSlots); змінюються лише перед місією.
 */
export interface WeaponModDefinition {
  id: string;
  name: string;
  slot: string;
  compatible: string[];
  accuracy?: number;
  weight: number;
}
