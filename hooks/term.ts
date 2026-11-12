// The map for a terminal, which draws no picture: a grid of cells, braille dots for the lines and the nodes,
// letters for the names. Nothing here touches the engine.
import type { Board, Entry } from '../types'
import { STATIONS, shortModel } from './map'
import type { Setup } from './map'

export type TermSize = { columns: number; rows: number }

/** The room the map takes in a pane's body, or nothing where the body is too small for it. */
export function termSize(bodyColumns: number, bodyRows: number): TermSize | undefined {
  const columns = Math.min(76, Math.floor(bodyColumns))
  const rows = Math.min(21, Math.floor(bodyRows) - 8)
  return columns >= 50 && rows >= 17 ? { columns, rows } : undefined
}

// ---- cells ------------------------------------------------------------------------------------

/** The terminal's own color, for a foreground or a background. */
const DEFAULT = 0x01000000
const SPACE = 0x20
const BRAILLE = 0x2800
/** The bit of each dot of a braille cell, by row then column. */
const DOTS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80]

/** A grid of cells. Each holds a letter or a set of braille dots, in one color. A dot is half a cell wide and a quarter tall. */
export type Canvas = { w: number; h: number; glyph: Uint32Array; ink: Uint32Array; bits: Uint8Array }

function canvas(w: number, h: number): Canvas {
  return { w, h, glyph: new Uint32Array(w * h).fill(SPACE), ink: new Uint32Array(w * h).fill(DEFAULT), bits: new Uint8Array(w * h) }
}

function dot(c: Canvas, x: number, y: number, color: number): void {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= c.w * 2 || py >= c.h * 4) return
  const i = (py >> 2) * c.w + (px >> 1)
  c.bits[i] = (c.bits[i] ?? 0) | (DOTS[(py & 3) * 2 + (px & 1)] ?? 0)
  c.ink[i] = color
}

function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, color: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
  for (let k = 0; k <= steps; k++) dot(c, x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps, color)
}

/** An ellipse's outline. `color` is asked for each point by how far round it is from the top, clockwise, 0 to 1. */
function oval(c: Canvas, cx: number, cy: number, rx: number, ry: number, color: (round: number) => number, every = 1): void {
  const steps = Math.ceil(2 * Math.PI * Math.max(rx, ry) * 1.5)
  for (let k = 0; k < steps; k += every) {
    const a = (k / steps) * 2 * Math.PI
    dot(c, cx + rx * Math.sin(a), cy - ry * Math.cos(a), color(k / steps))
  }
}

/** Letters over whatever dots were there: a name is never struck through by a line. */
function write(c: Canvas, col: number, row: number, text: string, color: number): void {
  if (row < 0 || row >= c.h) return
  let at = col
  for (const ch of text) {
    if (at >= 0 && at < c.w) {
      const i = row * c.w + at
      c.glyph[i] = ch.codePointAt(0) ?? SPACE
      c.bits[i] = 0
      c.ink[i] = color
    }
    at++
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The cells as a Raster takes them: base64 of little-endian u32 triplets, code point, foreground, background. */
export function pack(c: Canvas): string {
  const bytes = new Uint8Array(c.w * c.h * 12)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < c.w * c.h; i++) {
    const bits = c.bits[i] ?? 0
    view.setUint32(i * 12, bits !== 0 ? BRAILLE + bits : (c.glyph[i] ?? SPACE), true)
    view.setUint32(i * 12 + 4, c.ink[i] ?? DEFAULT, true)
    view.setUint32(i * 12 + 8, DEFAULT, true)
  }
  // Twelve bytes a cell: the length is always a multiple of three, so there is no padding to write.
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const d = bytes[i + 2] ?? 0
    out.push((B64[a >> 2] ?? '') + (B64[((a & 3) << 4) | (b >> 4)] ?? '') + (B64[((b & 15) << 2) | (d >> 6)] ?? '') + (B64[d & 63] ?? ''))
  }
  return out.join('')
}

