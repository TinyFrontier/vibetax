# NoMedian

[![skills.sh](https://skills.sh/b/TinyFrontier/no-median)](https://skills.sh/TinyFrontier/no-median)

**AI generates the median. NoMedian makes it design.**

NoMedian is a portable Agent Skill for turning AI-generated interface work
into coherent product design through explicit constraints, off-code exploration,
taste reflection, subtraction, reusable components, and representative-data
verification.

## Install

The quickest way is the [skills](https://skills.sh) CLI — it detects your
installed agents (Claude Code, Codex, Cursor, and others) and installs the
skill for each of them:

```sh
npx skills add TinyFrontier/no-median --skill no-median
```

Or install manually: copy or clone this repository into your agent's skills
directory. The folder name should remain `no-median` so it matches the skill
name in `SKILL.md`.

For Claude Code:

```sh
git clone git@github.com:TinyFrontier/no-median.git ~/.claude/skills/no-median
```

For Codex:

```sh
git clone git@github.com:TinyFrontier/no-median.git ~/.codex/skills/no-median
```

To share one copy between both tools, clone it once (for example into
`~/.agents/skills/no-median`) and symlink it into each directory above.

## Use

In Claude Code, invoke `/no-median`; in Codex, invoke `$no-median`. Either agent
can also select the skill automatically for interface design, redesign,
component, prototype, and design-feedback tasks.

The skill is self-contained and does not depend on Runewright or machine-specific
paths. Optional feedback is kept inside the project using the skill, not inside
the installed skill repository.

## Credits

Distilled from Matt Dailey's (@reactiverobot) guide
["How I Design with AI"](https://x.com/reactiverobot/status/2092638003789439075).
The constraints-first loop traces back to Christopher Alexander's
*Notes on the Synthesis of Form*. The skill text is an original distillation,
not a copy of the article.

## License

[MIT](LICENSE)
