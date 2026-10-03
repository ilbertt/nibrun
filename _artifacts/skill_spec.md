# nibrun skill maintenance

The initial scope is the existing `deploy-to-nibrun` skill. This record covers deployment
and app operation, not a complete inventory of contributor or infrastructure skills.

## Coverage and decisions

- Keep the skill owned by the repository root at `skills/deploy-to-nibrun/SKILL.md`:
  it describes a platform contract spanning the CLI, API, guest, and host agent.
- Preserve its description and deployment procedure. Only source mappings are added
  to its frontmatter; `skills:sync` derives the matching tree fields.
- Track CLI and shared operation implementations, guest/runtime contracts, deployment
  defaults, initial-data imports, exports, sleep, cron behavior, and region configuration.
  Unmapped changes still receive review rather than being silently excluded.
  Source globs start with `**/` because Git 2.50 can prune nested matches when Intent
  combines a literal prefix with its dependency exclusion; `**/` matches root paths too.
- Retain installation through `npx skills add ilbertt/nibrun`. Intent's `distribution: none`
  disables additional generated plugin exports; it does not remove the existing skill.
- Use the shared domain map and tree for future skills. Add a skill when it owns an
  independently useful task; do not create placeholder skills for unassessed areas.

## Coverage and batch history

Initial setup: Intent 0.5.0, source revision `b2c5b5baed54f00198b9a29775c895058c590331`.
The domain map records deployment, static serving, redeployment, seeded data, exports,
runtime configuration, public ports, cron jobs, and verification. Source inspection
confirmed the existing app-selection, initial-data, environment, health, and guest-path
constraints without changing the recommended behavior.

Verification uses Intent validation and the repository's existing checks. A temporary
edit to `packages/cli/src/config.ts` reopened skill review and failed `check:skills`;
restoring its original bytes cleared the review without recording another outcome. CI also supplies the actual PR base, exercising review across committed changes.

## Verification limits and remaining work

Intent checks structure, synchronized metadata, and recorded review fingerprints. Its
JS/TS compiler does not check this skill's shell snippets or prove review conclusions.
Existing CLI, app-operation, protocol, runtime, and agent tests cover the underlying
behavior; a live deployment and an independent fresh-consumer run are unverified in this
setup. External compiler documentation, installation URLs, and local admin-seeding
support for third-party apps require task-specific verification.

No additional skills have been assessed. Extend these records when a concrete task is added.
