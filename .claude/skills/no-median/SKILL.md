---
name: no-median
description: >-
  Design or redesign product interfaces with AI using explicit constraints,
  references, multiple off-code variants, taste reflection, subtraction,
  reusable components, and real-data verification. Use for UI, landing page,
  TUI, prototype, component, or design-feedback work. Do not use for copy-only,
  data-visualization, or backend-only tasks.
---

# NoMedian

Turn fast AI-generated interface work into a coherent product design.

Distilled from Matt Dailey's guide
[«How I Design with AI»](https://x.com/reactiverobot/status/2092638003789439075);
the constraints loop follows Christopher Alexander's *Notes on the Synthesis of Form*.

## Sources and boundaries

- Project design tokens, style guides, components, product requirements, and
  explicit user instructions are the binding product sources. Locate them before
  proposing visuals.
- When a required fact is missing, state the assumption or ask the user when the
  choice would materially change the result. Do not invent brand or workflow rules.
- Taste guides choices within the constraints; it does not override product facts.
- Do not deploy, access customer data, or write project documentation unless the
  task and available authorization cover those actions.

## Terms

- **constraint** — a testable condition the design must satisfy.
- **papercut** — a minor annoyance to collect for cohesive future work unless the user asks to fix it now.
- **prototype gravity** — refining the first coded version instead of exploring alternatives.
- **design surface** — Figma, another design tool, or a throwaway standalone prototype outside production code.
- **de-slop pass** — removing every element the design can succeed without.
- **taste note** — a specific reaction plus the design principle inferred from it.

## Workflow

1. **Route the request and load context.** Find the project's design sources. If
   `design/no-median-feedback.md` exists, read its last five entries; do not
   create it for a read-only task. Classify the work as:
   - **full path** — a new interface, redesign, or feedback that changes a
     constraint; continue through steps 2–9;
   - **direct fix** — an obvious isolated defect or a papercut the user explicitly
     asked to fix; skip to steps 7–9;
   - **record only** — a minor papercut the user did not ask to fix. Append it to
     an existing papercuts document when authorized; otherwise report the proposed entry and stop.
2. **Define the whole through constraints.** For the full path, write a numbered
   list covering the user goal, supported workflows, business states, content and
   data, viewports, accessibility, design tokens, and existing components. Mark
   unknowns as assumptions. Record or show the list before proposing a visual;
   wait for user confirmation only when an unresolved choice changes scope or intent.
3. **Collect references deliberately.** For the full path, gather 2–3 products or
   screenshots that solve a similar interaction or communication problem. Add one
   `take this pattern` note per reference. Borrow the principle, not another
   product's brand identity or distinctive composition.
4. **Explore outside production code.** Create 3–4 genuinely different candidates
   on a design surface and compare them side by side. Each candidate must satisfy
   the current constraints through a different hierarchy, layout, or interaction
   approach. Do not use the production app or its showcase page for this exploration.
5. **Evaluate constraints and taste.** For each candidate, record constraint
   failures, the immediate reaction, why it feels right or wrong, and one principle
   worth retaining. If any candidate exposes a missing, wrong, or unnecessary
   constraint, update the list and return to step 2. Select one candidate using
   the constraints and the user's preference; when no review was requested, make
   the choice and state the reasoning. Add a reusable taste note to existing project
   design guidance only when that edit is in scope.
6. **Run the de-slop pass.** Inspect every piece of copy, icon, divider, border,
   badge, wrapper, and decorative effect in the selected candidate. Remove it unless
   the design needs it to satisfy a constraint. Name the removals; if nothing can
   go, justify that result because AI-generated interfaces tend to over-add.
7. **Integrate through the system.** Reuse the project component library and keep
   view code separate from business logic. Exercise a genuinely new component on
   the project's showcase or Storybook surface before connecting it to the app.
   On the direct-fix path, make the smallest coherent change and avoid unrelated redesign.
8. **Verify in hand.** Use the running app or an authorized preview with real or
   production-like sanitized data. Check each constraint, relevant state, viewport,
   and accessibility behavior. Subjective UX requires human review, not only an
   agent verdict. For a large full-stack feature, prefer separately testable backend
   work and a shareable frontend preview when practical. A discovered constraint
   error returns the full path to step 2; an implementation defect returns to step 7.
9. **Report and learn.** Return the route taken, chosen design and rationale,
   removals, verification evidence, remaining risks, and per-constraint verdicts.
   If `design/no-median-feedback.md` already exists or the user asked to create
   it, append this record there and never edit earlier entries:

   ```markdown
   ## YYYY-MM-DD task in 3–5 words
   - Outcome: accepted unchanged | accepted with edits | reworked | rejected
   - User edits: specific changes | none
   - Lesson: one rule for the next run | none
   - Gold candidate: verified path | none
   ```

## Route-specific completion

### Full path

- [ ] Constraints existed before the first visual and were updated when evidence changed.
- [ ] 2–3 annotated references and 3–4 off-code candidates existed before integration.
- [ ] The selection includes constraint verdicts and concrete taste notes.
- [ ] The de-slop pass names removals or justifies zero.
- [ ] Existing components were reused; new components were exercised in showcase/Storybook.
- [ ] Real or sanitized production-like data produced a verdict per constraint.
- [ ] A human reviewed subjective UX before it was called ready to ship.

### Direct fix

- [ ] The issue was shown to be isolated and no design constraint changed.
- [ ] The change was minimal, reused existing patterns, and received targeted verification.
- [ ] Variants and references were skipped intentionally; they are not completion requirements.

### Record only

- [ ] The user did not request an immediate fix.
- [ ] The papercut and its context were recorded or returned as a proposed entry.
- [ ] Production code was not changed.

## Failure modes

| Avoid | Do instead |
|---|---|
| Spot-fixing every complaint | Test feedback against the constraint set |
| Adding labels, icons, or tooltips first | Remove and simplify before adding |
| Iterating the first version in the app | Compare off-code candidates first |
| Treating `/showcase` as a throwaway design tool | Use it after selection to exercise components |
| Copying a reference's visual identity | Extract the interaction or hierarchy principle |
| Signing off on placeholder data or agent taste alone | Use representative data and human review |

Good: "Settings redesign used eight constraints, three annotated references,
four off-code candidates, two taste notes, seven removals, one showcased component,
and a human-reviewed preview with a verdict for every constraint."

Bad: "A user found the sidebar confusing, so the agent added an icon and tooltip
directly in production without revisiting constraints, exploring alternatives,
removing clutter, or testing representative data."

## Gold standard

No gold-standard output is bundled yet. Link the first result accepted unchanged
only after it has verification evidence; do not invent or self-approve one.
