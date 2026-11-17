# ADR-063: Arabic interface and right-to-left layout (M10)

## Context

Atlas targets teams in Saudi Arabia among others. Products there are
expected to work in Arabic, right to left, and the owner is a native
speaker who can review the translation.

## Decisions

- **English text is the key.** Components call `t('English text')`, with
  `{name}` placeholders filled after translation; `lib/locales/ar.ts` maps
  English to Arabic and anything missing falls back to English. This keeps
  the code readable and makes untranslated text obvious, at the cost that
  rewording English changes the key (the test below catches it).
- **Choice by cookie** (`atlas_locale`, one year, `SameSite=Lax`). The root
  layout reads it on the server so the very first paint has the right
  `lang` and `dir`; there is no flash of the wrong direction. The switch is
  a button labelled in the other language, on the sign-in pages and in the
  header; it reloads the page.
- **Layout mirrors through logical CSS:** margins, padding, borders,
  alignment and positions use `inline-start`/`inline-end`, including the
  timeline's bars, so one stylesheet serves both directions. Codes, keys,
  email addresses and URLs stay left to right inside Arabic text.
- **Typography:** Arabic system faces (Segoe UI, Noto, Geeza Pro, Tahoma),
  no Latin letter-spacing and a slightly taller line height. No web fonts
  are downloaded (content security policy and cost).
- **Scope:** all interface text in the web app, status and error messages,
  priorities and roles. Not translated: data people enter (task titles,
  status names), emails sent by the server, API error bodies, and dates,
  which follow the browser's own locale.
- **Translation by sentence, not fragment.** Text with values inside
  (names, emails) is one translatable sentence with placeholders, never
  pieces around markup, because Arabic word order differs.

## Gates

`tests/i18n.test.ts` scans the web app: every `t()` key has a translation
(or is deliberately the same in both languages, such as `example.com`),
placeholders match, and no unused translations remain. The browser test
switches to Arabic, checks `dir="rtl"`, signs in with Arabic labels, audits
the page for accessibility and switches back.
