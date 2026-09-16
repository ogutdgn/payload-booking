---
name: update-execution-map
description: Use at session start when planning what's next, after a big task closes, and at session end to record what's queued. Refreshes docs/execution-map.md with the next concrete tasks for the payload-booking plugin. Triggered when the user says "sırada ne var", "execution map güncelle", "ne yapacağız", or hands off to a new chat.
---

# Update Execution Map

Refresh `docs/execution-map.md` so it lists the next concrete tasks.
Future agents land here first to know what to work on next.

## Process

1. Read the current `docs/execution-map.md` to see what was queued.
2. Listen to the user's stated goals from chat context.
3. Cross-reference `PLUGIN_BOOKING_SPEC.md`: §20 (acceptance
   criteria = definition of done), §17 (build & publish checklist),
   §21 (chosen defaults). Cross-reference `docs/last-point.md` for
   what is already shipped. Spec changes agreed in chat are edited
   into the spec itself; the map points at spec sections, never
   restates them.
4. Rewrite the `## Next` section. Update the `Last updated` date.
5. Keep the file under **30 lines**. Concrete tasks only, not
   abstract directions.

## What goes in

- Numbered list of next tasks.
- Per task: one line — name + one-sentence what it does + which
  layer it touches (core / model / server / admin / react / dev /
  test / build).
- Concrete acceptance criteria where they exist (endpoint path,
  field name, test file name, spec section, "typecheck + lint +
  unit clean").
- `## Blocked` section: tasks waiting on the owner (package name,
  npm scope, Turnstile keys, SMTP sink) or an external service, one
  line each with what unblocks it.
- `## Future` section: remaining §20 criteria and §19 post-v1 items
  (reminders, reschedule, calendar sync) as one-liners.

## What does NOT go in

- Process narrative ("we will try X first").
- Long discussion of trade-offs.
- Pros / cons / alternatives.
- Anything that belongs in the commit message of the work itself.

## Trigger checklist

This skill should fire on:

- Session start, if the user mentions "ne yapacağız" or asks for
  current plans.
- Right after a big task closes (a layer finished, a §20 criterion
  met, a version published, the plugin linked into a client site).
- Session end, before handoff to a new chat.
- When the user says "execution map güncelle" / "sırada ne var".

Don't fire on:

- Micro-task transitions inside an ongoing session.
- Brainstorming that isn't yet committed direction — the user has
  to actually agree to a plan before it goes here.
