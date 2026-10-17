### Changed

- **Faster workspace load**: The terminal, file editor, pull requests and rebase conflict editor now download the first time you open them instead of with every workspace. The first open can take a moment longer.

### Fixed

- **Mermaid labels are no longer cut off**: Diagram labels drew in the code font while Mermaid sized their boxes for the regular font, so longer labels were clipped, for example "store.get(sl" instead of "store.get(slug)". Diagrams now draw in the same font they are sized for.
