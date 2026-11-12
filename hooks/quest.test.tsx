import { expect, test } from 'claude-code/testing'

import type { Board, Entry } from '../types'
import { MAX_HP, actOf, deed, freshHero, heroFrom, keep, levelOf, mission, paintQuest, progress, questCells, questSize, questSvg, sceneOf, sheet, titleOf, victory, wordsFor } from './quest'

const PANE = {
  plugin: 'lot-quest',
  component: 'Pane',
  requestId: 'lot-quest',
  props: { title: 'Quest', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const w = wordsFor('en')
const NOW = 1_000_000
const entry = (station: Entry['station'], status: Entry['status'], extra: Partial<Entry> = {}): Entry => ({
  id: station,
  station,
  label: 'name',
  from: 'core',
  startedAt: NOW - 500,
  status,
  ...(status === 'run' ? {} : { endedAt: NOW - 300 }),
  ...extra,
})

test('the hero earns by what the call was, is hurt by an error and gets up at the next quest', () => {
  let hero = freshHero()
  hero = deed(hero, 'explore', 'b/content.py', 'ok', false, NOW, w)
  hero = deed(hero, 'forge', 'b/content.py', 'ok', false, NOW, w)
  hero = deed(hero, 'fight', 'Run the tests', 'ok', false, NOW, w)
  expect([hero.xp, hero.chests, hero.forged, hero.kills]).toEqual([11, 1, 1, 1])
  expect(hero.log.map(line => line.text)).toEqual(['Chest opened: b/content.py  +2 XP', 'Forged: b/content.py  +4 XP', 'Monster beaten: Run the tests  +5 XP'])

  // A companion's call is a point for the party and no line of the diary; its failure is not the hero's wound.
  hero = deed(hero, 'fight', 'x', 'ok', true, NOW, w)
  hero = deed(hero, 'fight', 'x', 'err', true, NOW, w)
  expect([hero.xp, hero.hp, hero.log.length]).toEqual([12, MAX_HP, 3])

  // A refusal is a locked door and costs nothing.
  hero = deed(hero, 'fight', 'Bash', 'block', false, NOW, w)
  expect(hero.hp).toBe(MAX_HP)
  expect(hero.log.at(-1)?.text).toBe('A locked door: Bash')

  for (let k = 0; k < MAX_HP + 2; k++) hero = deed(hero, 'fight', 'x', 'err', false, NOW, w)
  expect([hero.hp, hero.falls]).toEqual([0, 1])
  expect(hero.log.some(line => line.text === w.fell)).toBe(true)
  hero = mission(hero, NOW, w)
  expect(hero.hp).toBe(MAX_HP)
  expect(hero.log.at(-1)?.text).toBe(w.revived)
  expect(hero.log.length).toBeLessThanOrEqual(30)
})

test('a level takes more than the last, the title follows, and a boss leaves gold, loot and a heart', () => {
  expect([levelOf(0), levelOf(39), levelOf(40), levelOf(159), levelOf(160)]).toEqual([1, 1, 2, 2, 3])
  expect(progress(67)).toEqual({ level: 2, into: 27, span: 120 })
  expect([titleOf(1, w), titleOf(3, w), titleOf(7, w), titleOf(40, w)]).toEqual(['Apprentice', 'Adventurer', 'Knight', 'Legend'])

  const won = victory({ ...freshHero(), xp: 30, hp: 3 }, false, NOW, w)
  expect([won.xp, won.bosses, won.hp, won.gold]).toEqual([50, 1, 4, 6])
  expect(Object.values(won.loot)).toEqual([1])
  expect(w.items).toContain(Object.keys(won.loot)[0])
  expect(won.log.map(line => line.text)).toContain('LEVEL UP! Lv 2, Apprentice')

  const left = victory(freshHero(), true, NOW, w)
  expect([left.xp, left.bosses]).toEqual([0, 0])
  expect(left.log.at(-1)?.text).toBe(w.retreat)
})

test('what the store gives back is read with care, and the diary is never kept', () => {
  expect(heroFrom(undefined)).toBeUndefined()
  expect(heroFrom('hero')).toBeUndefined()
  expect(heroFrom({ gold: 3 })).toBeUndefined()
  expect(heroFrom({ xp: 500.7, gold: -1, hp: 99, loot: { Sword: 2, Bad: 'x' }, log: [{ text: 'old' }] })).toEqual({ ...freshHero(), xp: 500, hp: MAX_HP, loot: { Sword: 2 } })
  expect('log' in keep(deed(freshHero(), 'fight', 'x', 'ok', false, NOW, w))).toBe(false)
})

test('the scene follows the newest call of the main loop, then the walk, then the fire', () => {
  const board = (entries: Entry[]): Board => ({ entries, counts: {} })
  expect(sceneOf(board([]), NOW).kind).toBe('camp')
  expect(sceneOf(board([entry('model', 'run')]), NOW).kind).toBe('walk')
  expect(sceneOf(board([entry('files', 'run')]), NOW)).toEqual({ kind: 'explore', phase: 'run', age: 500, label: 'name' })
  expect(sceneOf(board([entry('files', 'run', { forge: true })]), NOW).kind).toBe('forge')
  expect(sceneOf(board([entry('shell', 'ok')]), NOW)).toEqual({ kind: 'fight', phase: 'won', age: 300, label: 'name' })
  expect(sceneOf(board([entry('shell', 'err')]), NOW)).toEqual({ kind: 'fight', phase: 'hit', age: 300, label: 'name' })
  expect(sceneOf(board([entry('shell', 'block')]), NOW).kind).toBe('door')
  // A companion's call is not the hero's scene, and a call long over is not either.
  expect(sceneOf(board([entry('shell', 'run', { from: 'agents' })]), NOW).kind).toBe('walk')
  expect(sceneOf(board([entry('shell', 'ok')]), NOW + 5000).kind).toBe('camp')
  expect(sceneOf(board([entry('you', 'ok', { mark: 'done', startedAt: NOW - 600 })]), NOW).kind).toBe('trophy')
  expect([actOf('web'), actOf('browser'), actOf('memory'), actOf('agents'), actOf('skills'), actOf('model'), actOf('you')]).toEqual(['raven', 'raven', 'tome', 'ally', 'scroll', undefined, undefined])
})

test('the scene packs as cells for a terminal and as a drawing elsewhere, and the sheet says who and what', () => {
  const board: Board = { entries: [entry('shell', 'run')], counts: {}, agents: ['a'], context: 44 }
  const picture = paintQuest(board, NOW, 60, 24)
  // Sixteen characters of base64 a cell, two pixels to a cell.
  expect(questCells(picture).length).toBe(60 * 12 * 16)
  const svg = questSvg(picture)
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 24"')).toBe(true)
  expect(svg.length).toBeLessThan(131_072)
  expect(svg).not.toContain('NaN')
  // The slime is there while the fight runs and gone when the hero rests.
  expect(svg).toContain('#58c26a')
  expect(questSvg(paintQuest({ entries: [], counts: {} }, NOW, 60, 24))).not.toContain('#58c26a')

  expect(sheet({ ...freshHero(), xp: 67, gold: 7, hp: 3 }, board, NOW, w)).toEqual({
    who: 'Lv 2 Apprentice   ♥♥♥♡♡   7 gold',
    bars: 'XP ██░░░░░░░░ 27/120   Stamina ██████░░░░ 56%',
    doing: 'In combat: name',
  })
  expect(questSize(85, 50)).toEqual({ columns: 64, rows: 12 })
  expect(questSize(35, 50)).toBeUndefined()
  expect(questSize(60, 19)).toBeUndefined()
})

test('the pane shows the scene and the sheet on every surface, and each call writes the diary', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  await $.tool.call({ tool: 'Edit', file_path: '/a/b/content.py', old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'terminal') {
      const raster = await ui.find({ type: 'Raster' })
      expect([raster?.props.columns, raster?.props.rows]).toEqual([60, 12])
      expect(String(raster?.props.cells).length).toBe(60 * 12 * 16)
    } else {
      expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('<rect')
    }
    expect((await ui.find({ type: 'Text', text: /^Lv 1 Apprentice/ }))?.text).toContain('♥♥♥♥♥')
    // The diary's lines carry what was earned; the line of what the hero is at carries the name alone.
    expect((await ui.find({ type: 'Text', text: /Chest opened: b\/content\.py {2}\+2 XP/ }))?.text).toBe('Chest opened: b/content.py  +2 XP')
    expect((await ui.find({ type: 'Text', text: /Forged: b\/content\.py {2}\+4 XP/ }))?.text).toBe('Forged: b/content.py  +4 XP')
    expect((await ui.find({ type: 'Text', text: /^Forged: b\/content\.py$/ }))?.props.color).toBe('claude')
    await ui.unmount()
  }
})

test('a pane too small for the scene keeps the sheet and the diary', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 30 }, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Lv 1 Apprentice/ }))?.text).toContain('0 gold')
  expect((await ui.find({ type: 'Text', text: /diary/ }))?.text).toBe(w.nothingYet)
  await ui.unmount()
})

