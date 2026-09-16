---
name: update-last-point
description: Use after every commit / branch merge / push to main that lands real work, AND at session end. Refreshes docs/last-point.md with what is currently shipped on main for the payload-booking plugin. Triggered whenever the user says "session bitti", "last-point güncelle", "neredeyiz", or anything is squash-merged.
---

# Update Last Point

Refresh `docs/last-point.md` so it accurately reflects what is
shipped on `main` right now. Used by future agents to learn the
current state without reading commit history.

`CHANGELOG.md` is the user-facing release log (keep-a-changelog,
one entry per published version). `last-point.md` is the internal
snapshot between releases. Do not duplicate the changelog into it —
link to it.

## Process

1. Read `git log --oneline -30` to see what has landed on `main`
   recently.
2. Cross-reference `PLUGIN_BOOKING_SPEC.md` §20 (acceptance
   criteria) and §17 (publish checklist) for milestone context.
3. Rewrite the `## Shipped on \`main\``, `## Code touchpoints` and
   `## Verification` sections. Update the `Last updated` date.
4. Keep the file under **50 lines**. If it grows beyond that,
   compress older bullets into shorter summaries — older milestones
   lose detail before newer ones do.

## What goes in

- One bullet per shipped milestone: a layer landed (core, model,
  server, admin, react, dev bench), a §20 criterion met, a version
  published, or a merged branch.
- Format: `**Name** (commit-hash if merge) — one-line summary of
  the behaviour change.`
- Group by layer or branch.
- Current branch name + working-tree status on a separate line.
- Current package version and whether it is published.
- The verification line that proves it: e.g. "typecheck clean, lint
  0 errors, unit 42 passing, int 9 passing on Postgres, pack
  round-trip into blank template verified".

## What does NOT go in

- Process narrative ("we tried X, didn't work, then Y").
- Specific code line references.
- Future plans (those live in `execution-map.md`).
- Long explanations of why a decision was made — short.

## Trigger checklist

This skill should fire on:

- After any `git push` to `main` that includes code or doc changes.
- After a squash-merge of a feature branch into `main`.
- After `npm publish` of any version.
- When the user says "session bitti" / "kapatıyoruz" / "wrap up".
- When the user asks "neredeyiz" or "ne yaptık" if the doc is
  visibly stale.

Don't fire on:

- Commits that are still on a feature branch (those aren't shipped).
- Doc-only commits that don't change project state.
