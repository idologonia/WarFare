import { content, itemDef } from '@/content';
import { equipWeapon, grenadeTypes, helmetChoice, setGrenadeType, setHelmetMounts, type HelmetMountChoice } from '@/game/equipment/loadout';
import { modNames, validateMods } from '@/game/equipment/mods';
import { countItems, totalWeight } from '@/game/inventory/inventory';
import type { MissionState } from '@/game/simulation/state';
import { freeWeight } from '@/game/units/derived';
import type { Unit, WeaponDefinition } from '@/game/types';
import { btn, h, modal } from './dom';

export function loadoutSummary(u: Unit): HTMLElement {
  const w = u.inventory.primary;
  const wt = totalWeight(u.inventory);
  const fw = freeWeight(u);
  return h(
    'div',
    {},
    h('div', {}, w ? itemDef(w.defId).name : '—'),
    w?.mods.length ? h('div', { class: 'muted', style: 'font-size:0.85em' }, modNames(w)) : null,
    h('div', { class: wt > fw ? 'neg' : 'muted', style: 'font-size:0.85em' }, `${wt} / ${fw.toFixed(1)} кг`),
  );
}

/** Вікно спорядження бійця: зброя, модифікації, тип магазинів, тип гранат. */
export function loadoutModal(s: MissionState, u: Unit, onChange: () => void): HTMLElement {
  const weapons = [...content().items.values()].filter((d) => d.kind === 'weapon' && (d as WeaponDefinition).mods) as WeaponDefinition[];
  let weaponId = u.inventory.primary?.defId ?? weapons[0].id;
  if (!weapons.some((w) => w.id === weaponId)) weaponId = weapons[0].id;
  let mods = [...(u.inventory.primary?.mods ?? [])];
  let mag = u.inventory.primary?.magazine?.defId;
  const body = h('div', { class: 'col' });
  let back: HTMLElement;

  const draw = () => {
    body.innerHTML = '';
    const wd = itemDef<WeaponDefinition>(weaponId);
    if (!mag || !wd.magazines.includes(mag)) mag = wd.magazines[0];
    const wSel = h('select', {});
    for (const w of weapons) wSel.append(h('option', { value: w.id, selected: w.id === weaponId }, `${w.name} · ${w.category === 'lmg' ? 'кулемет' : 'автомат'} · ${w.weight} кг`));
    wSel.addEventListener('change', () => {
      weaponId = wSel.value;
      mods = mods.filter((m) => (itemDef<WeaponDefinition>(weaponId).mods ?? []).includes(m));
      draw();
    });
    const modBox = h('div', { class: 'col' });
    for (const id of wd.mods ?? []) {
      const m = content().mods.get(id)!;
      const cb = h('input', { type: 'checkbox', checked: mods.includes(id), disabled: m.planned });
      cb.addEventListener('change', () => {
        mods = cb.checked ? [...mods, id] : mods.filter((x) => x !== id);
        draw();
      });
      const fx = Object.entries(m.effects)
        .map(([k, v]) => `${{ snap: 'навскид', burst: 'черга', aimed: 'прицільно', aimedFar: 'прицільно далеко', cqb: 'CQB', range: 'дальність', recoil: 'віддача' }[k] ?? k} ${(v as number) > 0 ? '+' : ''}${v}`)
        .join(', ');
      modBox.append(h('label', { class: 'row', style: 'gap:6px' }, cb, h('span', {}, m.name, m.planned ? ' (незабаром)' : ''), h('span', { class: 'muted', style: 'font-size:0.85em' }, fx)));
    }
    if (!(wd.mods ?? []).length) modBox.append(h('div', { class: 'muted' }, 'Модифікації недоступні.'));
    const magSel = h('select', {});
    for (const id of wd.magazines) magSel.append(h('option', { value: id, selected: id === mag }, itemDef(id).name));
    magSel.addEventListener('change', () => ((mag = magSel.value), draw()));
    const errors = validateMods(weaponId, mods);
    const fragIds = grenadeTypes().map((g) => g.id).concat('frag_g1');
    const hasNades = countItems(u, (d) => fragIds.includes(d.id)) > 0;
    const curNade = [...u.inventory.belt, ...u.inventory.backpackItems.map((e) => e.item)].find((i) => fragIds.includes(i.defId))?.defId;
    const mountSel = h('select', { disabled: !u.inventory.helmet });
    for (const [v, l] of [['none', 'Нічого'], ['flashlight', 'Ліхтар'], ['nvg_mono', 'ПНБ монокулярний + ліхтар'], ['nvg_bino', 'ПНБ бінокулярний + ліхтар']] as [HelmetMountChoice, string][])
      mountSel.append(h('option', { value: v, selected: helmetChoice(u) === v }, l));
    mountSel.addEventListener('change', () => {
      setHelmetMounts(s, u, mountSel.value as HelmetMountChoice);
      onChange();
    });
    const nadeSel = h('select', {});
    for (const g of grenadeTypes()) nadeSel.append(h('option', { value: g.id, selected: g.id === curNade }, `${g.name} · радіус ${g.radius} кл.`));
    nadeSel.addEventListener('change', () => {
      setGrenadeType(s, u, nadeSel.value);
      onChange();
    });
    body.append(h('div', { class: 'col' },
      h('div', { class: 'field' }, h('label', {}, 'Зброя (клас не забороняє іншу)'), wSel),
      h('div', { class: 'field' }, h('label', {}, 'Модифікації'), modBox),
      h('div', { class: 'field' }, h('label', {}, 'Магазини'), magSel),
      hasNades ? h('div', { class: 'field' }, h('label', {}, 'Осколкові гранати'), nadeSel) : null,
      h('div', { class: 'field' }, h('label', {}, 'На каску'), mountSel),
      errors.length ? h('div', { class: 'neg' }, errors.join('; ')) : null,
      h(
        'div',
        { class: 'row' },
        btn('Застосувати', () => {
          const e = equipWeapon(s, u, weaponId, mods, mag);
          if (e.length) return;
          back.remove();
          onChange();
        }, { cls: 'primary', disabled: errors.length > 0 }),
      ),
      h('p', { class: 'muted', style: 'font-size:0.85em' }, 'Характеристики умовні. Після місії модифікації не змінюються до наступної підготовки.'),
    ));
  };
  draw();
  back = modal(`Спорядження — ${u.name} «${u.callsign}»`, body, () => onChange());
  return back;
}
