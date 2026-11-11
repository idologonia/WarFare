"""Генератор великих карт WarFare (результат — JSON у src/content/maps). Запуск: python3 scripts/genmaps.py"""
import json, random

LEGEND = {
  '.': {'terrain': 'grass'}, ',': {'terrain': 'dirt'}, '=': {'terrain': 'road'}, '~': {'terrain': 'mud'},
  'h': {'terrain': 'grass', 'elevation': 0.35}, 'T': {'terrain': 'grass', 'object': 'tree'}, 'b': {'terrain': 'grass', 'object': 'bush'},
  '?': {'terrain': 'grass', 'variation': [[None, 5], ['bush', 3], ['crates', 1], ['scrap', 1]]},
  '!': {'terrain': 'dirt', 'variation': [[None, 6], ['scrap', 2], ['crates', 2], ['concrete_rubble', 1]]},
  '_': {'terrain': 'floor'}, 'S': {'terrain': 'floor', 'stairsUp': True}, '^': {'terrain': 'roof'}, ' ': {'terrain': 'roof', 'floor': False},
  'f': {'terrain': 'grass', 'object': 'fence'}, 's': {'terrain': 'grass', 'object': 'sandbags'}, 'z': {'terrain': 'dirt', 'object': 'sandbags'},
  'm': {'terrain': 'dirt', 'object': 'container'}, 'c': {'terrain': 'dirt', 'object': 'crates'}, 'e': {'terrain': 'dirt', 'object': 'earth_berm'},
  'x': {'terrain': 'dirt', 'object': 'scrap'}, 'r': {'terrain': 'dirt', 'object': 'concrete_rubble'}, 't': {'terrain': 'dirt'},
}

class M:
  def __init__(s, mid, name, w, h, levels, base='.'):
    s.id, s.name, s.w, s.h = mid, name, w, h
    s.L = [[[base if z == 0 else ' ' for _ in range(w)] for _ in range(h)] for z in range(levels)]
    s.edges, s.buildings = [], []
  def set(s, x, y, ch, z=0):
    if 0 <= x < s.w and 0 <= y < s.h: s.L[z][y][x] = ch
  def get(s, x, y, z=0): return s.L[z][y][x]
  def rect(s, x0, y0, x1, y1, ch, z=0):
    for y in range(y0, y1 + 1):
      for x in range(x0, x1 + 1): s.set(x, y, ch, z)
  def building(s, x0, y0, x1, y1, floors, mat='brick_wall', win='brick_window', doors=(), stairs=None, rnd=None, inner=None):
    s.buildings.append([x0, y0, x1, y1])
    for z in range(floors):
      s.rect(x0, y0, x1, y1, '_', z)
      for x in range(x0, x1 + 1):
        for side, y in (('n', y0), ('s', y1)):
          w = win if (x - x0) % 3 == 1 and rnd.random() < 0.8 else mat
          s.edges.append([x, y, z, side, w])
      for y in range(y0, y1 + 1):
        for side, x in (('w', x0), ('e', x1)):
          w = win if (y - y0) % 3 == 1 and rnd.random() < 0.7 else mat
          s.edges.append([x, y, z, side, w])
      if inner and z < floors:
        ix = inner
        for y in range(y0, y1 + 1):
          if y != (y0 + y1) // 2: s.edges.append([ix, y, z, 'w', mat])
          else: s.edges.append([ix, y, z, 'w', 'door'])
    if stairs:
      for z in range(floors - 1): s.set(stairs[0], stairs[1], 'S', z)
    s.rect(x0, y0, x1, y1, '^', floors)
    # двері: замінити ребро
    for (x, y, side) in doors:
      for e in s.edges:
        if e[0] == x and e[1] == y and e[2] == 0 and e[3] == side: e[4] = 'door'
  def dump(s):
    lv = len(s.L)
    while lv > 1 and all(c == ' ' for row in s.L[lv - 1] for c in row): lv -= 1
    return {'id': s.id, 'name': s.name, 'width': s.w, 'height': s.h, 'legend': LEGEND,
            'layers': [[''.join(r) for r in s.L[z]] for z in range(lv)], 'buildings': s.buildings, 'edges': s.edges}

