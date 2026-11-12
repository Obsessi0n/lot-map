export type StationId =
  | 'you' | 'model' | 'memory' | 'files' | 'shell'
  | 'web' | 'browser' | 'agents' | 'skills' | 'hooks'

export type Status = 'run' | 'ok' | 'err' | 'block'

/** One action on the map. Labels carry names and record numbers, never the text of a memory. */
export type Entry = {
  id: string
  station: StationId
  label: string
  /** Where the pulse starts: the core, the agents station, or the station itself (a signal coming in). */
  from: 'core' | 'agents' | 'inbound'
  startedAt: number
  endedAt?: number
  status: Status
  /** The subagent whose loop made the call; absent for the main loop. */
  agentId?: string
  /** The background task the call started; the row stays open until that task reports back. */
  task?: string
  /** A moment the map marks: the model changed, or the answer is ready. */
  mark?: 'switch' | 'done'
  /** The call writes a file rather than reads one: in the quest the hero forges instead of opening a chest. */
  forge?: true
}

/** A line of the hero's diary. It holds names, as a row of the map does, never content. */
export type HeroLine = { at: number; text: string; tone: 'good' | 'bad' | 'gold' | 'plain' }

/** The hero of the quest. All but the diary is kept between sessions, one hero to a folder. */
export type Hero = {
  xp: number
  gold: number
  hp: number
  kills: number
  chests: number
  forged: number
  bosses: number
  falls: number
  loot: Record<string, number>
  log: HeroLine[]
}

export type Board = {
  entries: Entry[]
  counts: Partial<Record<StationId, number>>
  model?: string
  step?: number
  /** How many of the memory station's count a hook brought unasked. */
  pushed?: number
  /** Errors and refusals per station since the person's last message. */
  faults?: Partial<Record<StationId, number>>
  /** Subagents whose loops are still going. */
  agents?: string[]
  /** How full the context window is, 0 to 100. */
  context?: number
  /** When the model last changed. */
  switchedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'lot-quest': { board: Shaped<Board>; hero: Shaped<Hero> }
  }
}
