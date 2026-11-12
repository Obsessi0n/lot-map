// The quest: the same session read as a dungeon crawl. A hero walks while the model thinks, meets something at every
// tool call, and keeps experience, gold and loot from one session to the next. Nothing here touches the engine.
import type { Board, Entry, Hero, HeroLine } from '../types'

// ---- the hero ---------------------------------------------------------------------------------

export const MAX_HP = 5
const LOG = 30

export const freshHero = (): Hero => ({ xp: 0, gold: 0, hp: MAX_HP, kills: 0, chests: 0, forged: 0, bosses: 0, falls: 0, loot: {}, log: [] })

/** What is kept between sessions: everything but the diary, which is the session's own. */
export const keep = (hero: Hero): Omit<Hero, 'log'> => {
  const { log: _log, ...rest } = hero
  return rest
}

/** A hero as the store gave it back, or nothing when it is not one: whatever is missing or malformed starts afresh. */
export function heroFrom(kept: unknown): Hero | undefined {
  if (typeof kept !== 'object' || kept === null) return undefined
  const k = kept as Record<string, unknown>
  const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined)
  const xp = n(k.xp)
  if (xp === undefined) return undefined
  const loot: Record<string, number> = {}
  if (typeof k.loot === 'object' && k.loot !== null) {
    for (const [name, count] of Object.entries(k.loot as Record<string, unknown>).slice(0, 64)) {
      const c = n(count)
      if (c !== undefined && c > 0 && name.length <= 40) loot[name] = c
    }
  }
  return {
    xp,
    gold: n(k.gold) ?? 0,
    hp: Math.min(MAX_HP, n(k.hp) ?? MAX_HP),
    kills: n(k.kills) ?? 0,
    chests: n(k.chests) ?? 0,
    forged: n(k.forged) ?? 0,
    bosses: n(k.bosses) ?? 0,
    falls: n(k.falls) ?? 0,
    loot,
    log: [],
  }
}

/** Level 1 at no experience; each level takes more than the last. */
export const levelOf = (xp: number): number => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 40))
const floorOf = (level: number): number => 40 * (level - 1) ** 2

/** How far into the level the hero is, and how long the level is. */
export function progress(xp: number): { level: number; into: number; span: number } {
  const level = levelOf(xp)
  return { level, into: xp - floorOf(level), span: floorOf(level + 1) - floorOf(level) }
}

/** What the hero does at a call, by where the call went. */
export type Act = 'explore' | 'forge' | 'fight' | 'raven' | 'tome' | 'ally' | 'scroll'

const XP: Record<Act, number> = { explore: 2, forge: 4, fight: 5, raven: 3, tome: 3, ally: 6, scroll: 3 }

export function actOf(station: Entry['station'], forge = false): Act | undefined {
  switch (station) {
    case 'files':
      return forge ? 'forge' : 'explore'
    case 'shell':
      return 'fight'
    case 'web':
    case 'browser':
      return 'raven'
    case 'memory':
      return 'tome'
    case 'agents':
      return 'ally'
    case 'skills':
      return 'scroll'
    default:
      return undefined
  }
}

// ---- words ------------------------------------------------------------------------------------

export type Words = {
  pane: string
  command: string
  opened: string
  level: string
  gold: string
  breath: string
  titles: readonly (readonly [number, string])[]
  camp: string
  walk: string
  doing: Record<Act, string>
  done: Record<Act, string>
  mission: string
  revived: string
  hit: string
  fell: string
  locked: string
  victory: string
  retreat: string
  rest: string
  levelUp: (level: number, title: string) => string
  loot: (item: string) => string
  items: readonly string[]
  nothingYet: string
}

