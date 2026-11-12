import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Entry, Hero, StationId, Status } from '../types'
import { STATIONS, classify, clean, describeNow, drawMap, firstLine, foldRows, formatMs, memoryIds, setupFrom, shortModel, taskNotice, taskOf } from './map'
import type { Setup } from './map'
import { actOf, deed, freshHero, heroFrom, keep, mission, paintQuest, questCells, questSize, questSvg, rested, sheet, victory, wordsFor } from './quest'
import { SETTLE_MS, drawTermMap, isLively, termSize } from './term'
import type { TermSize } from './term'

const PANE = 'lot-quest'
/** The terminal's map: its key in the pane's drawing, and how often it is repainted while something on it moves. */
const RASTER = 'map'
const FRAME_MS = 125
const KEEP = 80
const CREW = 12

// Change the tag when a field of Entry or Board changes: it declines what an earlier version stored.
const board = atom({ plugin: 'lot-quest', key: 'board' } as const, { entries: [], counts: {} } as Board, { shape: 'board-3' })

// The hero of the quest, as the session has them. What lasts is copied to the store whenever it changes.
const hero = atom({ plugin: 'lot-quest', key: 'hero' } as const, freshHero(), { shape: 'hero-1' })

const newId = (now: number): string => `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Whatever goes wrong on the map must never reach the tool, the turn or the conversation. */
async function quietly<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

type Start = {
  station: StationId
  label: string
  from?: Entry['from']
  status?: Status
  agentId?: string
  mark?: Entry['mark']
  forge?: true
  /** Adds nothing to the station's count: a second view of something already counted. */
  uncounted?: boolean
  startedAt?: number
  endedAt?: number
  patch?: Partial<Pick<Board, 'model' | 'step' | 'switchedAt'>>
}

/** The newest rows, and beside them every background task still going, however long ago it started. */
const kept = (entries: Entry[]): Entry[] => {
  const from = entries.length - KEEP
  return from <= 0 ? entries : entries.filter((e, i) => i >= from || (e.status === 'run' && e.task !== undefined))
}

const isFault = (status: Status): boolean => status === 'err' || status === 'block'

const oneMore = (faults: Board['faults'], station: StationId): Board['faults'] => ({ ...faults, [station]: (faults?.[station] ?? 0) + 1 })

async function begin($: EngineInterface, start: Start): Promise<string | undefined> {
  return quietly(async () => {
    const now = await $.clock.now()
    const entry: Entry = {
      id: newId(now),
      station: start.station,
      label: clean(start.label),
      from: start.from ?? 'core',
      startedAt: start.startedAt ?? now,
      status: start.status ?? 'run',
      ...(start.status !== undefined ? { endedAt: start.endedAt ?? now } : {}),
      ...(start.agentId !== undefined ? { agentId: start.agentId } : {}),
      ...(start.mark !== undefined ? { mark: start.mark } : {}),
      ...(start.forge === true ? { forge: true as const } : {}),
    }
    await update($, board, b => ({
      ...b,
      ...start.patch,
      entries: kept([...b.entries, entry]),
      counts: start.uncounted ? b.counts : { ...b.counts, [entry.station]: (b.counts[entry.station] ?? 0) + 1 },
      // What a hook brought to memory unasked is counted apart from what was asked for.
      ...(entry.station === 'memory' && entry.from === 'inbound' && !start.uncounted ? { pushed: (b.pushed ?? 0) + 1 } : {}),
      // An interrupted turn lands on the person's own station and is no fault of anything.
      ...(isFault(entry.status) && entry.station !== 'you' ? { faults: oneMore(b.faults, entry.station) } : {}),
      ...(entry.agentId !== undefined && !(b.agents ?? []).includes(entry.agentId)
        ? { agents: [...(b.agents ?? []), entry.agentId].slice(-CREW) }
        : {}),
    }))
    return entry.id
  })
}

async function finish($: EngineInterface, id: string | undefined, status: Status, patch?: Pick<Board, 'context'>): Promise<void> {
  if (id === undefined) return
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.id === id && e.status === 'run')
      return {
        ...b,
        ...patch,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now } : e)),
        ...(open !== undefined && isFault(status) ? { faults: oneMore(b.faults, open.station) } : {}),
      }
    })
  })
}

/** The call started work that goes on after it answered: its row stays open under the task's id. */
async function background($: EngineInterface, id: string | undefined, task: string): Promise<void> {
  if (id === undefined) return
  await quietly(() => update($, board, b => ({ ...b, entries: b.entries.map(e => (e.id === id && e.status === 'run' ? { ...e, task } : e)) })))
}

/** A background task ended: its row closes, as a fault when the task failed. */
async function settle($: EngineInterface, task: string, status: Status): Promise<void> {
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.task === task && e.status === 'run')
      if (open === undefined) return b
      return {
        ...b,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now } : e)),
        ...(isFault(status) ? { faults: oneMore(b.faults, open.station) } : {}),
      }
    })
  })
}

/** What the terminal's map was last drawn from, and how many frames it still has to move. */
type Shown = { view: 'map' | 'quest'; size: TermSize; board: Board; at: number; frames: number; skipped: number }

/** One frame of the terminal's map between two redraws: the same board at the time it now is. False when the map is not there to repaint. */
async function animate($: EngineInterface, live: Shown, setup: Setup): Promise<boolean> {
  const now = await $.clock.now()
  // A call still running keeps the map moving; otherwise it comes to rest a few seconds after the last change.
  if (isLively(live.board, now)) live.frames = Math.max(live.frames, 2)
  // Long after the last change only a running node beats: a third of the frames is enough for that. The hero walks at every frame.
  if (live.view === 'map' && now - live.at > SETTLE_MS && live.skipped++ % 3 !== 0) return true
  const cells = live.view === 'quest' ? questCells(paintQuest(live.board, now, live.size.columns, live.size.rows * 2)) : drawTermMap(live.board, now, setup, live.size.columns, live.size.rows)
  const answer = await $.ui.blit({ requestId: PANE, key: RASTER, cells, ...live.size })
  return answer.deny === undefined
}

/** Something happened to the hero: the change is made in the session's state, and what lasts of it is kept for the next session. */
async function adventure($: EngineInterface, key: string | undefined, change: (hero: Hero, now: number) => Hero): Promise<void> {
  await quietly(async () => {
    const now = await $.clock.now()
    const last: { hero?: Hero } = {}
    await update($, hero, h => (last.hero = change(h, now)))
    if (last.hero !== undefined && key !== undefined) await $.store.set(key, keep(last.hero))
  })
}

/** How full the context window is, as the status line has it; costs nothing. */
async function contextOf($: EngineInterface): Promise<Pick<Board, 'context'>> {
  const percent = await quietly(async () => (await $.session.usage()).context.percent)
  return typeof percent === 'number' ? { context: percent } : {}
}

/** What a settings hook added to the context: shown as the hook acting and, when it brought records, as memory. */
async function noteContext($: EngineInterface, context: readonly string[] | undefined, when: string, setup: Setup): Promise<void> {
  const { t } = setup
  const text = (context ?? []).join('\n')
  if (text.trim() === '') return
  const ids = setup.hookRecords ? memoryIds(text) : []
  if (ids.length === 0) {
    await begin($, { station: 'hooks', label: t.addedContext(when), status: 'ok' })
    return
  }
  await begin($, { station: 'hooks', label: t.addedMemory(when), status: 'ok' })
  const shown = ids.slice(0, 6).map(id => `#${id}`).join(' ')
  await begin($, {
    station: 'memory',
    label: t.records(ids.length, `${shown}${ids.length > 6 ? ' …' : ''}`),
    from: 'inbound',
    status: 'ok',
  })
}

