# UI Quality Infrastructure Plan

1. Introduce `AlignedResourceList` with named standard and compact action lanes.
2. Replace page-owned aligned list classes and track overrides in Profiles and
   Workspaces.
3. Add mixed-state renderer fixtures and shared E2E geometry assertions.
4. Capture dense resource/list regions separately and compare them with tighter
   per-image tolerances.
5. Add a fast audit that enforces shared ownership and evidence registration.
6. Route shared renderer primitive changes through focused tests and UI audits.
7. Rebuild, run Electron geometry tests, update visual baselines, run the full
   commit and visual gates, then inspect the new region captures cold.
