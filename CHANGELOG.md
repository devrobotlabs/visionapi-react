# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-08-09

First public release.

- `useAnalyze`, `useAsk`, `useDetect` — one file in, structured JSON out, with upload
  progress, cancellation and unmount safety
- `useTask` — polls an async task until it settles, and stops on its own
- `usePresets` — the catalog, for a picker
- `VisionProvider` for the endpoint base path and headers, with per-hook overrides
- `VisionError` with `code`, the convenience flags, and a `userMessage` you can render
- `unwrap` / `value` / `rows` / `belowConfidence` result helpers
- Built for the backend-proxy pattern: the hooks talk to your endpoint, never to the API
  directly, because an API key is a live spending credential