export const register: Register = (on, options) => {
  const setup = setupFrom(options)
  const { t } = setup
  // The feed's second column fits the longest station name of the language.
  const column = Math.max(8, ...Object.values(t.stations).map(name => name.length))

  // Calls a settings hook refused, so that the tool's own row reads as blocked and not as an error.
  // Loses nothing across a reload that matters: a reload never lands in the middle of a call.
  const refused = new Set<string>()

  // The model the main loop last ran on: in this session, or else in the last session in this folder.
  // The one thing the map keeps between sessions, and only its name.
  let lastModel: string | undefined
  let modelKey = 'model'

  // What the terminal's map was last drawn from. A redraw comes when the board changes; a pulse or a glow moves in
  // between, so a timer repaints the same board at the time it then is. Lost with a reload: the next redraw sets it again.
  let shown: Shown | undefined
  let timer: { cancel: () => void } | undefined

  // The quest's own words, and where this folder's hero is kept between sessions.
  const words = wordsFor(options.language)
  const isQuest = setup.view === 'quest'
  let heroKey: string | undefined

  on('session.start', async ($, e, next) => {
    await quietly(async () => {
      timer?.cancel()
      timer = $.clock.every(FRAME_MS, () => {
        const live = shown
        if (live === undefined || live.frames <= 0) return
        live.frames--
        void quietly(async () => {
          // Refused: the pane is closed or behind another one. The next redraw starts the frames again.
          if (!(await animate($, live, setup)) && shown === live) shown = undefined
        })
      })
    })
    await quietly(() => $.command.register({ name: 'lot-quest', description: isQuest ? words.command : t.command }))
    void quietly(() => $.ui.open({ id: PANE, title: isQuest ? words.pane : t.title }))
    await quietly(async () => {
      modelKey = `model:${e.cwd}`
      const kept = await $.store.get(modelKey)
      if (lastModel === undefined && typeof kept === 'string') lastModel = kept
    })
    await quietly(async () => {
      // The hero of this folder comes back as the last session left them. A reload must not undo what this session did.
      heroKey = `hero:${e.cwd}`
      const kept = heroFrom(await $.store.get(heroKey))
      if (kept !== undefined) await update($, hero, h => (h.xp === 0 && h.log.length === 0 ? kept : h))
    })
    return next(e)
  })

  on('command.run', { command: 'lot-quest' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: isQuest ? words.pane : t.title })
    return { text: opened.isPlaced ? (isQuest ? words.opened : t.opened) : t.cannotOpen(String(opened.reason)) }
  })

  on('turn.start', async ($, e, next) => {
    const notice = e.agentId === undefined ? taskNotice(e.text) : undefined
    if (notice !== undefined) {
      // A background task reporting back is no message of the person's.
      if (notice.status !== undefined) await settle($, notice.id, notice.status)
    } else if (e.agentId === undefined && e.text !== '') {
      // A new message clears what went wrong on the way to the last answer.
      await quietly(() => update($, board, b => (b.faults === undefined ? b : { ...b, faults: {} })))
      await begin($, { station: 'you', label: t.newMessage, from: 'inbound', status: 'ok' })
      await adventure($, heroKey, (h, now) => mission(h, now, words))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    if (isMain && lastModel !== e.model) {
      const before = lastModel
      lastModel = e.model
      void quietly(() => $.store.set(modelKey, e.model))
      if (before !== undefined) {
        const now = await quietly(() => $.clock.now())
        await begin($, {
          station: 'model',
          label: `${shortModel(before)} → ${shortModel(e.model)}`,
          status: 'ok',
          mark: 'switch',
          uncounted: true,
          ...(now !== undefined ? { patch: { switchedAt: now } } : {}),
        })
      }
    }
    const id = await begin($, {
      station: 'model',
      label: `${shortModel(e.model)} · ${t.step(e.index + 1)}${isMain ? '' : ` · ${t.subagent}`}`,
      from: isMain ? 'core' : 'agents',
      ...(isMain ? { patch: { model: e.model, step: e.index + 1 } } : { agentId: e.agentId }),
    })
    try {
      return yield* next(e)
    } finally {
      await finish($, id, 'ok', isMain ? await contextOf($) : undefined)
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // A subagent's loop is over: it leaves the agents station, and a call of its that never reported back is settled.
      const agentId = e.agentId
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => ({
          ...b,
          agents: (b.agents ?? []).filter(id => id !== agentId),
          entries: b.entries.map(x => (x.status === 'run' && (x.agentId === agentId || x.task === agentId) ? { ...x, status: 'ok' as const, endedAt: now } : x)),
        }))
      })
    } else {
      await begin($, {
        station: 'you',
        label: e.isAborted ? t.turnAborted : t.answerReady,
        status: e.isAborted ? 'err' : 'ok',
        ...(e.isAborted ? {} : { mark: 'done' as const }),
      })
      const isAborted = Boolean(e.isAborted)
      await adventure($, heroKey, (h, now) => victory(h, isAborted, now, words))
      // An interrupted call never reports back; left alone its row would pulse for the rest of the session.
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => ({
          ...b,
          entries: b.entries.map(x => (x.status === 'run' && x.from === 'core' && x.task === undefined ? { ...x, status: 'ok' as const, endedAt: now } : x)),
        }))
      })
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A call that writes a file is the hero at the forge; one that reads is a chest opened.
    const isForge = ['Edit', 'Write', 'NotebookEdit'].includes(String(e.tool))
    const isCompanion = e.agentId !== undefined
    const seen: { station?: StationId; label?: string } = {}
    const id = await quietly(async () => {
      const found = classify(e.tool, e as unknown as Record<string, unknown>, setup)
      seen.station = found.station
      seen.label = clean(found.label, 48)
      return begin($, { ...found, ...(isForge ? { forge: true as const } : {}), ...(e.agentId === undefined ? { from: 'core' as const } : { from: 'agents' as const, agentId: e.agentId }) })
    })
    const tell = (outcome: 'ok' | 'err' | 'block'): Promise<void> =>
      adventure($, heroKey, (h, now) => deed(h, seen.station === undefined ? undefined : actOf(seen.station, isForge), seen.label ?? '', outcome, isCompanion, now, words))
    try {
      const ran = await next(e)
      const wasRefused = ran.deny !== undefined || (e.tool_use_id !== undefined && refused.delete(e.tool_use_id))
      const task = wasRefused || ran.isError === true ? undefined : taskOf(ran.result)
      if (task !== undefined) {
        await background($, id, task)
        await tell('ok')
        return ran
      }
      await finish($, id, wasRefused ? 'block' : ran.isError === true ? 'err' : 'ok')
      await tell(wasRefused ? 'block' : ran.isError === true ? 'err' : 'ok')
      return ran
    } catch (failure) {
      await finish($, id, 'err')
      await tell('err')
      throw failure
    }
  })

  on('classic.PreToolUse', async ($, e, next) => {
    const startedAt = (await quietly(() => $.clock.now())) ?? 0
    const decided = await next(e)
    const endedAt = (await quietly(() => $.clock.now())) ?? startedAt
    if (decided.deny !== undefined) {
      if (e.tool_use_id !== undefined) refused.add(e.tool_use_id)
      await begin($, { station: 'hooks', label: (setup.hookReasons ? firstLine(decided.deny) : '') || t.stopped(e.tool), status: 'block', startedAt })
    } else if (decided.ask !== undefined) {
      await begin($, { station: 'hooks', label: t.askedPermission(e.tool), status: 'ok', startedAt, endedAt })
    } else if (endedAt - startedAt >= 400) {
      // A check that took a moment is worth seeing; the instant ones are not.
      await begin($, { station: 'hooks', label: t.checkBefore(e.tool), status: 'ok', startedAt, endedAt })
    }
    return decided
  })

  // A notification delivered into a running turn starts no turn of its own; this is where it is seen.
  on('prompt.submit', async ($, e, next) => {
    await quietly(async () => {
      if (e.origin?.kind !== 'task-notification') return
      const notice = taskNotice(e.text)
      if (notice?.status !== undefined) await settle($, notice.id, notice.status)
    })
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    await noteContext($, result.additionalContext, t.toMessage, setup)
    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await noteContext($, result.additionalContext, t.atStart, setup)
    return result
  })

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    // A skill the model called is already on the map as its tool call; this one catches a typed slash command.
    await quietly(async () => {
      const now = await $.clock.now()
      await update($, board, b => {
        if (b.entries.some(x => x.station === 'skills' && x.status === 'run' && x.label === e.skill)) return b
        const entry: Entry = { id: newId(now), station: 'skills', label: e.skill, from: 'core', startedAt: now, endedAt: now, status: 'ok' }
        return { ...b, entries: [...b.entries, entry].slice(-KEEP), counts: { ...b.counts, skills: (b.counts.skills ?? 0) + 1 } }
      })
    })
    return result
  })

  on('session.compact', async ($, e, next) => {
    const id = await begin($, { station: 'model', label: t.compacting })
    try {
      return await next(e)
    } finally {
      await finish($, id, 'ok', await contextOf($))
      await adventure($, heroKey, (h, now) => rested(h, now, words))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, board)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    if (isQuest) {
      // The quest: the scene, three lines of who the hero is and what they are at, and the diary, newest first.
      const me = await read($, hero)
      const { who, bars, doing } = sheet(me, state, now, words)
      const head = [
        <Text mono weight="bold">{who}</Text>,
        <Text mono size="footnote">{bars}</Text>,
        <Text mono size="footnote" color="claude">{doing}</Text>,
      ]
      const diary = [...me.log].reverse().map(line => (
        <Text mono size="footnote" color={line.tone === 'gold' ? 'claude' : line.tone === 'bad' ? 'error' : undefined} dimColor={line.tone === 'plain'}>
          {line.text}
        </Text>
      ))
      const lines = diary.length > 0 ? diary : [<Text dimColor>{words.nothingYet}</Text>]

      if (e.surface === 'terminal') {
        // A terminal draws no picture: the scene is a grid of cells, two square pixels to a cell.
        const size = setup.terminalMap ? questSize(e.props.bodyColumns, e.props.scroll.bodyRows) : undefined
        if (size === undefined) {
          shown = undefined
          return (
            <Box flexDirection="column">
              {head}
              {lines}
            </Box>
          )
        }
        const { Raster } = $.ui.resolve(e)
        shown = { view: 'quest', size, board: state, at: now, frames: Math.ceil(SETTLE_MS / FRAME_MS) + 2, skipped: 0 }
        const room = Math.max(3, Math.floor(e.props.scroll.bodyRows) - size.rows - 4)
        return (
          <Box flexDirection="column">
            <Raster key={RASTER} columns={size.columns} rows={size.rows} cells={questCells(paintQuest(state, now, size.columns, size.rows * 2))} />
            {head}
            {lines.slice(0, room)}
          </Box>
        )
      }

      const { Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Svg source={questSvg(paintQuest(state, now, 64, 24))} alt={`${words.pane}. ${doing}`} />
          {head}
          {lines}
        </Box>
      )
    }

    const rows = foldRows(state.entries).map(({ entry, times, tookMs }) => {
      const isSwitch = entry.mark === 'switch'
      const mark = isSwitch ? '◆' : entry.status === 'run' ? '●' : entry.status === 'ok' ? '·' : '✕'
      const took = entry.endedAt === undefined ? t.running : tookMs > 0 ? formatMs(tookMs, t) : ''
      // Theme keys, so the rows read on a light theme as well as on a dark one.
      const color = isSwitch || entry.status === 'run' ? 'claude' : entry.status === 'ok' ? undefined : 'error'
      const line = `${mark} ${t.stations[entry.station].padEnd(column)} ${entry.label}${times > 1 ? `  +${times - 1}` : ''}${took === '' ? '' : `  ${took}`}`
      return (
        <Text mono size="footnote" color={color} dimColor={entry.status === 'ok' && !isSwitch}>
          {line}
        </Text>
      )
    })
    const feed = rows.length > 0 ? rows : [<Text dimColor>{t.nothingYet}</Text>]
    const current = <Text mono size="footnote">{describeNow(state, t)}</Text>

    if (e.surface === 'terminal') {
      // A terminal draws no picture, so where the pane has the room the map is a grid of cells: dots for the lines and
      // the nodes, letters for the names. A narrow or short pane keeps the rows of text alone.
      const size = setup.terminalMap ? termSize(e.props.bodyColumns, e.props.scroll.bodyRows) : undefined
      if (size !== undefined) {
        const { Raster } = $.ui.resolve(e)
        shown = { view: 'map', size, board: state, at: now, frames: Math.ceil(SETTLE_MS / FRAME_MS) + 2, skipped: 0 }
        const room = Math.max(3, Math.floor(e.props.scroll.bodyRows) - size.rows - 2)
        return (
          <Box flexDirection="column">
            <Raster key={RASTER} columns={size.columns} rows={size.rows} cells={drawTermMap(state, now, setup, size.columns, size.rows)} />
            {current}
            {feed.slice(0, room)}
          </Box>
        )
      }
      shown = undefined
      const tally = STATIONS.filter(s => (state.counts[s.id] ?? 0) > 0).map(s => `${t.stations[s.id]} ${state.counts[s.id]}`).join(' · ')
      return (
        <Box flexDirection="column">
          {current}
          <Text dimColor>{tally === '' ? t.noCounts : tally}</Text>
          {feed}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Svg source={drawMap(state, now, setup)} alt={`${t.title}. ${describeNow(state, t)}`} />
        {current}
        {feed}
      </Box>
    )
  })
}