const en: Words = {
  pane: 'Quest',
  command: 'Open the quest beside the chat',
  opened: 'Quest opened.',
  level: 'Lv',
  gold: 'gold',
  breath: 'Stamina',
  titles: [[1, 'Apprentice'], [3, 'Adventurer'], [6, 'Knight'], [10, 'Master'], [15, 'Legend']],
  camp: 'Resting by the fire, waiting for a quest.',
  walk: 'Walking down the corridor...',
  doing: { explore: 'Exploring a room', forge: 'At the forge', fight: 'In combat', raven: 'A raven is on its way', tome: 'Reading the old tome', ally: 'A companion joins', scroll: 'Unrolling a scroll' },
  done: { explore: 'Chest opened', forge: 'Forged', fight: 'Monster beaten', raven: 'The raven is back', tome: 'Lore recalled', ally: 'The companion reports back', scroll: 'Scroll read' },
  mission: 'A new quest is taken at the tavern.',
  revived: 'The hero wakes up at the tavern, good as new.',
  hit: 'Took a blow!',
  fell: 'The hero has fainted...',
  locked: 'A locked door',
  victory: 'Boss beaten!',
  retreat: 'A tactical retreat.',
  rest: 'A rest by the fire: stamina is back.',
  levelUp: (level, title) => `LEVEL UP! Lv ${level}, ${title}`,
  loot: item => `Loot: ${item}`,
  items: ['Regex Sword', 'Shield of Types', 'Cache Potion', 'Linter Amulet', 'Boots of Refactoring', 'Ring of Rollback', 'Cloak of Mocks', 'Helm of Null Safety', 'Dagger of Hotfix', 'Lantern of Logs', 'Gauntlets of Merge', 'Rune of Idempotence'],
  nothingYet: 'The diary is empty.',
}

// European Portuguese.
const pt: Words = {
  pane: 'Masmorra',
  command: 'Abrir a masmorra ao lado do chat',
  opened: 'Masmorra aberta.',
  level: 'Nv',
  gold: 'ouro',
  breath: 'Fôlego',
  titles: [[1, 'Aprendiz'], [3, 'Aventureiro'], [6, 'Cavaleiro'], [10, 'Mestre'], [15, 'Lenda']],
  camp: 'A descansar junto à fogueira, à espera de missão.',
  walk: 'A avançar pelo corredor...',
  doing: { explore: 'A explorar uma sala', forge: 'Na forja', fight: 'Em combate', raven: 'Um corvo segue viagem', tome: 'A ler o velho tomo', ally: 'Um companheiro junta-se', scroll: 'A desenrolar um pergaminho' },
  done: { explore: 'Baú aberto', forge: 'Forjado', fight: 'Monstro derrotado', raven: 'O corvo regressou', tome: 'Saber recordado', ally: 'O companheiro dá notícias', scroll: 'Pergaminho lido' },
  mission: 'Nova missão aceite na taberna.',
  revived: 'O herói acorda na taberna, como novo.',
  hit: 'Levou um golpe!',
  fell: 'O herói desmaiou...',
  locked: 'Uma porta trancada',
  victory: 'Boss derrotado!',
  retreat: 'Retirada estratégica.',
  rest: 'Descanso na fogueira: fôlego recuperado.',
  levelUp: (level, title) => `SUBIU DE NÍVEL! Nv ${level}, ${title}`,
  loot: item => `Loot: ${item}`,
  items: ['Espada de Regex', 'Escudo de Tipos', 'Poção de Cache', 'Amuleto do Linter', 'Botas de Refactoring', 'Anel do Rollback', 'Capa de Mocks', 'Elmo Anti-Null', 'Adaga do Hotfix', 'Lanterna de Logs', 'Manoplas do Merge', 'Runa da Idempotência'],
  nothingYet: 'O diário está vazio.',
}

/** The quest speaks English and Portuguese; any other language of the map falls back to English. */
export const wordsFor = (language: unknown): Words => (language === 'pt' ? pt : en)

export const titleOf = (level: number, w: Words): string => [...w.titles].reverse().find(([from]) => level >= from)?.[1] ?? ''

// ---- what happens to the hero -----------------------------------------------------------------

const note = (hero: Hero, at: number, text: string, tone: HeroLine['tone']): Hero => ({ ...hero, log: [...hero.log, { at, text, tone }].slice(-LOG) })

/** Experience, and a line in the diary when it carries the hero to a new level. */
function earn(hero: Hero, xp: number, at: number, w: Words): Hero {
  const before = levelOf(hero.xp)
  const after = levelOf(hero.xp + xp)
  const next = { ...hero, xp: hero.xp + xp }
  return after > before ? note(next, at, w.levelUp(after, titleOf(after, w)), 'gold') : next
}

const named = (text: string, label: string): string => (label === '' ? text : `${text}: ${label}`)

/** A new message of the person's: a quest. A hero who fainted is back on their feet. */
export function mission(hero: Hero, at: number, w: Words): Hero {
  return hero.hp <= 0 ? note({ ...hero, hp: MAX_HP }, at, w.revived, 'good') : note(hero, at, w.mission, 'plain')
}

