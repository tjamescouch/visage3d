# constraints

## unix web design philosophy

- everything is a reusable component.
- each UI component MUST be loadable in isolation in a dedicated visual harness page/file.
  - the harness should mount only that component with minimal surrounding shell.
  - components should be visually inspectable (layout, interaction, performance) without running the whole app.
- no traditional unit tests for UI behavior.
  - acceptable automation: linting, typechecking, formatting, build verification.
  - visual inspection is the primary UI verification method.

## build + dev

- provide a fast dev server for component harness pages.
- keep dependencies minimal and justified.

## assets + licensing

- avatar assets may be large; prefer fetch-on-demand + caching over committing large binaries into git.
- any redistributed or downloaded assets MUST include attribution and license notice (e.g., CC BY 4.0).
