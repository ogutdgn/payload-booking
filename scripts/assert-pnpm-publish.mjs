/**
 * Refuse a publish that is not run through pnpm.
 *
 * This package's `exports` point at `src/` so the test bench can run the plugin
 * from source. `publishConfig.exports` rewrites them to `dist/` — and that
 * rewrite is pnpm's, not npm's. `npm publish` ships the src paths with a
 * tarball that contains only `dist`, so every import in every host fails.
 *
 * That is exactly what 0.1.1 was. It is invisible in `pnpm pack`, which applies
 * the rewrite, so the check has to live here, at the publish itself.
 */
const agent = process.env.npm_config_user_agent ?? ''

if (!agent.includes('pnpm')) {
  console.error(
    '\n[payload-booking] Publish with `pnpm publish`, not npm.\n\n' +
      "  npm does not apply `publishConfig.exports`, so the published package's entry\n" +
      '  points would resolve to ./src/*.ts, which is not in the tarball. Version 0.1.1\n' +
      '  was published that way and had to be replaced.\n',
  )
  process.exit(1)
}
