import type { CollectionSlug, GlobalSlug } from 'payload'

/**
 * Payload's generated types narrow `CollectionSlug` and `GlobalSlug` to the host's own
 * entities. A plugin's slugs are runtime strings the host can override, so they cannot
 * satisfy those unions at build time.
 *
 * These two helpers are the single place that gap is bridged.
 *
 * The double cast is deliberate. Compiled on its own, the plugin sees `CollectionSlug` as
 * plain `string`, so a single `as` reads as a redundant assertion and gets stripped;
 * compiled inside a host, the union is narrow and the cast is required. Going through
 * `unknown` is correct in both contexts, and a named function keeps the explanation next
 * to the one place it applies.
 */
export const collectionSlug = (slug: string): CollectionSlug => slug as unknown as CollectionSlug

export const globalSlug = (slug: string): GlobalSlug => slug as unknown as GlobalSlug
