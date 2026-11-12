import { content } from '@/content';
import { className, loadRoster, rankOf, recruit, ROSTER_MAX, saveRoster, squadSize, type Roster, type RosterSoldier } from '@/game/roster';
import type { MissionState } from '@/game/simulation/state';
import type { SideId } from '@/game/types';
import { btn, h } from './dom';

/**
 * Вибір бійців на місію з ростера фракції (як у Door Kickers): картки бійців, клік — взяти/зняти.
 * Кількість місць — за сценарієм. Поранені лікуються, загиблі — у пам'яті.
 */
export function openRosterPick(root: HTMLElement, s: MissionState, side: SideId, done: (picks: RosterSoldier[]) => void, back: () => void): void {
  const fid = s.scenario.sides[side].factionId;
  const faction = content().factions.find((f) => f.id === fid);
  const roster: Roster = loadRoster(fid);
  const slots = squadSize(s, side);
  const picked = new Set<string>();
  // Типово — перші готові бійці.
  for (const x of roster.soldiers) if (x.status === 'ready' && picked.size < slots) picked.add(x.id);

  const wrap = h('div', { class: 'menu' });
  root.append(wrap);
  const draw = () => {
    wrap.innerHTML = '';
    const cards = h('div', { class: 'roster-grid' });
    for (const x of roster.soldiers.filter((q) => q.status !== 'kia')) {
      const on = picked.has(x.id);
      const ready = x.status === 'ready';
      const card = h(
        'div',
        {
          class: `roster-card${on ? ' on' : ''}${ready ? '' : ' off'}`,
          onclick: () => {
            if (!ready) return;
            if (on) picked.delete(x.id);
            else if (picked.size < slots) picked.add(x.id);
            draw();
          },
        },
        h('div', { class: 'rc-top' }, h('b', {}, x.callsign), h('span', { class: 'muted' }, rankOf(x.xp))),
        h('div', {}, className(x.classId)),
        h('div', { class: 'muted', style: 'font-size:0.82em' }, x.name),
        h('div', { class: 'rc-stats' }, `Навч. ${x.stats.training} · Реакц. ${x.stats.reaction} · Сприйн. ${x.stats.perception}`),
        h('div', { class: 'muted', style: 'font-size:0.8em' }, `Місій ${x.missions} · знищено ${x.kills} · досвід ${x.xp}`),
        ready ? null : h('div', { class: 'neg', style: 'font-size:0.85em' }, `На лікуванні: ще ${x.recovery ?? 1} міс.`),
      );
      cards.append(card);
    }
    const fallen = roster.soldiers.filter((q) => q.status === 'kia');
    const box = h(
      'div',
      { class: 'panel', style: 'width:min(1100px,100%);padding:16px;max-height:92vh;overflow:auto' },
      h('h2', {}, `Вибір загону — ${faction?.name ?? fid}`),
      h('p', { class: 'muted' }, `${s.scenario.name}. Місць у загоні: ${slots}. Клацніть бійця, щоб взяти або зняти. Обрано: ${picked.size}/${slots}.`),
      cards,
      fallen.length ? h('p', { class: 'muted', style: 'margin-top:8px' }, `Пам'ятаємо: ${fallen.map((f) => f.callsign).join(', ')}`) : null,
      h(
        'div',
        { class: 'row', style: 'margin-top:10px;flex-wrap:wrap' },
        btn('Назад', back),
        btn(`Набрати новобранця (${roster.soldiers.filter((q) => q.status !== 'kia').length}/${ROSTER_MAX})`, () => {
          if (roster.soldiers.filter((q) => q.status !== 'kia').length >= ROSTER_MAX) return;
          const classes = ['rifleman', 'rifleman', 'marksman', 'mg1', 'mg2', 'grenadier1', 'grenadier2', 'scout', 'medic', 'droneOperator'];
          recruit(roster, classes[Math.floor(Math.random() * classes.length)]);
          saveRoster(roster);
          draw();
        }),
        btn('Далі: спорядження', () => {
          if (!picked.size) return;
          saveRoster(roster);
          wrap.remove();
          done(roster.soldiers.filter((q) => picked.has(q.id)));
        }, { cls: 'primary', disabled: !picked.size }),
      ),
    );
    wrap.append(box);
  };
  draw();
}