/** A call that ended: experience when it went well, a blow when it failed, a locked door when it was refused. */
export function deed(hero: Hero, act: Act | undefined, label: string, outcome: 'ok' | 'err' | 'block', byCompanion: boolean, at: number, w: Words): Hero {
  if (outcome === 'block') return note(hero, at, named(w.locked, label), 'bad')
  if (outcome === 'err') {
    // A companion's stumble is not the hero's wound.
    if (byCompanion) return hero
    const hp = Math.max(0, hero.hp - 1)
    const hurt = note({ ...hero, hp }, at, named(w.hit, label), 'bad')
    return hp === 0 && hero.hp > 0 ? note({ ...hurt, falls: hurt.falls + 1 }, at, w.fell, 'bad') : hurt
  }
  if (act === undefined) return hero
  if (byCompanion) return earn(hero, 1, at, w)
  const xp = XP[act]
  const counted = { ...hero, kills: hero.kills + (act === 'fight' ? 1 : 0), chests: hero.chests + (act === 'explore' ? 1 : 0), forged: hero.forged + (act === 'forge' ? 1 : 0) }
  return earn(note(counted, at, `${named(w.done[act], label)}  +${xp} XP`, 'good'), xp, at, w)
}

/** The answer is ready: the boss is down, with gold, a piece of loot and a heart back. An interrupted turn is a retreat. */
export function victory(hero: Hero, isAborted: boolean, at: number, w: Words): Hero {
  if (isAborted) return note(hero, at, w.retreat, 'plain')
  const gold = 5 + levelOf(hero.xp)
  // Which piece: by the count of bosses, so the same hero finds the pieces in the same order and none is left out for long.
  const item = w.items[(hero.bosses * 7 + 3) % w.items.length] ?? ''
  const won = { ...hero, bosses: hero.bosses + 1, gold: hero.gold + gold, hp: Math.min(MAX_HP, hero.hp + 1), loot: { ...hero.loot, [item]: (hero.loot[item] ?? 0) + 1 } }
  return earn(note(note(won, at, `${w.victory}  +20 XP  +${gold} ${w.gold}`, 'gold'), at, w.loot(item), 'gold'), 20, at, w)
}

export const rested = (hero: Hero, at: number, w: Words): Hero => note(hero, at, w.rest, 'good')

// ---- the scene --------------------------------------------------------------------------------

const WON_MS = 1300
const TROPHY_MS = 2600

export type Scene =
  | { kind: 'camp' }
  | { kind: 'walk' }
  | { kind: 'trophy'; age: number }
  | { kind: 'door'; age: number; label: string }
  | { kind: Act; phase: 'run' | 'won' | 'hit'; age: number; label: string }

/** What the hero is at, read off the board: the newest call of the main loop still running or just over, else walking or resting. */
export function sceneOf(board: Board, now: number): Scene {
  const recent = board.entries.slice(-40)
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i]
    if (e === undefined || e.from === 'agents') continue
    const over = e.endedAt === undefined ? Infinity : now - e.endedAt
    if (e.station === 'hooks' && e.status === 'block' && over < WON_MS) return { kind: 'door', age: over, label: e.label }
    const act = actOf(e.station, e.forge === true)
    if (act === undefined) continue
    if (e.status === 'run') return { kind: act, phase: 'run', age: now - e.startedAt, label: e.label }
    if (over < WON_MS) return e.status === 'block' ? { kind: 'door', age: over, label: e.label } : { kind: act, phase: e.status === 'ok' ? 'won' : 'hit', age: over, label: e.label }
  }
  const done = recent.filter(e => e.mark === 'done').pop()
  if (done !== undefined && now - done.startedAt < TROPHY_MS && !recent.some(e => e.status === 'run')) return { kind: 'trophy', age: now - done.startedAt }
  return recent.some(e => e.status === 'run') ? { kind: 'walk' } : { kind: 'camp' }
}

/** The room the scene takes in a pane's body: as wide as the body up to 64 cells, twelve rows tall; nothing where it does not fit. */
export function questSize(bodyColumns: number, bodyRows: number): { columns: number; rows: number } | undefined {
  const columns = Math.min(64, Math.floor(bodyColumns))
  return columns >= 36 && Math.floor(bodyRows) >= 20 ? { columns, rows: 12 } : undefined
}

// ---- pixels -----------------------------------------------------------------------------------

