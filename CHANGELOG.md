# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository scaffolded from Payload's official plugin template, renamed to
  `@ogutdgn/payload-booking`, MIT licensed.
- Public option types (`BookingPluginOptions`) and the plugin entry point, which
  validates `apiBasePath` against registered slugs.
- Dev test bench running on local PostgreSQL, with an in-memory MongoDB switch
  (`DB_ADAPTER=mongo`) for adapter-parity tests.
- Build specification (`PLUGIN_BOOKING_SPEC.md`), its verification evidence
  (`docs/spec-review.md`) and the decisions log (`docs/decisions.md`).

[Unreleased]: https://github.com/ogutdgn/payload-booking/compare/HEAD...HEAD
