# First prompt to paste into Codex desktop

Read `AGENTS.md`, `README.md`, every `docs/*.md`, and `contracts/openapi-starter.yaml`. This is the authoritative engineering blueprint for Atlas. Do not mistake a proposal for implemented functionality.

Start **Milestone M0** from `docs/08-milestones.md`. Inspect the repository state first, explain the exact files and implementation steps, then implement the monorepo foundations: pnpm workspace and Turborepo, strict TypeScript config, Next.js web app, NestJS API and worker app, shared contracts/config packages, PostgreSQL and Redis local Docker Compose services, example environment variables, schema/migration baseline, health endpoints, typed config validation, basic CI workflow, formatting/linting, foundational unit/integration tests, and functional README commands.

Verify dependency versions using current official documentation/registries before installation; pin a working, compatible set. Do not deploy to AWS or provision paid services until explicitly approved. Run each available validation command and fix failures where feasible. Do not claim tests pass if the environment prevents running them.

Preserve the entire blueprint and future backlog, including difficult security and collaboration features. End by updating `implementation/SESSION_HANDOFF.md` with the current branch/commit, changed files, completed behavior, exact command results, blockers, and ordered next steps for M1. This allows continuation in another Codex session without relying on chat history.