def industrial():
  r = random.Random(7)
  m = M('industrial', 'Промзона', 40, 36, 4, ',')
  # трава по краях, дороги
  for y in range(36):
    for x in range(40):
      if x < 3 or x > 36 or y > 32: m.set(x, y, '.' if r.random() < 0.8 else '?')
  m.rect(0, 16, 39, 17, '=')
  m.rect(19, 0, 20, 35, '=')
  # цех (2 поверхи), склад (1 поверх, бетон), адмінбудівля (3 поверхи), гаражі
  m.building(4, 3, 15, 11, 2, 'concrete_wall', 'brick_window', doors=[(9, 11, 's'), (15, 6, 'e')], stairs=(5, 4), rnd=r, inner=10)
  m.building(24, 3, 35, 9, 1, 'concrete_wall', 'concrete_wall', doors=[(29, 9, 's'), (24, 6, 'w')], rnd=r)
  m.building(24, 21, 31, 27, 3, 'brick_wall', 'brick_window', doors=[(27, 21, 'n'), (31, 24, 'e')], stairs=(25, 26), rnd=r, inner=28)
  m.building(6, 22, 13, 25, 1, 'brick_wall', 'brick_window', doors=[(8, 22, 'n'), (11, 22, 'n')], rnd=r)
  # контейнери, ящики, брухт, мішки
  for (x, y) in [(17, 4), (17, 5), (22, 12), (23, 12), (33, 13), (34, 13), (5, 28), (6, 28), (15, 30), (36, 19)]: m.set(x, y, 'm')
  for (x, y) in [(12, 14), (27, 12), (30, 14), (8, 19), (16, 21), (22, 29), (33, 30), (3, 14)]: m.set(x, y, 'c')
  for (x, y) in [(14, 18), (25, 18), (10, 13), (29, 19), (35, 27), (2, 20)]: m.set(x, y, 'x')
  for (x, y) in [(21, 14), (21, 19), (18, 14), (18, 19)]: m.set(x, y, 'z')
  for y in range(0, 36):
    for x in range(0, 40):
      if m.get(x, y) == ',' and r.random() < 0.06: m.set(x, y, '!')
  for x in range(3, 37):
    if x % 6 != 0: m.set(x, 33, 'f')
  for (x, y) in [(1, 2), (2, 9), (38, 4), (37, 30), (1, 30), (10, 34), (28, 34), (38, 12)]: m.set(x, y, 'T')
  return m

def treeline():
  r = random.Random(11)
  m = M('treeline', 'Лісосмуга', 36, 30, 2, '.')
  # поле, ґрунтова дорога, лісосмуга з деревами по діагоналі
  for x in range(36): m.set(x, 4, ','); m.set(x, 5, ',')
  for y in range(30):
    for x in range(36):
      if 12 <= y <= 17 and r.random() < 0.45: m.set(x, y, 'T' if r.random() < 0.6 else 'b')
      elif r.random() < 0.04: m.set(x, y, '?')
  # окопи (бруствер із землі й мішки), бліндаж
  for x in range(6, 30):
    m.set(x, 19, 'e' if x % 5 else 's')
    m.set(x, 20, 't')
  for x in range(4, 14): m.set(x, 10, 'e' if x % 4 else 'z')
  for x in range(22, 33): m.set(x, 10, 'e' if x % 4 else 'z')
  m.building(15, 22, 19, 24, 1, 'brick_wall', 'brick_wall', doors=[(17, 22, 'n')], rnd=r)
  # пагорб і вирви
  m.rect(28, 24, 33, 28, 'h')
  for (x, y) in [(10, 7), (25, 26), (5, 25), (31, 7)]: m.set(x, y, '~')
  for (x, y) in [(3, 3), (18, 8), (30, 2), (8, 27)]: m.set(x, y, 'x')
  return m

for m in (industrial(), treeline()):
  json.dump(m.dump(), open(f'src/content/maps/{m.id}.json', 'w'), ensure_ascii=False)
  print(m.id, m.w, m.h)