/** A picture of square pixels, each a colour `0xRRGGBB`. In a terminal two of them stand in one cell, one over the other. */
export type Pixels = { w: number; h: number; px: Uint32Array }

const C = {
  wall: 0x1d2029, wallDark: 0x14161c, floor: 0x343a47, floorTop: 0x525b6e, floorDark: 0x272c36,
  steel: 0xb9c2cf, steelDark: 0x7d8794, skin: 0xf0c090, eye: 0x1b1e26, tunic: 0xe0a13a, tunicDark: 0xb37a22, belt: 0x6b4a2b, legs: 0x3d4c70, boot: 0x2a2018,
  blade: 0xe9eef4, hilt: 0xd9a441, slime: 0x58c26a, slimeDark: 0x3a9150, white: 0xf4f4f0,
  wood: 0x8a5a2b, woodDark: 0x5f3c1c, gold: 0xf2c94c, goldDark: 0xc79a1e, iron: 0x6a7487, ironDark: 0x454c5c,
  spark: 0xffb347, sparkHot: 0xfff0a8, crow: 0x30343f, crowDark: 0x1c1f27, beak: 0xe08a2e,
  fire: 0xf07b2a, fireHot: 0xffd866, ember: 0xb8431f, robe: 0x7a5cc4, robeDark: 0x5a429a,
  teal: 0x62c7ba, tealHot: 0xa5e6dc, paper: 0xe8dcc0, paperDark: 0xb8a67c, red: 0xe8654f, gem: 0x6fd3ff, gemHot: 0xd6f3ff,
}

function put(p: Pixels, x: number, y: number, color: number): void {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px >= 0 && py >= 0 && px < p.w && py < p.h) p.px[py * p.w + px] = color
}

/** A sprite: rows of letters, each letter a colour of `colors`, anything else see-through. `wash` paints every pixel one colour. */
function stamp(p: Pixels, x: number, y: number, rows: readonly string[], colors: Record<string, number>, wash?: number): void {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const color = colors[row[dx] ?? '']
      if (color !== undefined) put(p, x + dx, y + dy, wash ?? color)
    }
  })
}

const HERO_INK = { h: C.steel, H: C.steelDark, s: C.skin, e: C.eye, t: C.tunic, T: C.tunicDark, b: C.belt, l: C.legs, k: C.boot }
const HERO_BODY = ['...hhhh...', '..hhhhhh..', '..hHHHHh..', '..sssses..', '..ssssss..', '.tttttttt.', 'sttttttTts', '.tbbbbbbT.', '.ttttttTT.']
const HERO_LEGS = [
  ['..ll..ll..', '..ll..ll..', '..kk..kk..'],
  ['..ll.ll...', '.ll...ll..', '.kk....kk.'],
  ['...llll...', '...l..l...', '...kk.kk..'],
]

const SLIME_INK = { g: C.slime, G: C.slimeDark, w: C.white, k: C.eye }
const SLIME = ['...gggg...', '.gggggggg.', 'ggwwggwwgg', 'ggwkggwkgg', 'gggggggggg', 'gGGGGGGGGg', '.GGGGGGGG.']
const SLIME_LOW = ['..........', '..gggggg..', 'ggwwggwwgg', 'ggwkggwkgg', 'gggggggggg', 'gGGGGGGGGg', 'GGGGGGGGGG']

const CHEST_INK = { b: C.woodDark, B: C.wood, y: C.gold, Y: C.goldDark }
const CHEST = ['.bbbbbbbb.', 'bBBBBBBBBb', 'bBBBBBBBBb', 'yyyyYYyyyy', 'bBBByyBBBb', 'bBBBBBBBBb', 'bBBBBBBBBb', 'bbbbbbbbbb']
const CHEST_OPEN = ['..bbbbbb..', '.bBBBBBBb.', '.byyyyyyb.', 'byyyyyyyyb', 'yyyyYYyyyy', 'bBBByyBBBb', 'bBBBBBBBBb', 'bBBBBBBBBb', 'bbbbbbbbbb']

const ANVIL_INK = { i: C.iron, I: C.ironDark }
const ANVIL = ['iiiiiiiii.', '.iiiiiiiii', '..IIIIII..', '...iiii...', '...iiii...', '..iiiiii..', '.IIIIIIII.']

