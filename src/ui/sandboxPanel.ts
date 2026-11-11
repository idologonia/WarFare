import { content } from '@/content';
import type { Cell } from '@/core/grid';
import { Rng } from '@/core/rng';
import { PART_NAMES } from '@/game/injuries/injuries';
import type { Mission } from '@/game/simulation/mission';
import { updateContacts } from '@/game/visibility/visibility';
import type { BodyPart, SideId } from '@/game/types';
import { BODY_PARTS } from '@/game/types';
import {
  sandboxAddUnit,
  sandboxAddVehicle,
  sandboxGiveWeapon,
  sandboxHeal,
  sandboxRefill,
  sandboxRemove,
  sandboxTeleport,
  sandboxWeapons,
  sandboxWound,
} from '@/tools/sandbox';
import { btn, h } from './dom';
import { statusName } from './panels';

type SbTool = 'pick' | 'add' | 'vehicle' | 'move' | 'remove';

/** Панель тестового режиму: довільне розміщення бійців обох сторін і зміна їхнього стану. */
export class SandboxPanel {
  el = h('div', { class: 'panel col', style: 'position:absolute;left:8px;bottom:calc(var(--btn) + 28px);width:290px;max-height:60%;overflow:auto;z-index:20' });
  tool: SbTool = 'pick';
  private side: SideId = 'red';
  private classId = 'rifleman';
  private vehicleId = 'mtlb';
  private target: string | null = null;
  private part: BodyPart = 'leftLeg';

  constructor(private m: Mission, private changed: (full: boolean) => void, private toast: (t: string) => void) {
    this.render();
  }

  /** Перехоплення кліку по карті. Повертає true, якщо клік оброблено. */
  click(unitId: string | null, cell: Cell | null): boolean {
    const s = this.m.state;
    if (this.tool === 'pick') {
      if (!unitId) return false;
      this.target = unitId;
      this.render();
      return false; // дати бою теж обробити (вибір свого бійця)
    }
    if (this.tool === 'vehicle' && cell) {
      const e = sandboxAddVehicle(s, this.side, this.vehicleId, cell);
      if (e) this.toast(e);
      else {
        this.refreshKnowledge();
        this.changed(true);
      }
      this.render();
      return true;
    }
    if (this.tool === 'add' && cell) {
      const r = sandboxAddUnit(s, this.side, this.classId, cell);
      if (typeof r === 'string') this.toast(r);
      else {
        this.target = r.id;
        this.refreshKnowledge();
        this.changed(true);
      }
    } else if (this.tool === 'move') {
      if (unitId && !this.target) this.target = unitId;
      else if (this.target && cell) {
        const e = sandboxTeleport(s, this.target, cell);
        if (e) this.toast(e);
        else {
          this.refreshKnowledge();
          this.changed(false);
        }
      }
    } else if (this.tool === 'remove' && unitId) {
      sandboxRemove(s, unitId);
      if (this.target === unitId) this.target = null;
      this.refreshKnowledge();
      this.changed(true);
    }
    this.render();
    return true;
  }

  private refreshKnowledge(): void {
    const s = this.m.state;
    if (s.turn.phase !== 'battle') return;
    const rng = new Rng(s.rng);
    updateContacts({ s, rng, ev: [] });
  }

  render(): void {
    const s = this.m.state;
    const db = content();
    this.el.innerHTML = '';
    const toolBtn = (t: SbTool, label: string) => btn(label, () => ((this.tool = t), this.render()), { on: this.tool === t });
    const sel = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const e = h('select', { style: 'font:inherit;color:var(--text);background:var(--panel-2);border:1px solid var(--line);border-radius:6px;min-height:calc(var(--btn) * 0.8)' });
      for (const [v, l] of opts) e.append(h('option', { value: v, selected: get() === v }, l));
      e.addEventListener('change', () => set(e.value as T));
      return e;
    };
    const t = this.target ? s.units.find((u) => u.id === this.target) : undefined;
    this.el.append(
      h('b', {}, 'Пісочниця (тестовий режим)'),
      h('div', { class: 'row' }, toolBtn('pick', 'Вибір'), toolBtn('add', 'Додати'), toolBtn('vehicle', 'Техніка'), toolBtn('move', 'Перенести'), toolBtn('remove', 'Прибрати')),
      ...(this.tool === 'vehicle'
        ? [h('div', { class: 'row' }, sel<SideId>([['blue', 'Синя'], ['red', 'Червона']], () => this.side, (v) => (this.side = v)), sel([...db.vehicles.values()].map((v) => [v.id, v.name] as [string, string]), () => this.vehicleId, (v) => (this.vehicleId = v)))]
        : []),
      ...(this.tool === 'add'
        ? [h(
            'div',
            { class: 'row' },
            sel<SideId>([['blue', 'Синя'], ['red', 'Червона']], () => this.side, (v) => (this.side = v)),
            sel([...db.classes.values()].filter((c) => c.kit).map((c) => [c.id, c.name] as [string, string]), () => this.classId, (v) => (this.classId = v)),
          )]
        : []),
      h(
        'div',
        { class: 'muted', style: 'font-size:0.85em' },
        { pick: 'Клікніть будь-якого бійця, щоб змінити його нижче.', add: 'Клікніть клітинку, щоб поставити бійця.', vehicle: 'Клікніть клітинку — лівий верхній кут площі 2×2.', move: 'Клікніть клітинку — вибраний боєць переміститься туди.', remove: 'Клікніть бійця, щоб прибрати його з карти.' }[this.tool],
      ),
    );
    if (t) {
      const cls = db.classes.get(t.classId)?.name ?? t.classId;
      const run = (fn: () => void, full = false) => () => {
        fn();
        this.refreshKnowledge();
        this.changed(full);
        this.render();
      };
      this.el.append(
        h('div', { style: 'border-top:1px solid var(--line);padding-top:6px' }, h('b', {}, `${t.callsign} `), h('span', { class: 'muted' }, `${cls} · ${t.side === 'blue' ? 'синя' : 'червона'} · ${statusName(t.status)}`)),
        h(
          'div',
          { class: 'row' },
          sel(sandboxWeapons().map((w) => [w.id, w.name] as [string, string]), () => t.inventory.primary?.defId ?? '', (v) => run(() => sandboxGiveWeapon(s, t.id, v), true)()),
        ),
        h('div', { class: 'row' }, btn('Вилікувати', run(() => sandboxHeal(s, t.id), true)), btn('AP і БК', run(() => sandboxRefill(s, t.id)))),
        h(
          'div',
          { class: 'row' },
          sel(BODY_PARTS.map((p) => [p, PART_NAMES[p]] as [BodyPart, string]), () => this.part, (v) => (this.part = v)),
          btn('Легке', run(() => sandboxWound(s, t.id, this.part, 'light'))),
          btn('Важке', run(() => sandboxWound(s, t.id, this.part, 'heavy'))),
          btn('Пневмоторакс', run(() => sandboxWound(s, t.id, this.part, 'pneumo'))),
        ),
      );
    }
    this.el.append(h('div', { class: 'muted', style: 'font-size:0.85em' }, 'У тесті видно всіх бійців обох сторін; керування переходить між сторонами щоходу.'));
  }
}
