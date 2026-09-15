# README Screenshots

Capture the current Electron build with isolated demo data:

```sh
npm run build
node scripts/capture-profiles.mjs --readme --output /tmp/agentenv-readme
node scripts/capture-critical-comparison.mjs --output /tmp/agentenv-readme-comparison
```

Replace the matching PNGs here after visual inspection. Use
`comparison-overview-920x620.png` for `profile-compare.png`. The capture scripts
write build fingerprints and image hashes to `capture-manifest.json` in each
output directory. Keep the published image provenance in this directory's
`capture-manifest.json` up to date.

The README includes both `skills-list.png` (tags and per-Skill updates) and
`skills-by-source.png` (source scope and updates). The README fixture excludes
the offline-device failure case, waits for transient success notices to dismiss,
and checks updates against its synthetic Git repository before capture.

The page captures use a fake home, synthetic repositories and mock Agent
commands. The comparison executes a test CLI in an isolated workspace; its
metrics are not model benchmarks. Never capture a real user's Profiles,
conversations, credentials or SSH hosts for the README.
