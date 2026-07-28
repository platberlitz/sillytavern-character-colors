# Dialogue Colors

A SillyTavern extension that gives each character's dialogue a consistent visual identity. Use the LLM engine to write persistent `<font color>` tags into chat text, or use the local DOM-only engine to color rendered dialogue without changing saved messages.

## Quick Start

1. Open **Dialogue Colors** in the Extensions panel. Settings sit in the tab and scroll with it. For heavier work use **Fullscreen**, which gives the sections a left-hand nav; **Escape** or the same button returns to the tab.
2. On **Current setup**, enable the extension and choose where colors are saved: **Per chat**, **Per card**, or **Global**.
3. Choose the **LLM** or **Local (DOM-only)** engine.
4. Use **Scan entire chat** to discover existing speakers, or start chatting so new speakers are detected automatically.
5. Open **Characters** to edit a speaker. Use **Keep** to pin main characters against bulk deletion.
6. Use the clearly labeled actions under **Process chat** when you need to discover, colorize, verify, recolor, or refresh dialogue.

## Highlights

- **Optional fullscreen settings**: the panel flows at its natural height in the extensions tab instead of inside a capped inner scroller. Fullscreen is opt-in and swaps the stacked accordions for a left-hand section nav, which collapses to a horizontal strip on narrow screens.
- **Two coloring engines**: persistent LLM formatting or reversible local DOM rendering.
- **Three storage scopes**: separate colors per chat, share them across one character card, or use one global table.
- **Reviewed scope switching**: choose whether to use, copy, merge, replace, or start an empty destination. Existing data is never overwritten merely by changing the scope selector.
- **Compact character editor**: Keep and Edit stay visible; color, lock, typography, aliases, groups, deletion, and gradients are disclosed on demand.
- **Custom gradients**: create linear, radial, or conic gradients with 2–5 stops, deterministic `dc-gradient-v1` seeds, animation, exact positions, 37 built-in presets, custom presets, preset gallery, and one-click randomization. Conic sweeps around a pivot, using both the start angle and the origin, so it reaches looks the other two types cannot: hue wheels, chromatic fringing, and single bright wedges. Presets range from conventional (`sunset-ribbon`, `ocean-current`) through hard-banded (`heraldic-bands`, `stained-glass`) to pigment and emission studies (`cinnabar-verdigris`, `orpiment-realgar`, `cherenkov-blue`, `event-horizon`, `foxfire`). Two stops sharing a position render as a hard cut rather than a blend, which is how the banded presets are built.
- **Group profiles**: define scoped group styles and automation rules. Group profiles are stored with the active color table and apply materialized styles on assignment or character creation.
- **Multi-select bulk editing & style copy/paste**: select multiple character rows to lock, keep, group, randomize, or delete in one transaction. Copy character style fields (gradient, font, text style) and paste them across rows.
- **Color-vision simulation & perceptual conflict reports**: preview how dialogue appears under protanopia, deuteranopia, tritanopia, or achromatopsia without mutating stored colors. Conflict analysis uses deterministic item, gradient-sample, and pair limits; partial reports identify omitted visuals and unexamined pairs, and only complete reports can be auto-repaired.
- **Narrator style**: configure dedicated narrator colors, gradients, and text styles. Narrator styling works across LLM prompts, DOM rendering, legend, statistics, and conflict reports.
- **Attribution reviews**: verifier suggestions are queued for explicit human review by default. Accept, edit, or reject suggestions segment by segment or in bulk.
- **Automatic NPC gradients**: optionally randomize gradients for newly discovered NPCs while excluding the current card, group cards, and user persona. Off by default.
- **Automatic gradients for every new character**: a separate default-off override can randomize gradients for every newly created entry.
- **Global gradient drift**: optionally animate every gradient without changing each character's individual Drift setting. Off by default.
- **Fonts and text styles**: assign installed font families and Normal, Bold, Italic, or Bold Italic styling per character. Optional remote Google Font loading is disclosed, disabled by default, and bounded when enabled.
- **Safer maintenance**: destructive actions review their targets, skip kept characters, and use recovery where available.
- **Accessible interaction**: keyboard assignment, focus-managed dialogs, visible focus, speaker labels for assistive technology, reduced-motion support, forced-color fallbacks, and responsive touch targets.
- **Import and card review**: inspect counts, merge or replace deliberately, and opt in before applying an imported storage scope.
- **Storage recovery**: the Storage Manager protects the active table, selects nothing by default, and can restore its latest archived batch.
- **Auto-sync, presets, palettes, statistics, floating legend, and PNG legend export**.

