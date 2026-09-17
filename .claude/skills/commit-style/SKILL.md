---
name: commit-style
description: Use before any git commit in payload-booking (the Payload CMS booking plugin). Defines subject-line scope tags, body detail requirements, staging discipline, and PR-vs-direct-commit guidance for a publishable npm package with a dev test bench.
---

# Commit Style

## Subject line

Format: `<type>(<scope>): <imperative summary>`

`<scope>` is one of:
- `core` — pure logic in `src/core` (time, schedule, slots, lock key, tokens). No Payload imports, no I/O.
- `model` — collections, globals, fields, access, collection hooks (`src/payload`).
- `server` — endpoints, availability assembly, rate limiting, email templates and sending (`src/server`).
- `admin` — admin-panel components (`src/admin`), the `./client` and `./rsc` entries, import-map component paths.
- `react` — exported frontend components (`src/react`), the `./react` entry, `styles.css`.
- `dev` — the `dev/` test-bench Next app: its Payload config, seed, pages, env example.
- `test` — `tests/unit`, `tests/int`, fixtures, vitest/playwright config.
- `build` — `package.json` exports/files/peerDependencies, tsconfig, SWC config, publish scripts, tarball checks.
- `ci` — `.github/workflows`.
- `docs` — `README.md`, `CHANGELOG.md`, `docs/`, `PLUGIN_BOOKING_SPEC.md`.
- `deps` — dependency or tooling version changes.
- `repo` — cross-cutting or repo-root changes (LICENSE, .gitignore, editor config).

`<type>` is one of:
- `feat` — new user-visible feature or capability.
- `fix` — bug fix (subject names the bug, not the solution).
- `refactor` — internal restructure with no behaviour change.
- `ui` — visual-only change (no logic, no data-model change).
- `docs` — documentation only.
- `test` — tests or QA scripts only.
- `chore` — tooling, deps, config.

Imperative form, lowercase first word. Keep under 72 chars.

## Body — required for all non-trivial commits

Always include a body. One blank line after the subject, then:

**What changed** — bullet list of concrete changes (files/components/behaviour). Be specific: name the collections, globals, endpoints, components, or files touched. Example:
```
- Add booking-settings global with per-weekday session start times
- appointments: derive slotLockKey in beforeChange, merge originalDoc under data
- POST /booking/book: add seat loop, return 409 slot_taken when exhausted
- BookingForm: keep typed fields and re-fetch availability on 409
```

**Why** — one or two sentences explaining the motivation. What problem does this solve, or what goal does it serve?

**Impact notes** (include when relevant):
- `Schema impact: none` — or which collections/globals changed shape. This is what forces a migration in every host that installs the plugin.
- `API impact: none` — or which endpoint paths, request bodies, or response shapes changed.
- `Config impact: none` — or which `bookingPlugin(options)` keys were added, renamed, or removed.
- `Breaking: <what>` — if any of the above is not backward compatible. Bump the major (or minor while on 0.x).

If the commit meets an acceptance criterion in `PLUGIN_BOOKING_SPEC.md` §20: `Meets §20.N (name).`

## Trailer

**Do NOT add `Co-Authored-By: Claude` or any AI authorship trailer.** Never.

## Staging

- Stage files explicitly by path — never `git add .` or `git add -A`.
- Run `git diff --cached --stat` before committing to verify the staged set.
- Never commit: `.env`, `dev/.env`, `dev/media/`, `dev/.next/`, `node_modules/`, `dist/`, `*.tsbuildinfo`, `test-results/`, `playwright-report/`, agent log dumps. Commit `pnpm-lock.yaml` only when dependencies actually changed intentionally.
- `dev/payload-types.ts` and `dev/app/(payload)/admin/importMap.js` are generated — commit them together with the change that regenerated them, never on their own.
- `CHANGELOG.md` gets an `Unreleased` entry in the same commit as any user-facing change; the version header is added in the release commit.

## When to PR vs commit direct to branch

- **Direct commit**: single-concern change on a feature branch, already reviewed in conversation.
- **PR**: anything touching access control, the lock key / uniqueness path, endpoint guards, email sending, `package.json` exports or peerDependencies, or 5+ files — create a PR so it can be reviewed before merging to main.
- Force-push only on your own branch, never on main.

## Release commits

- Subject: `chore(build): release vX.Y.Z`. Body lists the CHANGELOG section verbatim.
- Only after: `pnpm build`, `pnpm pack` round-trip into a fresh blank template (spec §17), unit + integration green.
- Tag `vX.Y.Z` on the release commit.
- **Publish with `pnpm publish`, never `npm publish`.** The package's `exports` point at
  `src/` for the bench and are rewritten to `dist/` by `publishConfig.exports`, which is a
  pnpm feature. npm ignores it and ships entry points that resolve to files the tarball
  does not contain — that was 0.1.1. `prepublishOnly` now blocks it, and the guard is not
  a reason to stop checking.

## What NOT to do

- Skip hooks (`--no-verify`) — investigate the failing hook.
- Bypass signing.
- Amend a published commit.
- Lump unrelated changes into one commit.
- Commit before `pnpm typecheck`, `pnpm lint`, and `pnpm test:unit` pass. Run `pnpm test:int` before any PR.
