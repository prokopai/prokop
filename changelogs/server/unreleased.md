### Changed

- **Faster workspace load**: The terminal, file editor, pull requests and rebase conflict editor now download the first time you open them instead of with every workspace. The first open can take a moment longer.
- **Lighter streaming replies**: While a reply streams, earlier messages and the prompt markers on the right no longer redraw with every update, and long conversations keep far fewer old messages loaded off screen. Replies use about a fifth less CPU while they stream.
- **Streaming text fades in word by word**: New words now fade in as they arrive instead of typing out letter by letter, so text shows up sooner. Long code blocks stream smoothly instead of stuttering, and replies use about a third less CPU while they stream. With reduced motion turned on, words appear without the fade.
- **Lighter code blocks while they stream**: A code block that is still being written only recolors its newest lines instead of the whole block on every update. Long code blocks now stream at full frame rate and use about half the CPU.

### Fixed

- **Overview keeps fresh session names and status**: A rename or status change that arrived while the overview was loading, or while it loaded more sessions, could be replaced by the older copy from that request until the next change. The newer state now stays.

- **Mermaid labels are no longer cut off**: Diagram labels drew in the code font while Mermaid sized their boxes for the regular font, so longer labels were clipped, for example "store.get(sl" instead of "store.get(slug)". Diagrams now draw in the same font they are sized for.
