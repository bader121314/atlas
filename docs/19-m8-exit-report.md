# 19 — M8 Exit Report: Portfolio Release

**Status:** complete as a self-hosted release; there is no hosted demo (see
deferrals).
**Date:** 2026-11-17.
**Scope reference:** `docs/08-milestones.md`, M8.

## Exit criteria and evidence

| Exit criterion                                | Evidence                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An external evaluator can try the key flows   | The README's five-minute path starts the stack and runs `pnpm demo:seed`, which creates the Harbour Works organization and prints a sign-in; the README lists six flows to try. The browser test seeds the same organization on every run and signs in to it, so the path is exercised continuously. |
| No sensitive personal data                    | The seed uses fictional people with `@atlas.example` addresses and fictional work; tests use `@example.test`. Screenshots show only seeded data.                                                                                                                                                     |
| The demo works without privileged credentials | The demo account owns only the demo organization; its password is random per seed and printed once; nothing is hardcoded (AGENTS.md rule 9). No production credentials exist in the repository.                                                                                                      |
| Claims are limited to verified results        | The README says the app is not deployed, links the M7 limitations and the security review's open items, and every number it gives (tests, load) comes from CI.                                                                                                                                       |

## Delivered

- Demo seed and screenshot capture in CI (PR #49).
- README for evaluators with a demo path, architecture diagram and
  verification summary; case study (`docs/18-case-study.md`) (PR #50).
- Mentions in comments (ADR-045, PR #51), a carry-over from M2.

**Test totals at exit:** 187 unit tests and 135 integration tests, plus the
browser test, image builds, Terraform validation and the release drill.

## Deferred, with reasons

| Item                        | Status and reason                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted demo and status page | Needs a cloud account and running costs; AGENTS.md asks for approval before adding hosted costs. The Terraform stack and runbooks are ready for it. |
| Short video                 | Better recorded against a hosted demo.                                                                                                              |
| Multiple assignees          | Carried over since M2; one assignee per task covers the flows. Planned next.                                                                        |

## Next: M9

M9 is the open backlog (`docs/08`): each item needs an ADR, a data and
threat model and acceptance gates before work starts.
