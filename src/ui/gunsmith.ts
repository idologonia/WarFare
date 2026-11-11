import { content, itemDef } from '@/content';
import {
  BODY_ARMOR,
  EXTRA_ARMOR,
  equipWeapon,
  grenadeTypes,
  helmetChoice,
  setBodyArmor,
  setExtraArmor,
  setGrenadeType,
  setHelmet,
  setHelmetMounts,
  type HelmetMountChoice,
} from '@/game/equipment/loadout';
import { modEffects, validateMods } from '@/game/equipment/mods';
import { countItems, totalWeight } from '@/game/inventory/inventory';
import type { MissionState } from '@/game/simulation/state';
import { computeApMax, freeWeight } from '@/game/units/derived';
import type { ArmorDefinition, Unit, WeaponDefinition } from '@/game/types';
import { camoMaterial } from '@/rendering/camo';
import { GeoBuilder } from '@/rendering/geo';
import { makeMaterial } from '@/rendering/mapView';
import { applyPose, buildUnitModel } from '@/rendering/unitView';
import { buildWeaponGeo } from '@/rendering/weaponGeo';
import { Vector3 } from '@/rendering/babylon';
import { btn, h, modal } from './dom';
import { Preview3D } from './preview3d';
import { openInventoryDnD } from './inventoryDnD';
import { applyMove, validateMove } from '@/game/inventory/transfer';

type Slot = { id: string; title: string; options: string[] };

const SLOT_DEFS: { id: string; title: string; mods: string[] }[] = [
  { id: 'rail', title: 'Планка', mods: ['rail'] },
  { id: 'optic', title: 'Приціл', mods: ['reddot', 'scope4'] },
  { id: 'magnifier', title: 'Магніфер', mods: ['magnifier'] },
  { id: 'grip', title: 'Цівка', mods: ['foregrip', 'underbarrel'] },
];

