export type Agent = "claude-code" | "codex";

/** Token counts for one API call. Codex has no cache writes; both cacheWrite fields are 0 there. */
export type Usage = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

/** files: paths the call touched (Edit/Write/Read file_path, or every path in a Codex apply_patch). */
export type ToolCall = { name: string; files: string[] };

/** One API call. Cost is not here: metrics apply the price list. */
export type Turn = {
  at: Date;
  model: string;
  usage: Usage;
  toolCalls: ToolCall[];
};

export type Session = {
  agent: Agent;
  id: string;
  project: string; // basename(cwd), full path is never stored
  startedAt: Date; // first turn
  endedAt: Date; // last turn
  turns: Turn[];
  /** Automated thread (e.g. Codex guardian review): counted in cost, not in the session count. */
  background?: boolean;
};

/** Half-open range: from <= at < to. */
export type Period = { from: Date; to: Date };

/** files = log files found on disk (before the mtime skip), so the CLI can tell "no logs" from "nothing in this period". */
export type ScanResult = { sessions: Session[]; warnings: string[]; files: number };

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