const RAVEN_INK = { k: C.crow, K: C.crowDark, w: C.white, o: C.beak }
const RAVEN = [
  ['.K.....K.', '.kK...Kk.', '..kkkkk..', '..kkkwkoo', '...kkk...', '...K.K...'],
  ['.........', '..kkkkk..', '.kkkkwkoo', 'kK.kkk.Kk', 'K..K.K..K', '.........'],
]

const TOME_INK = { t: C.teal, P: C.paper, l: C.paperDark }
const TOME = ['.tttttttt.', 'tPPPPtPPPt', 'tPllPtPllt', 'tPPPPtPPPt', 'tPllPtPllt', 'tPPPPtPPPt', '.tttttttt.']

const MAGE_INK = { p: C.robe, P: C.robeDark, s: C.skin, e: C.eye, k: C.boot }
const MAGE = ['...p...', '..ppp..', '.ppppp.', 'PPPPPPP', '..sss..', '..ses..', '.ppppp.', '.pPpPp.', '.ppppp.', '..k.k..']

const SCROLL_INK = { W: C.paperDark, P: C.paper, l: C.woodDark }
const SCROLL = ['WWWWWWWWW', '.PPPPPPP.', '.PlllllP.', '.PPPPPPP.', '.PllllPP.', '.PPPPPPP.', '.PlllPPP.', 'WWWWWWWWW']

const DOOR_INK = { d: C.woodDark, D: C.wood, y: C.gold, Y: C.goldDark }
const DOOR = ['.dddddddd.', 'dDDDDDDDDd', 'dDDdDDdDDd', 'dDDdDDdDDd', 'dDDdDDdDDd', 'dDDDyyDDDd', 'dDDyYYyDDd', 'dDDyYYyDDd', 'dDDDyyDDDd', 'dDDdDDdDDd', 'dDDdDDdDDd', 'dDDdDDdDDd', 'dDDdDDdDDd', 'dDDDDDDDDd']

const FIRE_INK = { f: C.fire, F: C.fireHot, e: C.ember, L: C.wood }
const FIRE = [
  ['....f....', '...fff...', '...fFf...', '..ffFff..', '..fFFFf..', '.eefFfee.', 'LLLLLLLLL', '.L.....L.'],
  ['...f.....', '...ff....', '..ffFf...', '..fFFff..', '..fFFFf..', '.eeFFfee.', 'LLLLLLLLL', '.L.....L.'],
  ['.....f...', '....ff...', '...fFff..', '..ffFFf..', '..fFFFf..', '.eefFFee.', 'LLLLLLLLL', '.L.....L.'],
]

const GEM_INK = { g: C.gem, G: C.gemHot }
const GEM = ['....g....', '...gGg...', '..gGGGg..', '.gGGGGGg.', '..gGGGg..', '...gGg...', '....g....']

