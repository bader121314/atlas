# ADR-026: Custom fields

## Decisions

- **Project-scoped definitions, four types.** A project manager defines up to
  20 fields per project: text, number, date, or a choice list (1–30 unique
  choices). Names are unique per project ignoring case. Organization-wide
  field templates are left for later; the planning doc allowed a nullable
  project, which would complicate tenancy keys for little gain today.
- **Typed columns instead of JSON.** `task_field_values` has `value_text`,
  `value_number` and `value_date`, with a check that exactly one is set.
  Numbers and dates stay sortable and comparable in SQL, which future
  filtering on custom fields needs.
- **Validation lives in one function.** `coerceFieldValue` checks the value
  against the field type (trimmed text up to 500 characters, finite numbers,
  real calendar dates, a choice from the list, matched exactly). The
  database enforces shape; the service enforces meaning.
- **The type never changes.** Renaming a field and editing its choices are
  allowed; changing text to number is not, so stored values never become
  invalid. Removing a choice clears the values that used it, in the same
  transaction.
- **Tenancy as elsewhere.** Composite foreign keys bind each value to a task
  and a field of the same organization and project, and an immutable-tenant
  trigger guards both tables. A field from another project answers 404.
- **Setting a value is a task change.** It bumps the task version, writes an
  activity row (`task.updated`, with the field name) and returns the task.
  Editors and managers can set values; viewers cannot.
- **Tasks carry their values** as `fields: { [fieldId]: value }`; dates are
  `YYYY-MM-DD` strings and numbers are JSON numbers. The table view adds a
  column per field and the task page shows an input per field.

## Consequences

- Filtering and sorting by custom fields are not built yet; the typed
  columns make them a query change, not a migration.
