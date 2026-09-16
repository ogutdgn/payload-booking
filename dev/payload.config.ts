import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { bookingPlugin } from '@ogutdgn/payload-booking'

import { bookingOptions } from './bookingOptions.js'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

/**
 * The dev app is the plugin's test bench and doubles as the reference host.
 *
 * Database is chosen with DB_ADAPTER (spec §4.4):
 *   postgres (default) — local PostgreSQL via DATABASE_URL. Used for `pnpm dev` and
 *                        the integration suite; db-postgres creates the database and
 *                        pushes the schema automatically outside production.
 *   mongo              — an in-memory replica set, for the adapter-parity suite only.
 */
const buildDevConfig = async () => {
  const adapter = process.env.DB_ADAPTER === 'mongo' ? 'mongo' : 'postgres'

  if (adapter === 'mongo') {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: { count: 1, dbName: 'payloadmemory' },
    })

    process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: 'users',
        auth: true,
        admin: { useAsTitle: 'email' },
        fields: [
          {
            name: 'roles',
            type: 'select',
            hasMany: true,
            defaultValue: ['admin'],
            options: [
              { label: 'Admin', value: 'admin' },
              { label: 'Editor', value: 'editor' },
            ],
          },
        ],
      },
    ],
    db:
      adapter === 'mongo'
        ? mongooseAdapter({
            ensureIndexes: true,
            url: process.env.DATABASE_URL || '',
          })
        : postgresAdapter({
            pool: { connectionString: process.env.DATABASE_URL || '' },
          }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [bookingPlugin(bookingOptions)],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildDevConfig()