/** The scene at `now`, `w` pixels by `h`: the corridor, the hero, whoever came along, and what the hero has met. */
export function paintQuest(board: Board, now: number, w: number, h: number): Pixels {
  const p: Pixels = { w, h, px: new Uint32Array(w * h) }
  const scene = sceneOf(board, now)
  const tick = Math.floor(now / 140)
  const ground = h - 6
  const walking = scene.kind === 'walk'
  // The floor slides under a hero who walks; the wall stands, so the torches stay where they are.
  const slide = walking ? Math.floor(now / 90) : 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let color: number
      if (y < ground) {
        const course = Math.floor(y / 4)
        color = y % 4 === 3 || (x + (course % 2) * 4) % 8 === 7 ? C.wallDark : C.wall
      } else if (y === ground) color = C.floorTop
      else color = (x + slide + (y % 2) * 3) % 7 === 0 ? C.floorDark : C.floor
      p.px[y * w + x] = color
    }
  }

  // Two torches on the wall, their flames never quite the same.
  // They hang high, over everyone's head.
  for (const [k, x] of [Math.floor(w * 0.22), Math.floor(w * 0.6)].entries()) {
    const flick = (tick + k * 2) % 3
    for (let dy = 0; dy < 2; dy++) put(p, x, 4 + dy, C.woodDark)
    stamp(p, x - 1, 1, [flick === 0 ? '.f.' : flick === 1 ? 'f..' : '..f', 'fFf', 'fFf'], FIRE_INK)
  }

  // The companions come first, behind the hero: one for each subagent still at work.
  const crew = Math.min(2, (board.agents ?? []).length)
  for (let k = 0; k < crew; k++) stamp(p, 1 + k * 7, ground - MAGE.length - ((tick + k) % 4 === 0 ? 1 : 0), MAGE, MAGE_INK)

  const heroX = 16
  const isHit = scene.kind !== 'camp' && scene.kind !== 'walk' && scene.kind !== 'trophy' && scene.kind !== 'door' && scene.phase === 'hit'
  const strikes = scene.kind === 'fight' && scene.phase === 'run' && tick % 4 < 2
  const hammers = scene.kind === 'forge' && scene.phase === 'run' && tick % 4 < 2
  const bob = walking && tick % 2 === 0 ? 1 : 0
  const heroY = ground - 12 - bob
  const legs = HERO_LEGS[walking ? 1 + (tick % 2) : 0] ?? []
  const wash = isHit && tick % 2 === 0 ? C.red : undefined
  stamp(p, heroX, heroY, [...HERO_BODY, ...legs], HERO_INK, wash)
  if (strikes || hammers) {
    // The blade swung forward.
    for (let dx = 0; dx < 6; dx++) put(p, heroX + 11 + dx, heroY + 6, C.blade)
    for (let dy = -1; dy <= 1; dy++) put(p, heroX + 10, heroY + 6 + dy, C.hilt)
  } else {
    // The blade held up.
    for (let dy = 0; dy < 6; dy++) put(p, heroX + 10, heroY + dy, C.blade)
    for (let dx = -1; dx <= 1; dx++) put(p, heroX + 10 + dx, heroY + 6, C.hilt)
  }

  const at = w - 20
  /** A few specks that rise and thin out, for a blow that landed, a spark off the anvil, a coin out of a chest. */
  const specks = (x: number, y: number, age: number, colors: readonly number[], spread = 8): void => {
    const t = Math.min(1, age / WON_MS)
    for (let k = 0; k < 7; k++) {
      if ((k + tick) % 3 === 0 && t > 0.4) continue
      put(p, x + ((k * 5 + 2) % spread) - spread / 2 + (k % 2 === 0 ? t * 2 : -t * 2), y - t * 7 - (k % 3), colors[k % colors.length] ?? C.white)
    }
  }

  switch (scene.kind) {
    case 'camp':
      stamp(p, at, ground - 8, FIRE[tick % 3] ?? [], FIRE_INK)
      break
    case 'walk':
      break
    case 'trophy': {
      const lift = Math.min(4, Math.floor(scene.age / 150))
      stamp(p, at, ground - 9 - lift, GEM, GEM_INK)
      // Rays around the gem, turning.
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI + tick * 0.4
        put(p, at + 4 + Math.cos(a) * 7, ground - 6 - lift + Math.sin(a) * 5, k % 2 === 0 ? C.gold : C.gemHot)
      }
      break
    }
    case 'door':
      stamp(p, at, ground - DOOR.length, DOOR, DOOR_INK, tick % 2 === 0 && scene.age < 600 ? C.red : undefined)
      break
    case 'fight':
      if (scene.phase === 'won') specks(at + 5, ground - 3, scene.age, [C.gold, C.slime, C.white])
      else stamp(p, at - (strikes ? 0 : 1), ground - 7, tick % 4 < 2 ? SLIME : SLIME_LOW, SLIME_INK)
      break
    case 'explore':
      if (scene.phase === 'run') stamp(p, at, ground - CHEST.length, CHEST, CHEST_INK)
      else {
        stamp(p, at, ground - CHEST_OPEN.length, CHEST_OPEN, CHEST_INK)
        if (scene.phase === 'won') specks(at + 5, ground - 7, scene.age, [C.gold, C.gold, C.sparkHot])
      }
      break
    case 'forge':
      stamp(p, at, ground - ANVIL.length, ANVIL, ANVIL_INK)
      if (scene.phase === 'run' && hammers) specks(at + 3, ground - 8, (tick % 4) * 250, [C.spark, C.sparkHot, C.fire], 6)
      if (scene.phase === 'won') for (let dx = 0; dx < 7; dx++) put(p, at + 1 + dx, ground - 8, dx === 0 ? C.hilt : C.sparkHot)
      break
    case 'raven': {
      // Out to the far wall while the call runs, and back to the hero with the news when it ends.
      const span = at - (heroX + 12)
      const t = scene.phase === 'run' ? Math.min(1, scene.age / 1200) : 1 - Math.min(1, scene.age / WON_MS)
      stamp(p, heroX + 12 + span * t, ground - 13 + Math.round(Math.sin(now / 200) * 1.5), RAVEN[tick % 2] ?? [], RAVEN_INK)
      break
    }
    case 'tome': {
      const hover = Math.round(Math.sin(now / 260) * 1.2)
      stamp(p, at, ground - 11 + hover, TOME, TOME_INK)
      for (let k = 0; k < 5; k++) put(p, at - 2 + ((k * 4 + tick) % 14), ground - 13 + hover + ((k * 3 + tick) % 11), k % 2 === 0 ? C.tealHot : C.teal)
      break
    }
    case 'ally':
      stamp(p, at + 1, ground - MAGE.length - (tick % 4 === 0 ? 1 : 0), MAGE, MAGE_INK)
      if (scene.phase !== 'run') specks(at + 4, ground - 10, scene.age, [C.robe, C.tealHot, C.white])
      break
    case 'scroll':
      stamp(p, at, ground - 10 + Math.round(Math.sin(now / 300)), SCROLL, SCROLL_INK)
      break
  }
  return p
}

