# vibetax Claude Code log fixtures

Anonymized, trimmed excerpts of real Claude Code project logs from this machine, laid out like the real thing (`--claude-dir test/fixtures/claude`). All prose (`text`, `thinking`, `command`, tool-input strings, `content`) is `"<redacted>"`; only structure/numbers are real. IDs use a deterministic map (same real id -> same fake id everywhere), preserving duplicate/replay relationships between lines.

`expected.json` was computed independently with `jq`, from the files in this directory, after the fixtures were generated — not from generator bookkeeping. Tests must use an explicit period (`--period 2026-08-01..2026-08-31`), never a relative one. Date range covered: 2026-08-03 to 2026-08-25.

## Layout

- `projects/-Users-dev-work-alpha/<A-uuid>.jsonl` — session A (main)
- `projects/-Users-dev-work-alpha/<A-uuid>/subagents/agent-<hex>.jsonl` — A's subagent
- `projects/-Users-dev-work-alpha/<C-uuid>.jsonl` — session C
- `projects/-Users-dev-work-beta/<B-uuid>.jsonl` — session B
- `expected.json` — ground truth

`alpha` is the fake project for A and C; `beta` is the fake project for B.

## What each file exercises

- **A main (40 lines)**: a 4-line single message (`thinking`+`text`+2x `tool_use:Read`, `user` tool_results interleaved — one API message, several lines, same `message.id`+`requestId`), plus two more 3-line messages. `Bash`/`Read`/`Write`/`Edit` tool_use. A **verbatim-replayed tool_use line** (same fake `uuid`/`message.id`/`requestId`/`tool_use.id`/timestamp) at the end — not found naturally in any session on this machine that also has a `subagents/` dir (all 21 such sessions checked, none had a duplicate-`uuid` assistant line), so synthesized by duplicating one real anonymized `Edit` line, matching the documented real behavior; a parser must dedup by `tool_use.id`. Two **broken lines** mid-file (truncated JSON, plain non-JSON) so a parser must skip unparseable lines. Unknown types: `queue-operation`, `attachment`, `custom-title`, `atis-latch`, `last-prompt`, `system`. A multi-hour gap for `max_gap_minutes`.
- **A subagent (26 lines)**: `isSidechain: true`, `agentId` set, `sessionId` = parent's fake uuid. One 4-line message. Bash+Read tool_use. Folds into the parent session in `expected.json`.
- **B (63 lines)**: different project/day/model (`claude-opus-5`, vs A's `claude-fable-5`); 18 assistant lines (< 20 cap). Only `Bash`/`ToolSearch`, so `files_touched` is empty here on purpose. No timestamp lands in a clear late-evening/night UTC window — checked cheaply across short August sessions machine-wide first; that requirement was optional and went unmet.
- **C (51 lines)**: in the `alpha` dir alongside A. Real `model:"<synthetic>"` record ("login expired"-style: zero usage, `requestId` **absent**, message `id` not `msg_`-prefixed in source). `Bash`/`Read`/`Write` tool_use plus `ai-title`, `queue-operation`, `last-prompt`, `custom-title`, `atis-latch`, `system`.

## Whitelist transform

`assistant` top-level: `type, uuid, parentUuid, timestamp, sessionId, requestId, cwd, version, isSidechain, agentId, apiBlockIndex, gitBranch, userType, entrypoint` (only fields present in source). `gitBranch` forced `"main"`; `cwd`/`sessionId` -> fake. `message` keeps `id, model, role, type, stop_reason, usage`; `usage` keeps `input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}, output_tokens_details, server_tool_use`, drops `service_tier, speed, inference_geo, iterations`. Content blocks: `text`/`thinking` bodies and `tool_use.input` strings (other than `file_path`/`notebook_path`) -> `"<redacted>"`; numbers/booleans in `input` kept; nested objects/arrays in `input` -> `"<redacted>"`.

`user` records keep `type, uuid, parentUuid, timestamp, sessionId, cwd, version, isSidechain` + `message: {role, content}`; string content -> `"<redacted>"`; `tool_result` keeps `tool_use_id` (re-mapped), `content` redacted. Every other record type keeps only `{type, sessionId, timestamp?, uuid?}`.

IDs use per-category sha1-seeded deterministic maps: `uuid`/`parentUuid`/`agentId` -> uuid-v4-shaped; `message.id` -> `msg_`+16 base62; `requestId` -> `req_`+16 base62; `tool_use.id`/`tool_result.tool_use_id` -> `toolu_`+16 base62.

## Fake file path pool

First-seen order (A -> A's subagent -> C; B has none), onto this pool, then `src/misc/file<N><ext>` once exhausted: `src/api/router.ts, src/api/handlers.ts, src/components/Card.tsx, src/lib/parse.ts, src/lib/render.ts, README.md, package.json, test/parse.test.ts, docs/spec.md, src/index.ts`. The 11th/12th real paths (both in C) -> `src/misc/file11.md`, `src/misc/file12.md`.

## expected.json

`jq`, direct from the fixtures. Per session: `cat` its file(s), drop unparseable lines (`jq -R -c 'fromjson? // empty'`), slurp, then run this filter (`def epoch` converts an ISO timestamp to a unix epoch by stripping fractional seconds):

```jq
def epoch: sub("\\.[0-9]+Z$"; "Z") | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime;
. as $r | ($r|map(select(.type=="assistant"))) as $a | ($r|map(select(.type=="assistant" and .message.model!="<synthetic>"))) as $ra
| ($ra|group_by(.message.id+"|"+(.requestId//"null"))|map(max_by(.message.usage.output_tokens//0))) as $u
| ($a|map((.message.content//[])|map(select(.type=="tool_use")))|flatten|unique_by(.id)) as $t
| ($r|map(select((.type=="assistant" or .type=="user") and .timestamp))|map(.timestamp)|sort) as $ts | ($ts|map(epoch)) as $ep
| { assistant_lines: ($a|length), unique_messages: ($u|length),
    usage: {input:($u|map(.message.usage.input_tokens//0)|add//0), output:($u|map(.message.usage.output_tokens//0)|add//0),
      cacheWrite5m:($u|map(.message.usage.cache_creation.ephemeral_5m_input_tokens//0)|add//0),
      cacheWrite1h:($u|map(.message.usage.cache_creation.ephemeral_1h_input_tokens//0)|add//0),
      cacheRead:($u|map(.message.usage.cache_read_input_tokens//0)|add//0)},
    per_model: ($u|group_by(.message.model)|map({key:.[0].message.model,value:{
      input:(map(.message.usage.input_tokens//0)|add//0), output:(map(.message.usage.output_tokens//0)|add//0),
      cacheWrite5m:(map(.message.usage.cache_creation.ephemeral_5m_input_tokens//0)|add//0),
      cacheWrite1h:(map(.message.usage.cache_creation.ephemeral_1h_input_tokens//0)|add//0),
      cacheRead:(map(.message.usage.cache_read_input_tokens//0)|add//0)}})|from_entries),
    tool_calls: ($t|group_by(.name)|map({key:.[0].name,value:length})|from_entries),
    files_touched: ($t|map(.input.file_path//.input.notebook_path//empty)|group_by(.)|map({key:.[0],value:length})|from_entries),
    first_ts: $ts[0], last_ts: $ts[-1],
    max_gap_minutes: (if ($ep|length)<2 then 0 else ([range(0;($ep|length)-1)|($ep[.+1]-$ep[.])]|max)/60 end) }
```

`unique_messages` = distinct `(message.id, requestId)` among assistant lines, excluding `<synthetic>` (broken lines already dropped by `fromjson? // empty`); disagreeing copies keep the larger-`output_tokens` one (moot here — the one replay is byte-identical); usage sums once per unique message; `tool_calls`/`files_touched` count `tool_use` blocks deduped by `id`; subagent records fold into the parent session; `first_ts`/`last_ts`/`max_gap_minutes` run over deduped turns (first line per `message.id|requestId`, synthetic and broken lines excluded; recomputed with node after generation). `all.*` = same computation over all four files concatenated (message ids don't collide across real sessions, so this equals summing the three per-session results). `max_gap_minutes` rounded to 2 decimals.

## Privacy

Verified over this directory: case-insensitive search for the real username/homedir substrings and for a literal dot-claude-slash path all return zero hits. Case-insensitive `work/` matches only the intended fake paths (`/Users/dev/work/alpha`, `/Users/dev/work/beta`); case-sensitive search for the real path's capitalized form returns zero hits. Every string starting with `/` starts with `/Users/dev/work/`. No line exceeds 3000 chars; every log/data file is under 100 lines; tree is under 200 KB. Every `"text"`, `"thinking"`, `"command"`, `"content"` value in the tree is exactly `"<redacted>"`.
