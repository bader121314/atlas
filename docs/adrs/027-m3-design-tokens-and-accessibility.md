# ADR-027: Design tokens and automated accessibility checks

## Decisions

- **Every colour is a token.** `globals.css` declares colours, radii and a
  spacing scale in `:root`; rules refer to tokens only. Pages use shared
  utility classes instead of inline styles.
- **Contrast is a unit test.** `tests/design-tokens.test.ts` reads the tokens
  and checks the pairs the interface uses against WCAG 2.2: 4.5:1 for text
  and 3:1 for control boundaries. The check found input borders at 1.75:1;
  `--line-strong` is now 3.36:1 on white.
- **axe-core runs in the browser smoke test.** Every screenshot is also
  audited against WCAG 2.2 A/AA rules; serious and critical findings fail
  the job, and all findings are printed so one run shows every problem.
  axe-core is installed in the CI job only, like Playwright.
- **Phone and tablet layouts are checked.** Signed-in pages (organization,
  board, table, task) load at 390 and 820 pixels wide and must not scroll
  sideways. Wide tables scroll inside their own container.
- **The calendar is a table, not a grid.** It is read-only, so it uses
  table semantics with one row per week; `grid` would promise arrow-key
  navigation it does not have.

## Consequences

- Automated checks catch a subset of WCAG issues; keyboard and screen
  reader passes are still manual and are listed in the M3 exit report.