/** The rows as plain text, colors left out: what a test reads. */
export function rowsOf(c: Canvas): string[] {
  const rows: string[] = []
  for (let r = 0; r < c.h; r++) {
    let text = ''
    for (let k = 0; k < c.w; k++) {
      const i = r * c.w + k
      const bits = c.bits[i] ?? 0
      text += String.fromCodePoint(bits !== 0 ? BRAILLE + bits : (c.glyph[i] ?? SPACE))
    }
    rows.push(text.replace(/\s+$/, ''))
  }
  return rows
}

// ---- colors -----------------------------------------------------------------------------------

type Ink = { text: number; label: number; faint: number; line: number; accent: number; hot: number; red: number; mem: number; memHot: number }

const hex = (v: string | undefined, or: number): number => (v !== undefined && /^#[0-9a-f]{6}$/i.test(v) ? parseInt(v.slice(1), 16) : or)

/** The words take the terminal's own color; the rest is the drawing's palette, a touch brighter where a terminal's ground is darker. */
function inkOf(setup: Setup): Ink {
  const own = setup.colors
  const light = setup.theme === 'light'
  return {
    text: hex(own.bone, DEFAULT),
    label: hex(own.ash, light ? 0x5f6570 : 0x9ba1ab),
    faint: hex(own.dim, light ? 0x8b909a : 0x6b7280),
    line: hex(own.line, light ? 0xcfc9bc : 0x474d59),
    accent: hex(own.accent, light ? 0xb8762a : 0xe1ac6e),
    hot: hex(own.hot, light ? 0x8f560f : 0xf5c98f),
    red: hex(own.red, light ? 0xc5402b : 0xe8654f),
    mem: hex(own.mem, light ? 0x1c8c81 : 0x62c7ba),
    memHot: hex(own.memHot, light ? 0x136a62 : 0xa5e6dc),
  }
}

function mix(a: number, b: number, t: number): number {
  if (a === DEFAULT || b === DEFAULT) return t < 0.5 ? a : b
  const part = (shift: number): number => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t)
  return (part(16) << 16) | (part(8) << 8) | part(0)
}

// ---- the map ----------------------------------------------------------------------------------

const PULSE_MS = 800
const GLOW_MS = 3200
const ALARM_MS = 6000
const DONE_MS = 1100
/** How long after its last change the map still moves: the longest of the fades above, and a frame more. */
export const SETTLE_MS = ALARM_MS + 300

/** A node is eight dots by eight: four cells wide and two rows tall, a ring with its middle empty, marked or full. */
const NODE = ['..XXXX..', '.X....X.', 'X......X', 'X......X', 'X......X', 'X......X', '.X....X.', '..XXXX..']
const NODE_USED = ['..XXXX..', '.X....X.', 'X......X', 'X..XX..X', 'X..XX..X', 'X......X', '.X....X.', '..XXXX..']
const NODE_FULL = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..']

function node(c: Canvas, x: number, y: number, shape: readonly string[], color: number): void {
  shape.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) if (row[dx] === 'X') dot(c, x - 4 + dx, y - 4 + dy, color)
  })
}

const isBad = (e: Entry): boolean => e.status === 'block' || e.status === 'err'

/** Whether anything on the map is still moving at `now`: a call running, or a pulse, a glow or an alarm not yet faded. */
export function isLively(board: Board, now: number): boolean {
  return board.entries.slice(-40).some(e => e.status === 'run' || now - (e.endedAt ?? e.startedAt) < SETTLE_MS)
}

