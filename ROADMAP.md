# Roadmap

Index only — phase scope lives in the business/build plan (external doc),
issue details live on GitHub. Keep this file to one line per item.

## Phases (per the build plan)

- [x] Phase 0 — done
- [x] Phase 1 — done (design-system rebuild: tokens, base components, DriveScreen)
- [ ] Phase 2 — next
- [ ] Phase 3
- [ ] Phase 4
- [ ] Phase 5

## Backlog / Post-Launch

- [#2 — Phase 3: replace fb_agent confidence gate with a real reviewed_at column](https://github.com/itslethallez/Voice-traffic-alerts/issues/2) — swap `confidence >= 80` for `reviewed_at IS NOT NULL` once the review dashboard lands.
- [#3 — 3D Visual Design Guide — camera, terrain, buildings, route rendering](https://github.com/itslethallez/Voice-traffic-alerts/issues/3) — post-launch. Spec: `design-reference/Shotgun_3D_Visual_Design_Guide.pdf`. Palette reconciliation with `src/theme/tokens.ts` is an open decision; do not implement from the guide directly.
