# OptiFlow UI Rules

Enforceable rules for any change to `frontend/`. Full reasoning lives in
`docs/design-system/MASTER.md`; the failure catalog lives in
`docs/design-system/ANTI-PATTERNS.md`. Read both before UI work.

## Before you start

1. Read `docs/design-system/MASTER.md` and `docs/design-system/ANTI-PATTERNS.md`.
2. Check the status marks in MASTER: 🟢 implemented, 🟡 partial, 🔴 target only.
   **A 🔴 token does not exist in the code.** Never reference it until the sprint
   that defines it lands.
3. Search for an existing primitive before writing a new component.

## The Five Laws (every screen must pass)

1. A screen opens with a statement, not a wall of numbers.
2. A naked metric is forbidden — every important number carries a consequence
   (capacity, money, risk, threshold, output, or action).
3. Color is a measurement. Surfaces are never decorative. Green/yellow/red mean
   a measured state; blue means interaction; unmeasured stays neutral.
4. Never display an invented measurement. `null` renders as "—" plus a reason,
   and an action when one exists. Zero is never a placeholder.
5. Every screen ends with an action or a clear next step.

## Hard rules

- **Never invent a token.** No new color, spacing, radius, or duration value
  outside MASTER §3. If you need one, stop and ask.
- **No gradients.** Not on surfaces, not on cards, not on charts.
- **No nested cards.** A panel may not contain another bordered surface. Divide
  with a hairline.
- **No new card pattern** without writing the justification in the PR/commit
  message and adding it to MASTER.
- **No colored icon containers.** Icons render bare, 16px, in `ink-3`.
- **No gauge charts, no unlabeled sparklines, no decorative charts.**
- **Chart colors come only from MASTER §6.1** (validated palette). Status colors
  are never series colors. No dual y-axis.
- **At most one `primary` button per screen region.**
- **Page loads never show a spinner** — use a shape-matched skeleton. Spinner is
  only for in-button and short user-triggered work.
- **State is never carried by color alone** — add a label, icon, or geometry.
- **No horizontal page scroll at any width.** Tables become record lists below
  768px; they do not get `overflow-x-auto` as a fix.

## Architecture rules

- Pure logic lives in `frontend/src/lib/<area>/`. Components only render.
  Thresholds, coefficients, prices, decisions, and sentence-building never live
  inside a component.
- New logic gets a colocated `*.test.ts` (vitest, node environment).
- Prefer existing primitives in `frontend/src/components/ui/Primitives.tsx`.
  Existing signatures (`Card`, `Button`, `Badge`, `EmptyState`, `ProgressBar`,
  `SectionTitle`, `Spinner`, `MetricRow`) stay backward compatible.
- Use the existing variant names. `Button` uses `danger`, not `destructive`.

## Protected — never modify during visual work

Backend (`simulation_engine/`), authentication, tenancy, persistence, API
contracts, simulation engine and its math, live runtime logic, business logic,
existing data models, existing tests, and routing/view-state behavior
(`View`, `SECTION_OF_VIEW`, `VIEW_TITLE`, the view switch in `App.tsx`).

If a visual change requires touching any of these, stop and ask.

## Honesty rules (non-negotiable)

- Never write "connected", "working", or "receiving data" unless verified
  against a real endpoint or device. Demo, fixture, and replay output is labeled
  **Benzetim**.
- Never claim performance (fast, light, optimized, less re-rendering) without a
  measurement. If not measured, write "ölçülmedi".
- Every recommendation must be able to answer "why did OptiFlow recommend this?"
  Provenance is not optional.

## Before you finish

- Run `cd frontend && npm run acceptance` and report the table.
- Verify in a real browser at **375px**. If you did not, write DÜŞTÜ — do not
  assume.
- State the design tradeoff you made and which Law drove it.
- Do not commit or push unless explicitly asked.

## Language

Code comments, docstrings, test names, and `docs/` are written in Turkish.
Files under `.claude/` are written in English.