## Coloring Engines

### LLM

The extension injects formatting instructions into the chat context. The model is asked to wrap dialogue and inner thoughts in `<font color="#RRGGBB">...</font>` and end its reply with `[COLORS:Name=#RRGGBB,...]`. The extension reads that mapping and hides it from rendered output.

**Colorize missing** can add tags to the latest message or the entire chat when output was not formatted. **Recolor saved tags** rewrites existing color references across the entire chat. Gradients remain a local visual enhancement; the primary solid color stays in persisted tags as a compatible fallback and speaker identifier.

### Local (DOM-only)

Local mode attributes and colors rendered quotes and thoughts without editing `msg.mes`. It is fully reversible, but styling is visible only while the extension is active.

**Stealth speaker color blocks** can ask the model for hidden `[COLORS:...]` metadata without visible font tags. Optional LLM attribution verification can review the latest or visible rendered messages and save corrections in chat metadata.

#### Verification accuracy

Small, fast models often answer the same message differently on each run, which shows up as attribution that changes every time you press Verify. **Agreement passes** (Engine settings) verifies each message several times and keeps only the corrections that most passes agree on. A pass that proposes nothing for a segment counts as a vote to leave it alone, so with 3 passes a correction has to be proposed at least twice, with the same speaker, to be applied.

The default is 1 pass, which behaves exactly as before and costs one request. Raising it multiplies tokens per verification, so it is worth it mainly for cheap, fast models. The reported confidence is capped at the agreement rate, so a model that always claims high confidence cannot push a bare-majority result past the **auto-high** review policy.

Independently of that setting, a correction naming a speaker who is not already configured will only create that character if the name appears verbatim in the message or its recent context.

## Storage Scopes

- **Per chat**: one color table for the current chat. A durable ID is stored in chat metadata so renaming the chat does not lose its colors.
- **Per card**: one table shared by chats using the current character card or group identity.
- **Global**: one table shared everywhere.

Changing scope first saves the current table. If the destination is empty, the panel asks whether to copy the current table, start empty, or cancel. If it already has data, the panel offers to use it, merge the current table, replace it, or cancel.

Older per-card/global data remains available and is migrated without destructive rewrites. Importing older settings preserves the active scope unless the review explicitly offers and you approve a saved scope change.

## Character Management

The **Characters** section searches names, aliases, groups, fonts, and status. Sorting is available by name, dialogue activity, or group.

- **Keep**: pins an entry so clear and bulk-delete actions skip it.
- **Edit**: reveals the full character editor.
- **Color and Harmony**: choose a color directly or open keyboard-accessible complementary, triadic, and analogous suggestions.
- **Lock**: prevents regeneration and reset from changing that character. Locking has no deletion side effects.
- **Swap**: exchanges complete color and gradient data with another character.
- **Style, Font, Alias, Group**: set typography and identity metadata directly.
- **Gradient**: enable, randomize, configure, animate, or apply a reusable preset.
- **Delete**: reviews the target first and remains blocked while Keep is active.

Adding an existing canonical name or alias reveals its current row instead of silently recoloring it.

## Process Chat

- **Scan entire chat**: discover speakers and update tracked dialogue activity.
- **Colorize missing** (LLM): add missing font tags to the latest message or entire chat.
- **Verify attribution** (Local): ask the selected profile to verify the latest or visible messages.
- **Recolor saved tags** (LLM): rewrite existing tags across the entire chat after reviewed confirmation.
- **Refresh local colors** (Local): reapply current render-only styles.
- **Statistics**: review attributed dialogue segments. Counts can differ between engines because attribution methods differ.
- **Clear unpinned**: review and remove every entry not protected by Keep.

## Appearance and Automation

- Select an Auto, Dark, or Light target surface and a palette for newly generated colors.
- Adjust the current table's brightness; the value previews while dragging and applies when released.
- Enable dialogue highlights, the floating legend, automatic recoloring after edits, or bounded remote Google Font loading. Remote font requests are off by default.
- Effective colors are adjusted against the rendered chat surface for at least 4.5:1 text contrast. Speaker metadata remains available to assistive technology without adding visible name tags to dialogue.
- Scan on load only when the current character list is empty, or scan each new message.
- Automatically lock detected speakers, assign random gradients to new NPCs or every new character, and optionally drift every gradient.
- Enable manual dialogue reassignment by pointer, long press, or keyboard.
- Reduce routine success notifications without suppressing required validation and safety feedback.

