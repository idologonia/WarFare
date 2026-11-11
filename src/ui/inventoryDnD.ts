import { content, itemDef } from '@/content';
import { fmtAp } from '@/core/grid';
import { pouchCapacity, totalWeight } from '@/game/inventory/inventory';
import { BELT_CAPACITY, itemAt, validateMove, type ItemDest, type ItemRef } from '@/game/inventory/transfer';
import { freeWeight } from '@/game/units/derived';
import type { AnyItem, BackpackDefinition, MagazineInstance, StackItem, Unit } from '@/game/types';
import { h, modal } from './dom';

const CELL = 42;

export interface InventoryHost {
  unit: Unit;
  /** Тіло або непритомний поруч (обшук). */
  other?: Unit;
  /** loot — обшук тіла, ally — передача бійцю поруч, cache — склад/вантаж техніки. */
  otherKind?: 'loot' | 'ally' | 'cache';
  otherTitle?: string;
  /** Виконати переміщення; повертає текст помилки або null. */
  move: (from: ItemRef, to: ItemDest) => string | null;
  /** Підпис ціни (у бою — AP, до бою — безкоштовно). */
  costNote: string;
  onClose: () => void;
}

function label(it: AnyItem): string {
  const d = itemDef(it.defId);
  const extra = 'rounds' in it ? ` [${(it as MagazineInstance).rounds}]` : 'uses' in it && (it as StackItem).uses > 1 ? ` ×${(it as StackItem).uses}` : '';
  return d.name.replace(/\s*\(.*\)/, '') + extra;
}

