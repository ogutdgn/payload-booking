import path from 'path'
import { loadEnv } from 'payload/node'
import { fileURLToPath } from 'url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * Two projects (spec §4.2, §16):
 *   unit — pure specs beside their modules in src/. Parallel, no database.
 *   int  — integration specs in dev/int. Serial: each boots Payload and pushes schema
 *          to the one test database, so parallel files would race.
 */
export default defineConfig(() => {
  loadEnv(path.resolve(dirname, './dev'))

  return {
    plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
    test: {
      projects: [
        {
          plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
          test: {
            environment: 'node',
            include: ['src/**/*.spec.ts'],
            name: 'unit',
          },
        },
        {
          plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
          test: {
            environment: 'node',
            fileParallelism: false,
            hookTimeout: 60_000,
            include: ['dev/int/**/*.spec.ts'],
            name: 'int',
            testTimeout: 60_000,
          },
        },
      ],
    },
  }
})
