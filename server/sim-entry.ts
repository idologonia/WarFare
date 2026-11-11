/**
 * Правила бою WarFare для серверної логіки HGS (server/logic.py).
 * Той самий код симуляції, що й у грі; спілкування — JSON-рядки через stdin/stdout:
 *   {"id":1,"op":"create","room":"r1","scenarioId":"first_mission","seed":5,"difficulty":"medium"}
 *   {"id":2,"op":"act","room":"r1","side":"blue","cmd":{...}}  -> {"id":2,"ok":true,"ended":false}
 *   {"id":3,"op":"state","room":"r1"}                          -> {"id":3,"ok":true,"state":{...}}
 *   {"id":4,"op":"load","room":"r1","state":{...}} / {"op":"drop","room":"r1"}
 */
import { createInterface } from 'node:readline';
import { Mission } from '@/game/simulation/mission';
import type { MissionState } from '@/game/simulation/state';
import { commandAllowed, createOnlineMission } from '@/net/onlineMission';

const missions = new Map<string, Mission>();
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');

type Req = { id?: number; op: string; room: string; [k: string]: unknown };

function handle(r: Req): Record<string, unknown> {
  switch (r.op) {
    case 'create': {
      const st = createOnlineMission(String(r.scenarioId), Number(r.seed), (r.difficulty as never) ?? 'medium');
      missions.set(r.room, new Mission(st));
      return { ok: true };
    }
    case 'load':
      missions.set(r.room, new Mission(r.state as MissionState));
      return { ok: true };
    case 'act': {
      const m = missions.get(r.room);
      if (!m) return { ok: false, error: 'Бій не знайдено' };
      if (m.state.turn.phase === 'ended') return { ok: false, error: 'Місію завершено' };
      const deny = commandAllowed(m.state, r.side as never, r.cmd as never);
      if (deny) return { ok: false, error: deny };
      const res = m.dispatch(r.cmd as never);
      return res.ok ? { ok: true, ended: (m.state.turn.phase as string) === 'ended' } : { ok: false, error: res.error };
    }
    case 'state': {
      const m = missions.get(r.room);
      return m ? { ok: true, state: m.state } : { ok: false, error: 'Бій не знайдено' };
    }
    case 'drop':
      missions.delete(r.room);
      return { ok: true };
    case 'ping':
      return { ok: true };
  }
  return { ok: false, error: 'Невідома операція' };
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let r: Req;
  try {
    r = JSON.parse(line) as Req;
  } catch {
    return;
  }
  try {
    out({ id: r.id, ...handle(r) });
  } catch (e) {
    out({ id: r.id, ok: false, error: `Помилка правил: ${(e as Error).message}` });
  }
});
process.stdin.on('end', () => process.exit(0));