test('a failed call costs a heart and breaks no tool', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ result: {}, isError: true }) as never)
  const ran = await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build' })
  expect((ran as { isError?: boolean }).isError).toBe(true)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Lv 1 Apprentice/ }))?.text).toContain('♥♥♥♥♡')
  expect((await ui.find({ type: 'Text', text: /Took a blow!: Build/ }))?.text).toBe('Took a blow!: Build')
  await ui.unmount()
})

test('the hero of the folder comes back from the store, and what they earn is kept there without the diary', async ($, on) => {
  const saved: string[] = []
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'lot-quest' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: JSON.stringify(e).includes('hero:/work') ? { xp: 500, gold: 9, hp: 3 } : undefined }) as never)
  on('store.set', (_, e) => {
    saved.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const who = (await ui.find({ type: 'Text', text: /^Lv 4 Adventurer/ }))?.text
  expect(who).toContain('♥♥♥♡♡')
  expect(who).toContain('9 gold')
  await ui.unmount()

  const kept = saved.filter(row => row.includes('hero:/work')).pop() ?? ''
  expect(kept).toContain('"xp":505')
  expect(kept).toContain('"kills":1')
  expect(kept).not.toContain('"log"')
})

test('the quest speaks Portuguese when the map does', { options: { language: 'pt' } }, async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Compilar' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Nv 1 Aprendiz/ }))?.text).toContain('0 ouro')
  expect((await ui.find({ type: 'Text', text: /Monstro derrotado: Compilar {2}\+5 XP/ }))?.text).toBe('Monstro derrotado: Compilar  +5 XP')
  await ui.unmount()
})
