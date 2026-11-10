import { content, itemDef } from '@/content';
import { fmtAp } from '@/core/grid';
import { adjacent } from '@/game/combat/movement';
import { findMedical, pouchCapacity, totalWeight } from '@/game/inventory/inventory';
import { INJURY_NAMES, PART_NAMES, bleedingRate, treatmentOptions } from '@/game/injuries/injuries';
import { freeWeight } from '@/game/units/derived';
import type { Command } from '@/game/simulation/commands';
import type { MissionState } from '@/game/simulation/state';
import type { ArmorDefinition, BackpackDefinition, BodyPart, MagazineInstance, MedicalDefinition, MissionResult, StackItem, Unit } from '@/game/types';
import { btn, h, pct } from './dom';

const STATUS: Record<string, string> = { active: 'У строю', down: 'Без свідомості', dead: 'Загинув', evacuated: 'Евакуйований', reserve: 'Резерв' };
export const statusName = (s: string) => STATUS[s] ?? s;

function partColor(u: Unit, part: BodyPart): string {
  const inj = u.injuries.filter((i) => i.part === part);
  if (!inj.length) return '#3e6a3a';
  if (inj.some((i) => i.type === 'amputation')) return '#111';
  if (inj.some((i) => i.bleeding === 'massive' || (i.type === 'pneumothorax' && !i.sealed))) return '#d0302a';
  if (inj.some((i) => i.type.endsWith('Heavy'))) return '#e07a2a';
  return '#d8b830';
}

/** Силует із кольоровими зонами травм. */
export function silhouette(u: Unit): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 200');
  const shapes: [BodyPart, string][] = [
    ['head', 'M48 6 h24 v26 h-24 z'],
    ['torso', 'M38 36 h44 v62 h-44 z'],
    ['leftArm', 'M22 38 h14 v58 h-14 z'],
    ['rightArm', 'M84 38 h14 v58 h-14 z'],
    ['leftLeg', 'M40 102 h18 v90 h-18 z'],
    ['rightLeg', 'M62 102 h18 v90 h-18 z'],
  ];
  for (const [part, d] of shapes) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', partColor(u, part));
    p.setAttribute('stroke', '#0d0f12');
    p.setAttribute('stroke-width', '2');
    const t = document.createElementNS(ns, 'title');
    t.textContent = PART_NAMES[part];
    p.append(t);
    svg.append(p);
  }
  return svg;
}

/** Медичний екран: пацієнт (сам або поруч), травми, комбіноване лікування. */
export function medicalBody(s: MissionState, medic: Unit, dispatch: (c: Command) => boolean, rerender: (patientId?: string) => void, patientId?: string): HTMLElement {
  const candidates = s.units.filter(
    (p) =>
      p.side === medic.side &&
      (p.id === medic.id || p.carriedBy === medic.id || (p.pos && medic.pos && adjacent(p.pos, medic.pos) && (p.status === 'active' || p.status === 'down'))),
  );
  const patient = candidates.find((p) => p.id === patientId) ?? candidates.find((p) => p.injuries.length && p.id !== medic.id) ?? medic;
  const opts = treatmentOptions(patient);
  const list = h('div', {});
  if (!patient.injuries.length) list.append(h('p', { class: 'muted' }, 'Травм немає.'));
  for (const i of patient.injuries) {
    const flags = [
      i.bleeding === 'massive' ? 'масивна кровотеча' : i.bleeding === 'light' ? 'легка кровотеча' : '',
      i.tourniquet ? 'турнікет' : '',
      i.bandaged ? 'перев’язано' : '',
      i.sealed ? (i.type === 'pneumothorax' ? 'декомпресія' : 'наліпка') : '',
    ].filter(Boolean);
    list.append(h('div', { class: 'inj' }, h('b', {}, `${PART_NAMES[i.part]}: ${INJURY_NAMES[i.type]}`), h('div', { class: 'muted' }, flags.join(', ') || 'без ускладнень')));
  }
  const actions = h('div', { class: 'col' });
  for (const o of opts) {
    const loc = findMedical(medic, o.effect);
    const def = [...content().items.values()].find((d) => d.kind === 'medical' && (d as MedicalDefinition).effect === o.effect) as MedicalDefinition;
    const cost = def.ap + (loc?.where === 'backpack' ? 2 : 0);
    actions.append(
      btn(`${o.label} — ${cost} AP${loc ? '' : ' (немає)'}`, () => {
        if (dispatch({ type: 'treat', unitId: medic.id, patientId: patient.id, effect: o.effect, injuryId: o.injuryId })) rerender(patient.id);
      }, { disabled: !loc || medic.ap < cost * 10 || s.turn.side !== medic.side }),
    );
  }
  return h(
    'div',
    {},
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Пацієнт:'), ...candidates.map((c) => btn(`${c.callsign}${c.id === medic.id ? ' (сам)' : ''}`, () => rerender(c.id), { on: c.id === patient.id }))),
    h(
      'div',
      { class: 'med', style: 'margin-top:8px' },
      h('div', { class: 'col' }, silhouette(patient), h('div', {}, `Здоров’я: ${patient.health}/${patient.stats.health}`), h('div', { class: bleedingRate(patient) ? 'neg' : 'muted' }, `Втрата за хід: ${bleedingRate(patient)}`), h('div', { class: 'muted' }, statusName(patient.status))),
      h('div', {}, h('h3', {}, `${patient.name} «${patient.callsign}»`), list, h('h3', { style: 'margin-top:10px' }, `Допомога (AP медика: ${fmtAp(medic.ap)})`), actions),
    ),
  );
}