## Manual Dialogue Reassignment

When enabled, right-click or long-press eligible dialogue to assign it. Keyboard users can Tab to one dialogue target per message, use arrow keys to move between that message's segments, then press **Shift+F10** or the **Context Menu** key.

Local-mode assignments are stored as per-chat quote overrides. LLM-mode assignments update compatible persisted font tags. Assignment dialogs validate names, support Escape, and return focus after closing.

## Style Library

- Save, load, and delete complete assignment presets.
- Generate custom palettes from a name and mood notes, or save current colors as a palette.
- Apply 16 built-in gradient presets or manage reusable custom gradient presets from a character's gradient editor.
- Export/import color data and settings as JSON. Imports are analyzed before any changes are applied.
- Build portable **Style packs** (`dialogue-colors-style-pack` v1) from selected custom palettes, palette metadata, custom gradient presets, optional assignment presets, and safe appearance values. This format is separate from the internal color schema version.
- Style-pack files are local-only and reviewed before installation. Palette, gradient, and assignment-preset conflicts can keep, rename, or replace per category; assignment application and appearance changes are explicit opt-ins.
- Style packs never carry storage scope, auto-sync, connection profiles, prompts, attribution/automation settings, UI positions, URLs, CSS, or font files. Font family names in optional assignment presets are shown during review; they can trigger bounded Google Fonts requests only when remote font loading has been explicitly enabled.

## Storage, Cards, and Sync

- **Save to card** writes the current normalized color table to the character card.
- **Review card data** shows the payload before merge or replacement; automatic empty-table seeding imports colors only.
- **Auto-sync** transports settings, scoped tables, palettes, assignment presets, gradient presets, and UI state.
- **Storage Manager** lists Per chat, Per card, and Global tables with counts and dates. It cannot archive the active table and stores one recoverable archive batch.

## Maintenance and Danger Zone

Maintenance provides Undo/Redo, similar-color repair, unlocked-color regeneration, theme flipping, and reviewed setting-default restoration.

Danger Zone deletion tools show target and pinned counts before acting:

- Delete locked or unlocked entries.
- Delete entries below a dialogue-segment threshold.
- Delete duplicate primary colors.

Reset unlocked colors and Lock/Unlock All are reviewed state changes rather than deletion tools. Keep protection applies to deletion and clearing.

## Prompt Configuration

LLM mode supports prompt depth, system/user role, and two delivery modes:

- **Inject automatically**: add instructions on each generation.
- **Use macro manually**: expose `{{dialoguecolors}}` for placement in your own prompt.

## Installation

1. Open SillyTavern, then go to Extensions and choose Install Extension.
2. Paste `https://github.com/platberlitz/sillytavern-character-colors`.
3. Click Install.

## Notes

- Storage and import/export preserve gradients, aliases, styles, groups, locks, fonts, Keep state, custom gradient presets, and settings. Style packs additionally round-trip custom palette metadata when palettes are selected.
- DOM-only quote overrides are stored in chat metadata and ignored if the source message changes, preventing stale assignment to the wrong quote.
- Composite speaker labels such as `Alice & Bob`, `Alice/Bob`, or `Alice and Bob` are split and attributed individually.
- Ctrl/Cmd+Z and redo operate on extension history while focus is outside text-editing fields.
- Gradient drift respects Reduce Motion, forced colors, unsupported clipping, and print output.

## Troubleshooting

- **Prose feels worse in LLM mode**: use a system prompt role, increase prompt depth, use the manual macro, or switch to Local mode.
- **The model ignores color tags**: confirm the engine is LLM and the extension is enabled. Try a different prompt role or use Colorize missing.
- **Local colors disappear on refresh**: Local mode is render-only. Use LLM mode for persisted solid tags.
- **Auto-colorize does not run**: it only triggers when the latest non-user message contains no color block or existing font tags.
- **An LLM profile is unavailable**: connection profiles require a compatible SillyTavern ConnectionManagerRequestService.
- **A selected font is not visible**: install it locally, or explicitly enable remote Google Font loading under Appearance and Automation.
- **Gradient drift is paused**: the device's Reduce Motion preference intentionally disables it.

## License

MIT