/** Вікно інвентаря з перетягуванням (миша й дотик), обшук тіл. */
export function openInventoryDnD(host: InventoryHost): HTMLElement {
  const body = h('div', { class: 'invdnd' });
  const status = h('div', { class: 'muted', style: 'min-height:1.3em' });
  let back: HTMLElement;

  const tile = (owner: Unit, ref: ItemRef, it: AnyItem, style = '') => {
    const d = itemDef(it.defId);
    const el = h('div', { class: `item kind-${d.kind}`, style, title: d.name }, label(it));
    el.addEventListener('pointerdown', (e) => startDrag(e, owner, ref, el));
    return el;
  };

  const slotRow = (owner: Unit, area: 'pouches' | 'belt', cap: number, editable: boolean) => {
    const row = h('div', { class: 'slotrow', 'data-drop': editable ? '1' : '', 'data-owner': owner.id, 'data-area': area });
    const items = area === 'pouches' ? owner.inventory.pouches : owner.inventory.belt;
    for (let i = 0; i < Math.max(cap, items.length); i++) {
      const cell = h('div', { class: 'islot' });
      if (items[i]) cell.append(tile(owner, { owner: owner.id, area, index: i }, items[i]));
      row.append(cell);
    }
    return row;
  };

  const panel = (u: Unit, editable: boolean, title: string) => {
    const inv = u.inventory;
    const p = h('div', { class: 'invpanel panel' }, h('h3', {}, title));
    const prim = h('div', { class: 'islot wide', 'data-drop': editable ? '1' : '', 'data-owner': u.id, 'data-area': 'primary' });
    if (inv.primary) prim.append(tile(u, { owner: u.id, area: 'primary' }, inv.primary));
    p.append(h('div', { class: 'muted' }, 'Зброя'), prim);
    p.append(h('div', { class: 'muted' }, `Підсумки (${inv.pouches.length}/${pouchCapacity(inv)})`), slotRow(u, 'pouches', pouchCapacity(inv), editable));
    p.append(h('div', { class: 'muted' }, `Пояс (${inv.belt.length}/${BELT_CAPACITY})`), slotRow(u, 'belt', BELT_CAPACITY, editable));
    if (inv.backpack) {
      const [gw, gh] = itemDef<BackpackDefinition>(inv.backpack.defId).grid;
      const grid = h('div', { class: 'bpgrid', style: `width:${gw * CELL}px;height:${gh * CELL}px` });
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++)
          grid.append(h('div', { class: 'bpcell', style: `left:${x * CELL}px;top:${y * CELL}px;width:${CELL}px;height:${CELL}px`, 'data-drop': editable ? '1' : '', 'data-owner': u.id, 'data-area': 'backpack', 'data-x': x, 'data-y': y }));
      inv.backpackItems.forEach((e, i) => {
        const [w, hh] = itemDef(e.item.defId).size;
        grid.append(tile(u, { owner: u.id, area: 'backpack', index: i }, e.item, `position:absolute;left:${e.x * CELL + 2}px;top:${e.y * CELL + 2}px;width:${w * CELL - 4}px;height:${hh * CELL - 4}px`));
      });
      p.append(h('div', { class: 'muted' }, itemDef(inv.backpack.defId).name), grid);
    } else p.append(h('div', { class: 'muted' }, 'Рюкзака немає'));
    if (editable) {
      const wt = totalWeight(inv);
      p.append(h('div', { class: wt > freeWeight(u) ? 'neg' : 'muted' }, `Вага ${wt} / ${freeWeight(u).toFixed(1)} кг · AP ${fmtAp(u.ap)}`));
    }
    return p;
  };

  function otherPanel(): HTMLElement | null {
    const o = host.other;
    if (!o) return null;
    if (host.otherKind === 'cache') {
      const p = h('div', { class: 'invpanel panel' }, h('h3', {}, host.otherTitle ?? o.callsign));
      const zone = h('div', { class: 'slotrow cachezone', 'data-drop': '1', 'data-owner': o.id, 'data-area': 'pouches', style: 'flex-wrap:wrap;min-height:90px' });
      o.inventory.pouches.forEach((it, i) => zone.append(h('div', { class: 'islot' }, tile(o, { owner: o.id, area: 'pouches', index: i }, it))));
      p.append(h('div', { class: 'muted' }, `Предметів: ${o.inventory.pouches.length}. Перетягніть сюди, щоб покласти.`), zone);
      return p;
    }
    if (host.otherKind === 'ally') return panel(o, true, host.otherTitle ?? `Передати: ${o.callsign}`);
    return panel(o, false, host.otherTitle ?? `Обшук: ${o.callsign} (${o.status === 'dead' ? 'загинув' : 'непритомний'})`);
  }

  function draw() {
    body.innerHTML = '';
    body.append(
      h('div', { class: 'invcols' }, panel(host.unit, true, `${host.unit.callsign}`), otherPanel()),
      h('div', { class: 'muted', style: 'font-size:0.85em' }, `Перетягніть предмет. ${host.costNote}`),
      status,
    );
  }

  /** Перетягування вказівником (миша/дотик): «привид» слідує за пальцем, ціль — під ним. */
  function startDrag(e: PointerEvent, owner: Unit, ref: ItemRef, el: HTMLElement) {
    e.preventDefault();
    const item = itemAt(owner.inventory, ref);
    if (!item) return;
    const [w, hh] = itemDef(item.defId).size;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add('ghost');
    ghost.style.cssText = `position:fixed;left:0;top:0;width:${w * CELL - 4}px;height:${hh * CELL - 4}px;pointer-events:none;z-index:200;opacity:0.85`;
    document.body.append(ghost);
    el.style.opacity = '0.35';
    let hover: HTMLElement[] = [];
    const destAt = (x: number, y: number): ItemDest | null => {
      const t = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-drop="1"]') as HTMLElement | null;
      if (!t) return null;
      const d: ItemDest = { owner: t.dataset.owner!, area: t.dataset.area as ItemDest['area'] };
      if (d.area === 'backpack') {
        d.x = Number(t.dataset.x);
        d.y = Number(t.dataset.y);
      }
      return d;
    };
    const mark = (x: number, y: number) => {
      hover.forEach((c) => c.classList.remove('ok', 'bad'));
      hover = [];
      const d = destAt(x, y);
      if (!d) return;
      const dstU = host.other && d.owner === host.other.id ? host.other : host.unit;
      const err = host.otherKind === 'cache' && dstU === host.other ? null : validateMove(owner, dstU, ref, d);
      if (d.area === 'backpack') {
        for (let yy = 0; yy < hh; yy++)
          for (let xx = 0; xx < w; xx++) {
            const c = body.querySelector(`.bpcell[data-owner="${d.owner}"][data-x="${d.x! + xx}"][data-y="${d.y! + yy}"]`) as HTMLElement | null;
            if (c) hover.push(c);
          }
      } else {
        const c = body.querySelector(`[data-drop="1"][data-owner="${d.owner}"][data-area="${d.area}"]`) as HTMLElement | null;
        if (c) hover.push(c);
      }
      hover.forEach((c) => c.classList.add(err ? 'bad' : 'ok'));
      status.textContent = err ?? '';
    };
    const move = (ev: PointerEvent) => {
      ghost.style.transform = `translate(${ev.clientX - CELL / 2}px, ${ev.clientY - CELL / 2}px)`;
      mark(ev.clientX - (w - 1) * CELL * 0.5 + 0, ev.clientY - (hh - 1) * CELL * 0.5);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      const d = destAt(ev.clientX - (w - 1) * CELL * 0.5, ev.clientY - (hh - 1) * CELL * 0.5);
      if (d) {
        const err = host.move(ref, d);
        draw();
        status.textContent = err ?? '';
      } else draw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e);
  }

  draw();
  back = modal(host.otherKind === 'cache' ? 'Постачання' : host.otherKind === 'ally' ? 'Передача' : host.other ? 'Обшук' : 'Інвентар', body, host.onClose);
  back.querySelector('.modal')?.classList.add('wide');
  void content;
  return back;
}