/** Інвентар: слоти, підсумки, пояс, рюкзак із клітинками, вага. */
export function inventoryBody(u: Unit): HTMLElement {
  const inv = u.inventory;
  const name = (id: string) => itemDef(id).name;
  const slot = (label: string, text: string) => h('tr', {}, h('td', { class: 'muted' }, label), h('td', {}, text));
  const armor = (a: typeof inv.armor) => (a ? `${name(a.defId)} (${pct(a.durability, itemDef<ArmorDefinition>(a.defId).durability)}%)` : '—');
  const w = inv.primary;
  const table = h(
    'table',
    {},
    slot('Основна зброя', w ? `${name(w.defId)}${w.magazine ? ` · ${name(w.magazine.defId)}: ${w.magazine.rounds} наб.` : ' · без магазина'}` : '—'),
    slot('Каска', armor(inv.helmet)),
    slot('Бронезахист', armor(inv.armor)),
    slot('Розвантаження', inv.rig ? name(inv.rig.defId) : '—'),
    slot(
      `Підсумки (${inv.pouches.length}/${pouchCapacity(inv)})`,
      inv.pouches.map((p) => ('rounds' in p ? `${name(p.defId)} [${(p as MagazineInstance).rounds}]` : name(p.defId))).join(', ') || '—',
    ),
    slot('Пояс', inv.belt.map((b) => `${name(b.defId)}${(b as StackItem).uses > 1 ? ` ×${(b as StackItem).uses}` : ''}`).join(', ') || '—'),
  );
  const grid = h('div', {});
  if (inv.backpack) {
    const [gw, gh] = itemDef<BackpackDefinition>(inv.backpack.defId).grid;
    const cell = 46;
    const g = h('div', { class: 'bp-grid', style: `grid-template-columns:repeat(${gw},${cell}px);width:${gw * (cell + 2) + 2}px` });
    for (let i = 0; i < gw * gh; i++) g.append(h('div', { class: 'bp-cell' }));
    for (const e of inv.backpackItems) {
      const [iw, ih] = itemDef(e.item.defId).size;
      const extra = 'rounds' in e.item ? ` [${(e.item as MagazineInstance).rounds}]` : '';
      g.append(
        h('div', { class: 'bp-item', style: `left:${2 + e.x * (cell + 2)}px;top:${2 + e.y * (cell + 2)}px;width:${iw * (cell + 2) - 2}px;height:${ih * (cell + 2) - 2}px`, title: name(e.item.defId) }, name(e.item.defId) + extra),
      );
    }
    grid.append(h('h3', { style: 'margin-top:10px' }, name(inv.backpack.defId)), g);
  }
  const wt = totalWeight(inv);
  const fw = freeWeight(u);
  return h(
    'div',
    {},
    table,
    grid,
    h('p', { class: wt > fw ? 'neg' : 'muted' }, `Вага: ${wt} кг (без штрафу до ${fw.toFixed(1)} кг). Модифікації змінюються лише перед місією; передача предметів у бою — у наступних етапах.`),
  );
}

/** Підсумок місії. */
export function resultsBody(r: MissionResult, viewer: 'blue' | 'red'): HTMLElement {
  const sideName = { blue: 'Синя сторона', red: 'Червона сторона' };
  const reason = { eliminated: 'противника знищено або виведено з бою', withdrawal: 'відхід з поля бою', turnLimit: 'вичерпано ліміт ходів' }[r.reason];
  const headline = r.winner === null ? 'Нічия' : r.winner === viewer ? 'Перемога' : 'Поразка';
  const side = (k: 'blue' | 'red') => {
    const p = r.perSide[k];
    return h('tr', {}, h('td', {}, sideName[k]), h('td', {}, String(p.killed)), h('td', {}, String(p.wounded)), h('td', {}, String(p.evacuated)), h('td', {}, String(p.leftOnField)), h('td', {}, String(p.roundsUsed)), h('td', {}, String(p.grenades)), h('td', {}, String(p.medsUsed)));
  };
  const units = h(
    'table',
    {},
    h('tr', {}, ...['Боєць', 'Стан', 'Постріли', 'Влучання', 'Точність', 'Знищено', 'Шкода', 'Медицина', 'Поранення'].map((t) => h('th', {}, t))),
    ...r.units.map((u) =>
      h(
        'tr',
        { style: `border-left:3px solid ${u.side === 'blue' ? 'var(--blue)' : 'var(--red)'}` },
        h('td', {}, u.name),
        h('td', {}, statusName(u.status)),
        h('td', {}, String(u.stats.shots)),
        h('td', {}, String(u.stats.hits)),
        h('td', {}, `${pct(u.stats.hits, u.stats.shots)}%`),
        h('td', {}, String(u.stats.kills)),
        h('td', {}, String(u.stats.damageDealt)),
        h('td', {}, String(u.stats.medsUsed)),
        h('td', {}, String(u.stats.woundsTaken)),
      ),
    ),
  );
  return h(
    'div',
    { class: 'col' },
    h('div', { class: 'title-logo', style: `font-size:2.2em;color:${headline === 'Перемога' ? 'var(--good)' : headline === 'Поразка' ? 'var(--bad)' : 'var(--accent)'}` }, headline),
    h('div', { class: 'muted' }, `Причина: ${reason}. Ходів: ${r.turns}.`),
    h('table', {}, h('tr', {}, ...['Сторона', 'Загинуло', 'Поранено', 'Евакуйовано', 'Лишилось на полі', 'Набоїв', 'Гранат', 'Медицина'].map((t) => h('th', {}, t))), side('blue'), side('red')),
    h('h3', { style: 'margin-top:8px' }, 'Ефективність бійців'),
    units,
    h('p', { class: 'muted' }, 'Техніка та виконання окремих завдань з’являться у статистиці разом із відповідними механіками.'),
  );
}