// ---- out of the pixels ------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const UPPER_HALF = 0x2580

/** The picture as a Raster's `cells`, two pixels to a cell: the upper half block in the top pixel's colour on the bottom one's. */
export function questCells(p: Pixels): string {
  const columns = p.w
  const rows = Math.floor(p.h / 2)
  const bytes = new Uint8Array(columns * rows * 12)
  const view = new DataView(bytes.buffer)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = (r * columns + c) * 12
      view.setUint32(i, UPPER_HALF, true)
      view.setUint32(i + 4, p.px[r * 2 * columns + c] ?? 0, true)
      view.setUint32(i + 8, p.px[(r * 2 + 1) * columns + c] ?? 0, true)
    }
  }
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const d = bytes[i + 2] ?? 0
    out.push((B64[a >> 2] ?? '') + (B64[((a & 3) << 4) | (b >> 4)] ?? '') + (B64[((b & 15) << 2) | (d >> 6)] ?? '') + (B64[d & 63] ?? ''))
  }
  return out.join('')
}

/** The picture as a drawing, for a surface that takes one: a rectangle for each run of one colour in a row. */
export function questSvg(p: Pixels, scale = 8): string {
  let body = ''
  for (let y = 0; y < p.h; y++) {
    let from = 0
    for (let x = 1; x <= p.w; x++) {
      const color = p.px[y * p.w + from] ?? 0
      if (x < p.w && p.px[y * p.w + x] === color) continue
      body += `<rect x="${from}" y="${y}" width="${x - from}" height="1" fill="#${color.toString(16).padStart(6, '0')}"/>`
      from = x
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${p.w} ${p.h}" width="${p.w * scale}" height="${p.h * scale}" shape-rendering="crispEdges">${body}</svg>`
}

// ---- the sheet under the scene ----------------------------------------------------------------

const bar = (value: number, of: number, width = 10): string => {
  const full = Math.max(0, Math.min(width, Math.round((value / Math.max(1, of)) * width)))
  return '█'.repeat(full) + '░'.repeat(width - full)
}

/** The three lines under the scene: who the hero is, how far along, and what they are at. */
export function sheet(hero: Hero, board: Board, now: number, w: Words): { who: string; bars: string; doing: string } {
  const { level, into, span } = progress(hero.xp)
  const hp = Math.max(0, Math.min(MAX_HP, hero.hp))
  const who = `${w.level} ${level} ${titleOf(level, w)}   ${'♥'.repeat(hp)}${'♡'.repeat(MAX_HP - hp)}   ${hero.gold} ${w.gold}`
  const left = board.context === undefined ? undefined : Math.max(0, Math.min(100, 100 - Math.round(board.context)))
  const bars = `XP ${bar(into, span)} ${into}/${span}${left === undefined ? '' : `   ${w.breath} ${bar(left, 100)} ${left}%`}`
  const scene = sceneOf(board, now)
  const doing =
    scene.kind === 'camp' ? w.camp
    : scene.kind === 'walk' ? w.walk
    : scene.kind === 'trophy' ? w.victory
    : scene.kind === 'door' ? named(w.locked, scene.label)
    : scene.phase === 'run' ? named(w.doing[scene.kind], scene.label)
    : scene.phase === 'won' ? named(w.done[scene.kind], scene.label)
    : named(w.hit, scene.label)
  return { who, bars, doing }
}
