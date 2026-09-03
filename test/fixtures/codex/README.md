# vibetax codex fixtures

Anonymized, trimmed excerpts of REAL Codex CLI session logs from this machine, for
testing a parser against `--codex-dir test/fixtures/codex`. Nothing here was
invented — every line is a real record with only the whitelisted fields kept
and identifiers replaced by deterministic fakes (same real id -> same fake id
everywhere). `expected.json` is ground truth computed by hand with jq
straight from these fixture files (the parser doesn't exist yet).

## Files and what each exercises

- **A** `sessions/2026/08/21/rollout-...-<fakeA>.jsonl` + **A2**
  `sessions/2026/08/22/rollout-...-<fakeA>_<fakeOther>.jsonl` -- a real
  continuation pair (same `session_meta.payload.id`, A2's history NOT
  replayed, A2's `total_token_usage` restarts from 0). A mixes two models
  (gpt-5.6-terra then gpt-5.6-sol) across its `turn_context` lines. A ends
  with a naturally occurring repeated `token_count` (two consecutive events
  with identical `total_token_usage` -- not synthesized). A also contains one
  `token_count` with `info: null` -- **synthesized**: no real null-info event
  fell inside the kept range, so we cloned a real token_count line and set
  `info` to `null` (per the brief's instruction to do so if none exists).
  Two intentionally broken lines are spliced into the middle of A: a
  truncated JSON object and a bare `garbage line` -- a parser must skip both
  and keep going.
  - **Gap vs. the brief**: none of the 3 real continuation pairs on this
    machine have `exec_command`, `apply_patch`, or any `patch_apply_end` in
    their base file (checked all 3: 0/0/0). A/A2's tool calls are all
    `custom_tool_call` named `exec`; their own `files_touched` stays `{}`.
    Pair 1 (2026-08-21/22) was picked as "best" since all 3 pairs tie 2/5 on
    the stated criteria and pair 1 is smallest/easiest to hand-verify while
    mixing 2 models. File F below covers the missing tool-call/patch
    coverage from a different real session.
  - Both A and A2 have a real mid-file counter reset (a new task restarts
    `total_token_usage` from near-zero). To keep "last total = sum of
    deltas" clean, each file keeps only one contiguous monotonic run of
    `token_count` events (A: real events 11-33 of 33; A2: 1-14 of 42), not
    the whole file -- a real quirk a production parser will need to handle.
- **B** `sessions/2026/08/31/rollout-...-<fakeB>.jsonl` -- a subagent thread
  (`thread_source: "subagent"`, `source.subagent.thread_spawn` shape, model
  gpt-5.6-luna). `parent_thread_id` rewritten to A's fake id so B attaches to
  A. Kept whole (40 lines).
- **C** `sessions/2026/08/27/rollout-...-<fakeC>.jsonl` -- a `guardian_review`
  thread, model `codex-auto-review`, `source: {"subagent":{"other":"guardian"}}`
  (the non-`thread_spawn` subagent shape). Kept whole (36 lines).
- **D** `sessions/2026/04/14/rollout-...-<fakeD>.jsonl` -- the old-CLI format
  (cli_version 0.98.0): no `token_count` events at all, `turn_id: null` on
  every `turn_context`, `source: "exec"` (string), no `thread_source` key.
  Kept whole (13 lines).
- **E** `archived_sessions/rollout-...-<fakeE>.jsonl` -- a short user thread
  under `archived_sessions/`, model gpt-5.5 (different from A's gpt-5.6-sol).
  Contains 2 `session_meta` lines with the identical id (a real resume).
  Kept whole (23 lines).
- **F** `sessions/2026/07/23/rollout-...-<fakeF>.jsonl` -- the "most touched
  file" case: `thread_source: "user"`, all 5 real `patch_apply_end` events
  kept, where fake path `src/api/handlers.ts` repeats 3x (the other two
  appear once each) -- a clear `files_touched` winner. Also carries all 5
  real `apply_patch` `custom_tool_call`s, both real `exec_command`
  `function_call`s, 8 monotonic non-null `token_count` events, and all 5
  `turn_context` lines (model gpt-5.6-sol). Trimmed 186 -> 57 lines.
- **config.toml** -- `model = "gpt-5.6-sol"` / `model_reasoning_effort =
  "medium"`, matching the real Codex config on this machine.

Date range covered: 2026-04-14 through 2026-08-31. A test suite should pass
an explicit period, e.g. `--period 2026-04-01..2026-09-01`.

## Whitelist (anonymization)

Every record keeps only `timestamp` + `type` at the top level, then a
type-specific payload subset (see the generator script for exact field
lists): `session_meta` keeps id/timestamp/cwd/cli_version/originator/
model_provider/context_window/thread_source/source; `turn_context` keeps
model/cwd/turn_id/effort; `token_count` keeps `info` verbatim minus
`rate_limits`; other `event_msg` types collapse to `{type}` except
`patch_apply_end` (keeps call_id/success/changes); `response_item`
message/reasoning/function_call/custom_tool_call/*_output get their content
redacted to literal `"<redacted>"`; everything else collapses to `{type}`.
`compacted`, `world_state`, `inter_agent_communication_metadata` always
collapse to `payload: {}`.

**Deviation from the brief**: it describes `context_window` as a plain
number; on every real session_meta here it's actually `null` or
`{"window_id": "<uuid>"}`. Kept the real shape (faking window_id like any
other id) since fidelity to real data wins.

`cwd` is replaced wholesale with `/Users/dev/work/gamma` (A/A2/B/C/D/F) or
`/Users/dev/work/delta` (E). Message content is capped at 5 blocks (one real
message has 84, which would blow the 3000-char/line budget once redacted).

Fake ids are deterministic (sha256 of the real id, formatted as a
uuid7-shaped string starting `01a0...`) so the same real id always maps to
the same fake id -- that's how B's `parent_thread_id` points at A's fake id.
`call_id` -> `call_<n>`, `turn_id` -> `turn_<n>`, sequential + deterministic.

## The delta rule

A `token_count` event carries cumulative `total_token_usage`. A file's usage
= the last kept event's `total_token_usage` with non-null `info`
(equivalently sum of consecutive deltas). Session usage = sum over its
files. `input_noncached = input_total - cached`. Per-model usage attributes
each delta to the model of the most recent preceding `turn_context` in the
same file (falls back to `default_model` if none precede -- doesn't happen
here). Broken lines and `info: null` events are ignored (don't count toward
`token_count_events`, don't reset the delta baseline).

## jq used to compute expected.json

Per fixture file, each line first passes through `jq -R 'fromjson?'` to
parse-or-skip (this is exactly how broken lines get ignored), then the
result is slurped (`jq -s`) into an array and folded with a single `reduce`
that tracks: running `prevTotal` (for deltas), the `model` from the most
recent `turn_context`, per-model delta sums, the count and last value of
non-null `token_count` events, `tool_calls` by `name` (function_call +
custom_tool_call), `files_touched` (patch_apply_end.changes keys), and
min/max `timestamp` (full reduce program: `per-file-summary.jq`), run as:

```sh
jq -R 'fromjson?' <file>.jsonl | jq -s -f per-file-summary.jq > <file>.summary.json
```

The 7 per-file summaries are then tagged with their fixture-relative path,
slurped together, `group_by(.session_id)` (this is how A + A2 merge into one
session and B/C/D/E/F stay standalone), and folded into the final
`{default_model, sessions, all}` shape by `combine.jq` -- session `usage` is
the per-file `last_total` summed across a session's files, `per_model` sums
each file's per-model deltas across files, `tool_calls`/`files_touched` sum
per-key across files, `first_ts`/`last_ts` are the min/max across files.
Both jq programs and the fixture generator (`make-codex-fixtures.mjs`) were
one-off scratchpad scripts, not part of this repo.
