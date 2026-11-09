# Starter provenance

This is a focused derivative of create-t3-turbo, commit `8f945b7bb3bfb3ca8358d48b1ff0214079bc11ee`.
Upstream: https://github.com/t3-oss/create-t3-turbo

The MIT license is retained in LICENSE. The pnpm/Turbo workspace layout, shared package boundaries, and UI button primitive are derived from that starter. Expo, TanStack Start, demo posts and authentication examples were removed. Versions were reviewed and updated for this implementation; the beta authentication package is not installed.

SVCMAP and South-View Grave Navigation were studied as predecessor projects. Their application code has not been copied. Selected public factual data is independently sourced; inherited reference coordinates are explicitly attributed in the source register. Images have separate rights metadata. See docs/SOURCES.md.

MapLibre GL JS and OpenFreeMap are independent projects. Required OpenFreeMap, OpenMapTiles and OpenStreetMap attribution remains visible on the map.

The cemetery polygon in `apps/nextjs/src/lib/cemetery-area.ts` is derived from [OpenStreetMap way 34773826](https://www.openstreetmap.org/way/34773826), version 9, retrieved 2026-10-07. © OpenStreetMap contributors, [Open Database License 1.0](https://www.openstreetmap.org/copyright). The coordinate ring remains available in that source file; this geographic data is not relicensed under the application's MIT code license. The map displays attribution and a source link for the reference outline.

`apps/nextjs/public/images/google-sign-in-light.png` is Google's unmodified, pre-approved light rectangular Sign in with Google button, including its current gradient G and lettering. Source: [Google's branding guidelines](https://developers.google.com/identity/branding-guidelines) and [official asset bundle](https://developers.google.com/static/identity/images/signin-assets.zip), retrieved 2026-10-03. Bundle entry: `Android + Web/PNG @4x/Light/Theme=Light, Show text=Yes, Shape=Square, Platform=Android+Web@4x.png`. The artwork is displayed at its original aspect ratio in an accessible native button; hover/active states follow Google's HTML configurator. Google branding remains subject to Google's brand guidelines and is not relicensed under this project's MIT code license. The button connects to the existing Better Auth redirect flow; it does not use Google One Tap or the Google Identity Services JavaScript SDK.

The development and build scripts copy MapLibre GL JS's installed ESM worker, its matching shared module, and the upstream `LICENSE.txt` into `apps/nextjs/public/vendor/maplibre/`. The copied license contains the applicable MapLibre and bundled-dependency notices; include that file with the generated assets when deploying. These assets are generated from the locked dependency version, not maintained as a separate fork. The default cluster-label font name, `Noto Sans Regular`, refers to the configured map provider's glyph service; no webfont file is bundled by that setting.
