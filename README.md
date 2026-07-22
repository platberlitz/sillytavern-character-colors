# Dialogue Colors

A SillyTavern extension that gives each character's dialogue a consistent visual identity. Use the LLM engine to write persistent `<font color>` tags into chat text, or use the local DOM-only engine to color rendered dialogue without changing saved messages.

## Quick Start

1. Open **Current setup**, enable the extension, and choose where colors are saved: **Per chat**, **Per card**, or **Global**.
2. Choose the **LLM** or **Local (DOM-only)** engine.
3. Use **Scan entire chat** to discover existing speakers, or start chatting so new speakers are detected automatically.
4. Open **Characters** to edit a speaker. Use **Keep** to pin main characters against bulk deletion.
5. Use the clearly labeled actions under **Process chat** when you need to discover, colorize, verify, recolor, or refresh dialogue.

## Highlights

- **Two coloring engines**: persistent LLM formatting or reversible local DOM rendering.
- **Three storage scopes**: separate colors per chat, share them across one character card, or use one global table.
- **Reviewed scope switching**: choose whether to use, copy, merge, replace, or start an empty destination. Existing data is never overwritten merely by changing the scope selector.
- **Compact character editor**: Keep and Edit stay visible; color, lock, typography, aliases, groups, deletion, and gradients are disclosed on demand.
- **Custom gradients**: create linear or radial gradients with 2–5 stops, animation, exact positions, 16 built-in presets, custom presets, and one-click randomization.
- **Automatic NPC gradients**: optionally randomize gradients for newly discovered NPCs while excluding the current card, group cards, and user persona. Off by default.
- **Fonts and text styles**: assign a Google Font and Normal, Bold, Italic, or Bold Italic styling per character.
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
- Enable dialogue highlights, the floating legend, or automatic recoloring after edits.
- Effective colors are adjusted against the rendered chat surface for at least 4.5:1 text contrast. Speaker metadata remains available to assistive technology without adding visible name tags to dialogue.
- Scan on load only when the current character list is empty, or scan each new message.
- Automatically lock detected speakers or assign random gradients to new NPCs.
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

- Storage and import/export preserve gradients, aliases, styles, groups, locks, fonts, Keep state, custom gradient presets, and settings.
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
- **Gradient drift is paused**: the device's Reduce Motion preference intentionally disables it.

## License

MIT