/** Екран спорядження бійця (лише перед місією): майстерня зброї та екіпірування з 3D-переглядом. */
export function openLoadout(s: MissionState, u: Unit, onChange: () => void): HTMLElement {
  let tab: 'weapon' | 'gear' = 'weapon';
  const weapons = [...content().items.values()].filter((d) => d.kind === 'weapon' && (d as WeaponDefinition).mods && (d as WeaponDefinition).category !== 'launcher' && d.weight < 15) as WeaponDefinition[];
  let weaponId = weapons.some((w) => w.id === u.inventory.primary?.defId) ? u.inventory.primary!.defId : weapons[0].id;
  let mods = [...(u.inventory.primary?.mods ?? [])];
  let mag = u.inventory.primary?.magazine?.defId ?? itemDef<WeaponDefinition>(weaponId).magazines[0];
  let openSlot: string | null = null;

  const body = h('div', { class: 'gunsmith' });
  const applied = h('span', { class: 'pos', style: 'margin-left:8px' });
  const preview = new Preview3D(560, 300, 4.2);
  let back: HTMLElement;

  const showWeapon = () =>
    preview.setContent((scene, root) => {
      const g = new GeoBuilder();
      buildWeaponGeo(g, weaponId, mods, mag);
      const mesh = g.build('pw', scene, makeMaterial(scene, 'pwm'));
      mesh.parent = root;
      mesh.scaling.setAll(4.2);
      mesh.position.set(0, 0, -1.0);
      mesh.enableEdgesRendering(0.95);
      mesh.edgesWidth = 2.5;
      mesh.edgesColor.set(0.02, 0.02, 0.03, 0.9);
      preview.camera.setTarget(new Vector3(0, 0.05, 0));
      preview.camera.radius = 3.3;
      preview.camera.beta = 1.25;
    });
  const showSoldier = () =>
    preview.setContent((scene, root) => {
      const m = buildUnitModel(scene, camoMaterial(scene, u.side), u);
      m.root.parent = root;
      applyPose(m, 'standing', 'low', 'active');
      m.hit.setEnabled(false);
      m.pool.setEnabled(false);
      preview.camera.setTarget(new Vector3(0, 0.62, 0));
      preview.camera.radius = 2.1;
      preview.camera.beta = 1.35;
    });

  const statBar = (label: string, value: number, max: number, text: string, good = true) =>
    h(
      'div',
      { class: 'statrow' },
      h('span', { class: 'muted' }, label),
      h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(4, Math.min(100, (value / max) * 100))}%;background:${good ? 'var(--good)' : 'var(--warn)'}` })),
      h('span', {}, text),
    );

  const renderWeapon = () => {
    const wd = itemDef<WeaponDefinition>(weaponId);
    if (!wd.magazines.includes(mag)) mag = wd.magazines[0];
    const errors = validateMods(weaponId, mods);
    const fx = modEffects({ id: 'tmp', defId: weaponId, magazine: null, mods });
    const recoil = Math.max(2, content().rules.fire.burstShotPenalty + (wd.recoil ?? 0) + fx.recoil);
    const modWeight = mods.reduce((a, id) => a + (content().mods.get(id)?.weight ?? 0), 0);
    const slots: Slot[] = SLOT_DEFS.map((sd) => ({ id: sd.id, title: sd.title, options: sd.mods.filter((m) => (wd.mods ?? []).includes(m)) })).filter((sl) => sl.options.length || (sl.id === 'rail' && wd.rail));
    slots.push({ id: 'mag', title: 'Магазин', options: wd.magazines });
    const current = (sl: Slot) => (sl.id === 'mag' ? mag : sl.id === 'rail' && wd.rail ? 'builtin' : mods.find((m) => sl.options.includes(m)) ?? null);
    const tile = (sl: Slot) => {
      const cur = current(sl);
      const name = cur === 'builtin' ? 'Вбудована' : cur ? (sl.id === 'mag' ? itemDef(cur).name : content().mods.get(cur)!.name) : 'порожньо';
      const t = h(
        'div',
        { class: `slot${openSlot === sl.id ? ' open' : ''}${cur ? ' filled' : ''}`, onclick: () => ((openSlot = openSlot === sl.id ? null : sl.id), draw()) },
        h('div', { class: 'slot-title' }, sl.title),
        h('div', { class: 'slot-item' }, name),
      );
      if (openSlot === sl.id && cur !== 'builtin') {
        const pop = h('div', { class: 'slot-pop panel' });
        if (sl.id !== 'mag') {
          pop.append(btn('Зняти', () => ((mods = mods.filter((m) => !sl.options.includes(m))), (openSlot = null), draw()), { disabled: !cur }));
        }
        for (const opt of sl.options) {
          let reason = '';
          if (sl.id !== 'mag') {
            const trial = [...mods.filter((m) => !sl.options.includes(m)), opt];
            const e = validateMods(weaponId, trial);
            reason = e.find((x) => x.includes(content().mods.get(opt)!.name)) ?? '';
          }
          const label = sl.id === 'mag' ? itemDef(opt).name : content().mods.get(opt)!.name;
          const fxs = sl.id === 'mag' ? '' : Object.entries(content().mods.get(opt)!.effects).map(([k, v]) => `${k} ${(v as number) > 0 ? '+' : ''}${v}`).join(' ');
          pop.append(
            btn(`${label}${reason ? ` — ${reason}` : ''}`, (ev?: unknown) => {
              void ev;
              if (sl.id === 'mag') mag = opt;
              else mods = [...mods.filter((m) => !sl.options.includes(m)), opt];
              openSlot = null;
              draw();
            }, { disabled: !!reason, on: cur === opt, title: fxs }),
          );
        }
        t.append(pop);
      }
      return t;
    };
    const list = h('div', { class: 'weapon-list' });
    for (const w of weapons)
      list.append(
        h(
          'div',
          { class: `wcard${w.id === weaponId ? ' sel' : ''}`, onclick: () => ((weaponId = w.id), (mods = mods.filter((m) => (w.mods ?? []).includes(m))), (openSlot = null), draw()) },
          h('b', {}, w.name),
          h('div', { class: 'muted', style: 'font-size:0.8em' }, `${w.category === 'lmg' ? 'кулемет' : 'автомат'} · ${w.weight} кг · ${w.caliber}`),
        ),
      );
    return h(
      'div',
      { class: 'gs-grid' },
      h(
        'div',
        { class: 'col' },
        preview.canvas,
        h('div', { class: 'slots' }, ...slots.map(tile)),
        errors.length ? h('div', { class: 'neg' }, errors.join('; ')) : null,
      ),
      h(
        'div',
        { class: 'col' },
        h('h3', {}, wd.name),
        statBar('Точність', wd.accuracy + 20 + fx.snap, 40, `${wd.accuracy >= 0 ? '+' : ''}${wd.accuracy}${fx.snap ? ` · навскид ${fx.snap > 0 ? '+' : ''}${fx.snap}` : ''}`),
        statBar('Віддача', 20 - recoil, 20, `−${recoil}% на кулю черги`, recoil <= 8),
        statBar('Дальність', wd.range + fx.range, 30, `${wd.range + fx.range} кл.`),
        statBar('Прицільно далеко', fx.aimedFar, 20, fx.aimedFar ? `+${fx.aimedFar}` : '—'),
        statBar('Вага', 12 - (wd.weight + modWeight), 12, `${(wd.weight + modWeight).toFixed(2)} кг`, wd.weight + modWeight < 6),
        h('div', { class: 'muted', style: 'font-size:0.8em' }, 'Характеристики умовні. Сумісність залежить від моделі; змінюється лише перед місією.'),
        list,
        btn('Застосувати', () => {
          if (equipWeapon(s, u, weaponId, mods, mag).length) return;
          applied.textContent = 'Застосовано';
          setTimeout(() => (applied.textContent = ''), 1500);
          draw();
        }, { cls: 'primary', disabled: errors.length > 0 }),
        applied,
      ),
    );
  };

  const renderGear = () => {
    const inv = u.inventory;
    const wt = totalWeight(inv);
    const fw = freeWeight(u);
    const ap = computeApMax(u);
    const live = (fn: () => void) => () => {
      fn();
      draw();
    };
    const choice = <T extends string>(title: string, opts: [T, string][], cur: T, set: (v: T) => void, disabled = false) =>
      h(
        'div',
        { class: 'slot filled', style: 'cursor:default' },
        h('div', { class: 'slot-title' }, title),
        h('div', { class: 'seg', style: 'margin-top:4px' }, ...opts.map(([v, l]) => btn(l, live(() => set(v)), { on: cur === v, disabled }))),
      );
    const extra = new Set((inv.extraArmor ?? []).map((a) => a.defId));
    const fragIds = grenadeTypes().map((g) => g.id).concat('frag_g1');
    const curNade = [...inv.belt, ...inv.backpackItems.map((e) => e.item)].find((i) => fragIds.includes(i.defId))?.defId as string | undefined;
    return h(
      'div',
      { class: 'gs-grid' },
      h(
        'div',
        { class: 'col' },
        preview.canvas,
        h(
          'div',
          { class: 'statrow' },
          h('span', { class: 'muted' }, 'Вага'),
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, (wt / (fw * 1.4)) * 100)}%;background:${wt > fw ? 'var(--warn)' : 'var(--good)'}` })),
          h('span', { class: wt > fw ? 'neg' : '' }, `${wt} / ${fw.toFixed(1)} кг · AP ${ap.total / 10}`),
        ),
      ),
      h(
        'div',
        { class: 'col' },
        choice('Каска', [['on', 'Є'], ['off', 'Немає']], inv.helmet ? 'on' : 'off', (v) => setHelmet(s, u, v === 'on')),
        choice<HelmetMountChoice>('На каску', [['none', 'Нічого'], ['flashlight', 'Ліхтар'], ['nvg_mono', 'ПНБ моно'], ['nvg_bino', 'ПНБ біно']], helmetChoice(u), (v) => setHelmetMounts(s, u, v), !inv.helmet),
        choice('Бронежилет', [['plate_carrier', 'Плитоноска'], ['rig_ballistic', 'РПС з балістикою'], ['none', 'Немає']], inv.armor?.defId ?? 'none', (v) => setBodyArmor(s, u, v === 'none' ? null : v)),
        h(
          'div',
          { class: 'slot filled', style: 'cursor:default' },
          h('div', { class: 'slot-title' }, 'Додатковий захист'),
          h(
            'div',
            { class: 'seg', style: 'margin-top:4px' },
            ...EXTRA_ARMOR.map((id) => {
              const d = itemDef<ArmorDefinition>(id);
              return btn(d.name, live(() => setExtraArmor(s, u, EXTRA_ARMOR.filter((x) => (x === id ? !extra.has(id) : extra.has(x))))), {
                on: extra.has(id),
                disabled: !!d.requiresCarrier && !inv.armor,
                title: `+${d.weight} кг${d.requiresCarrier ? ' · кріпиться до бронежилета' : ''}`,
              });
            }),
          ),
        ),
        countItems(u, (d) => fragIds.includes(d.id))
          ? choice('Осколкові гранати', grenadeTypes().map((g) => [g.id, g.name] as [string, string]), curNade ?? 'rgd5', (v) => setGrenadeType(s, u, v))
          : null,
        btn('Розкласти рюкзак і підсумки…', () =>
          document.body.querySelector('#app .layer')?.append(
            openInventoryDnD({
              unit: u,
              costNote: 'До бою — безкоштовно.',
              move: (from, to) => {
                const err = validateMove(u, u, from, to);
                if (err) return err;
                applyMove(u, u, from, to);
                return null;
              },
              onClose: () => draw(),
            }),
          ),
        ),
        h('div', { class: 'muted', style: 'font-size:0.8em' }, `Броня: ${BODY_ARMOR.map((id) => itemDef(id).name).join(' / ')} — різна місткість підсумків. Зайві магазини переходять у рюкзак.`),
      ),
    );
  };

  function draw() {
    body.innerHTML = '';
    body.append(
      h('div', { class: 'seg', style: 'margin-bottom:8px' }, btn('Зброя', () => ((tab = 'weapon'), draw()), { on: tab === 'weapon' }), btn('Спорядження', () => ((tab = 'gear'), draw()), { on: tab === 'gear' })),
      tab === 'weapon' ? renderWeapon() : renderGear(),
    );
    if (tab === 'weapon') showWeapon();
    else showSoldier();
  }
  draw();
  back = modal(`Спорядження — ${u.name} «${u.callsign}»`, body, () => {
    preview.dispose();
    onChange();
  });
  back.querySelector('.modal')?.classList.add('wide');
  return back;
}
