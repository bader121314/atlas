# ADR-023: Moving cards on the board

## Decisions

- **Two ways to move, same rules.** Editors and managers can drag a card to
  another column (native HTML drag-and-drop) or use the "Move to" control on
  each card, which works with a keyboard and on touch screens. Both send the
  same versioned `PATCH`, so the API's checks apply unchanged.
- **Optimistic with rollback.** The card moves immediately. If the save
  fails, it returns to its previous column, the board reloads the latest
  tasks, and a message explains why (for example, someone else changed the
  task first, 409).
- **No new dependency.** `docs/02` names dnd-kit; native drag-and-drop plus
  the per-card control covers the M3 exit need (keyboard access, rollback)
  without one. Revisit if reordering within a column is added.
- The browser smoke test drags a card into Done, moves another with the
  keyboard control, and reloads to confirm both moves were saved.