/** The map at `now`, on `columns` by `rows` cells: the stations in a ring around the agent, a spoke to each, pulses on the spokes. */
export function paint(board: Board, now: number, setup: Setup, columns: number, rows: number): Canvas {
  const c = canvas(columns, rows)
  const ink = inkOf(setup)
  const names = setup.t.stations
  const n = STATIONS.length
  const W = columns * 2
  const H = rows * 4
  const mid = Math.floor(rows / 2)
  // The middle sits on the join of two cells and in the middle of a row, so the three rows of words are centred in the core.
  const cx = 2 * Math.round(columns / 2)
  const cy = mid * 4 + 2
  const coreRx = 18
  const coreRy = 9
  // A name sits over or under its node, centred: the ring leaves half the longest name at each side, and a row at top and bottom.
  const longest = Math.max(...STATIONS.map(s => names[s.id].length)) + 4
  const ry = Math.min(cy, H - cy) - 8
  const rx = Math.max(coreRx + 12, Math.min(W / 2 - longest - 1, Math.round(ry * 1.6)))
  const shift = setup.layout === 'you-bottom' ? n / 2 : 0
  const recent = board.entries.slice(-40)

  const places = STATIONS.map((s, i) => {
    const a = ((i + shift) * 2 * Math.PI) / n
    // Snapped to whole cells, so every node is the same clean shape.
    const x = 2 * Math.round((cx + rx * Math.sin(a)) / 2)
    const y = 4 * Math.round((cy - ry * Math.cos(a)) / 4)
    const dx = x - cx
    const dy = y - cy
    const length = Math.hypot(dx, dy) || 1
    // A spoke runs from just outside the core to just outside the node.
    const from = 1 / Math.sqrt((dx / (coreRx + 3)) ** 2 + (dy / (coreRy + 3)) ** 2)
    const to = 1 - 6 / length
    const along = (f: number): { x: number; y: number } => ({ x: cx + dx * (from + (to - from) * f), y: cy + dy * (from + (to - from) * f) })
    return { s, x, y, isUpper: Math.cos(a) > 0, along, hasSpoke: to > from, px: -dy / length, py: dx / length }
  })
  const placeOf = (id: Entry['station']): (typeof places)[number] | undefined => places.find(p => p.s.id === id)

  // The answer leaves the core as one widening ring.
  const done = recent.filter(e => e.mark === 'done').pop()
  if (done !== undefined && now - done.startedAt < DONE_MS) {
    const t = (now - done.startedAt) / DONE_MS
    oval(c, cx, cy, coreRx + 3 + t * 16, coreRy + 3 + t * 9, () => mix(ink.label, ink.line, t), 2)
  }

  // Spokes first, then what flies along them, then the nodes and the words on top.
  const state = places.map(p => {
    const count = board.counts[p.s.id] ?? 0
    const own = recent.filter(e => e.station === p.s.id)
    const running = own.filter(e => e.status === 'run')
    const latest = own[own.length - 1]
    const since = latest === undefined ? Infinity : now - (latest.endedAt ?? latest.startedAt)
    const alarm = own.filter(isBad).pop()
    const isAlarm = alarm !== undefined && now - (alarm.endedAt ?? alarm.startedAt) < ALARM_MS
    const isLit = running.length > 0 || since < GLOW_MS
    const [main, hot] = p.s.id === 'memory' ? [ink.mem, ink.memHot] : [ink.accent, ink.hot]
    // A spoke wears in with use: by the end of a session the map shows where the work went.
    const worn = Math.min(1, Math.log2(1 + count) / 7)
    return { count, running, isAlarm, isLit, main, hot, worn }
  })

  places.forEach((p, i) => {
    const st = state[i]
    if (st === undefined || !p.hasSpoke) return
    const color = st.isAlarm ? ink.red : st.running.length > 0 ? st.hot : st.count > 0 ? mix(ink.line, st.main, 0.3 + 0.7 * st.worn) : ink.line
    const a = p.along(0)
    const b = p.along(1)
    line(c, a.x, a.y, b.x, b.y, color)
    if (st.worn > 0.45) line(c, a.x + p.px, a.y + p.py, b.x + p.px, b.y + p.py, color)
  })

  /** A pulse: a short bright stroke on the spoke, its head `f` of the way along and a tail behind it. */
  const pulse = (p: (typeof places)[number], f: number, outward: boolean, color: number): void => {
    if (!p.hasSpoke) return
    for (let k = 0; k < 5; k++) {
      const at = outward ? f - k * 0.045 : f + k * 0.045
      if (at < 0 || at > 1) continue
      const q = p.along(at)
      dot(c, q.x, q.y, color)
      if (k < 2) {
        dot(c, q.x + p.px, q.y + p.py, color)
        dot(c, q.x - p.px, q.y - p.py, color)
      }
    }
  }
  for (const e of recent.filter(x => x.endedAt !== undefined && x.from !== 'inbound' && now - x.endedAt < PULSE_MS).slice(-14)) {
    const p = placeOf(e.station)
    if (p !== undefined) pulse(p, 1 - (now - (e.endedAt ?? now)) / PULSE_MS, false, e.status === 'ok' ? ink.label : ink.red)
  }
  for (const e of recent.filter(x => now - x.startedAt < PULSE_MS).slice(-14)) {
    const p = placeOf(e.station)
    if (p === undefined) continue
    const f = (now - e.startedAt) / PULSE_MS
    const color = e.status === 'block' ? ink.red : e.station === 'memory' ? ink.memHot : ink.hot
    // A signal nobody asked for comes in from its station; everything else goes out from the core.
    if (e.from === 'inbound') pulse(p, 1 - f, false, color)
    else pulse(p, f, true, color)
  }

  // The context window as the core's own outline: it fills clockwise from the top as the session goes.
  const full = board.context === undefined ? undefined : Math.max(0, Math.min(100, Math.round(board.context)))
  const fullColor = full === undefined ? ink.line : full >= 90 ? ink.red : full >= 70 ? ink.accent : ink.label
  const anyRunning = recent.some(e => e.status === 'run')
  oval(c, cx, cy, coreRx, coreRy, round => (full !== undefined && round * 100 < full ? fullColor : anyRunning ? mix(ink.line, ink.accent, 0.6) : ink.line))

  places.forEach((p, i) => {
    const st = state[i]
    if (st === undefined) return
    const color = st.isAlarm ? ink.red : st.isLit ? st.hot : st.count > 0 ? mix(ink.line, st.main, 0.75) : ink.line
    node(c, p.x, p.y, st.running.length > 0 ? NODE_FULL : st.count > 0 ? NODE_USED : NODE, color)
    // A node at work beats: every other moment it wears a second ring.
    if (st.running.length > 0 && Math.floor(now / 400) % 2 === 0) oval(c, p.x - 0.5, p.y - 0.5, 6, 6, () => color, 2)
  })

  // Each subagent still at work circles the agents station.
  const agents = placeOf('agents')
  const crew = (board.agents ?? []).slice(0, 6)
  if (agents !== undefined) {
    crew.forEach((_, k) => {
      const a = ((now % 7000) / 7000 + k / crew.length) * 2 * Math.PI
      dot(c, agents.x - 0.5 + 7 * Math.sin(a), agents.y - 0.5 - 7 * Math.cos(a), ink.hot)
      dot(c, agents.x - 0.5 + 7 * Math.sin(a + 0.16), agents.y - 0.5 - 7 * Math.cos(a + 0.16), ink.hot)
    })
  }

  // The words last, over the dots.
  const centred = (text: string, row: number, color: number, at = cx / 2): void => write(c, Math.round(at - text.length / 2), row, text, color)
  if (full !== undefined) centred(`${full}%`, mid - 1, full >= 70 ? fullColor : ink.faint)
  centred(setup.core, mid, ink.text)
  if (board.model !== undefined) {
    const isSwitching = board.switchedAt !== undefined && now - board.switchedAt >= 0 && now - board.switchedAt < 8000
    centred(shortModel(board.model).slice(0, 14), mid + 1, isSwitching ? ink.hot : ink.label)
  }

  places.forEach((p, i) => {
    const st = state[i]
    if (st === undefined) return
    const faults = board.faults?.[p.s.id] ?? 0
    const name = `${names[p.s.id]}${st.count > 0 ? ` ${st.count}` : ''}`
    const many = st.running.length > 1 ? ` x${st.running.length}` : ''
    const wrong = faults > 0 ? ` !${faults > 99 ? '99+' : faults}` : ''
    const width = name.length + many.length + wrong.length
    // Over the node in the upper half and under it in the lower, so that no spoke runs through a name.
    const row = p.isUpper ? p.y / 4 - 2 : p.y / 4 + 1
    const col = Math.max(0, Math.min(columns - width, Math.round(p.x / 2 - width / 2)))
    write(c, col, row, name, st.isAlarm ? ink.red : st.isLit ? ink.text : st.count > 0 ? ink.label : ink.faint)
    write(c, col + name.length, row, many, st.hot)
    write(c, col + name.length + many.length, row, wrong, ink.red)
  })

  return c
}

/** The map as a Raster's `cells`. */
export function drawTermMap(board: Board, now: number, setup: Setup, columns: number, rows: number): string {
  return pack(paint(board, now, setup, columns, rows))
}
