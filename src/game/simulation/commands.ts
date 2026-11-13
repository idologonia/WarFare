import type { DronePayload } from '@/game/types';
import type { Cell } from '@/core/grid';
import type { FireTarget } from '@/game/combat/fire';
import type { ItemDest, ItemRef } from '@/game/inventory/transfer';
import type { FireMode, MedicalEffect, MoveMode, SideId, Stance, WeaponState } from '@/game/types';

/** Усі зміни стану місії — лише через ці команди (однакові для людини, AI і майбутньої мережі). */
export type Command =
  | { type: 'deploy'; unitId: string; cell: Cell }
  | { type: 'autoDeploy'; side: SideId }
  | { type: 'startBattle' }
  | { type: 'move'; unitId: string; to: Cell; mode: MoveMode }
  | { type: 'stance'; unitId: string; stance: Stance }
  | { type: 'weaponState'; unitId: string; state: WeaponState }
  | { type: 'fire'; unitId: string; target: FireTarget; mode: FireMode }
  | { type: 'reload'; unitId: string }
  | { type: 'throw'; unitId: string; cell: Cell; grenade?: string }
  | { type: 'overwatch'; unitId: string }
  | { type: 'launch'; unitId: string; kind: 'rpg' | 'ugl' | 'disposable'; cell: Cell }
  | { type: 'reloadLauncher'; unitId: string; ammo?: string }
  | { type: 'toggleLight'; unitId: string }
  | { type: 'turn'; unitId: string; facing: number }
  | { type: 'droneLaunch'; unitId: string; index: number; payload?: DronePayload }
  | { type: 'toggleNvg'; unitId: string }
  | { type: 'capture'; unitId: string; targetId: string }
  | { type: 'droneMove'; droneId: string; x: number; y: number }
  | { type: 'droneAttack'; droneId: string; cell: Cell }
  | { type: 'droneDrop'; droneId: string }
  | { type: 'droneLand'; droneId: string }
  | { type: 'droneAltitude'; droneId: string; delta: number }
  | { type: 'moveItem'; unitId: string; from: ItemRef; to: ItemDest }
  | { type: 'embark'; unitId: string; vehicleId: string; seat?: 'driver' | 'gunner' | 'passenger' }
  | { type: 'disembark'; unitId: string; cell: Cell }
  | { type: 'vehicleMove'; vehicleId: string; x: number; y: number }
  | { type: 'vehicleFire'; vehicleId: string; target: FireTarget; mode: FireMode }
  | { type: 'vehicleReload'; vehicleId: string }
  | { type: 'treat'; unitId: string; patientId: string; effect: MedicalEffect; injuryId: string | null }
  | { type: 'pickUp'; unitId: string; targetId: string }
  | { type: 'drop'; unitId: string }
  | { type: 'evacuate'; unitId: string }
  | { type: 'endTurn' }
  | { type: 'withdraw'; side: SideId };

export type CommandResult = { ok: true } | { ok: false; error: string };
