# Dialogue Colors

A SillyTavern extension that tells the LLM to color-code each character's dialogue with `<font color>` tags. It scans your chat, tracks who said what, and keeps things readable when multiple characters are on screen.

## Quick Start

1. Enable the extension in the **Basic** section.
2. Start chatting so the model can emit a `[COLORS:...]` block.
3. Use **Scan Chat** if you want to pull colors from existing messages right away.
4. Mark your main characters with **Keep** in the **Characters** list.
5. Use **Clear Non-Kept** when you want to clean out temporary NPCs without losing pinned characters.

## Features

### Auto-coloring

The extension instructs the LLM to wrap dialogue in `<font color>` tags. The LLM also outputs a `[COLORS:Name=#RRGGBB,...]` block at the end of messages, which the extension reads to track character colors and then hides from view.

### Colorize fallback

If the LLM rewrites that would change the actual dialogue text are detected, they get rejected. The extension falls back to deterministic matching instead. Parenthesized nicknames in the color block (like `"Name (Nickname)"`) become aliases automatically.

### Keep and lock

- **Keep** marks a character as important. Kept characters survive `Clear Non-Kept`, batch delete tools, duplicate cleanup, and other destructive actions.
- **Lock** freezes a character's color so regen and reset tools leave it alone.
- Kept characters sort to the top of the list so your main cast stays visible.

Keep is manual. It is not assigned to the current card automatically.

### Per-chat or global colors

Colors can be stored per-chat or shared across every chat. Settings can also sync across devices through SillyTavern's managed extension settings store.

### Manual recoloring

Sometimes the LLM misses a piece of dialogue. When that happens, you can select text in a message, right-click it, and assign it to a character with a chosen color. The selection gets wrapped in a font tag and saved. This uses the same right-click/long-press toggle as the existing reassignment feature.

### Custom palettes and presets

- Generate a custom palette from a name and optional notes.
- Save your current colors as a reusable palette.
- Save, load, and delete color presets.
- Export and import full color data or settings as JSON.

### Undo and redo

Ctrl+Z / Ctrl+Y works inside the extension panel for undo and redo.

## UI Layout

### Basic

The everyday controls:

- **Scan Chat** - Scan the current chat for characters and colors
- **Clear Non-Kept** - Clear tracked characters except anything marked with Keep
- **Recolor Chat** - Rewrite message colors to match current assignments
- **Colorize Missing** - Colorize uncolored messages (shift-click for only the latest)
- **Show Stats** - Open dialogue statistics
- **Theme / Palette / Brightness** - Control the look of newly generated colors
- **Depth / Role / Mode** - How the prompt injection is sent (defaults to User role at depth 1)
- **Toggles** - Enable Dialogue Colors, highlight dialogue, floating legend, CSS effects, auto-recolor

### Characters

Where manual character management happens:

- **Keep** - Protect a character from clear and bulk-delete tools
- **Lock** - Prevent regen/reset tools from changing that character's color
- **Delete** - Remove a character directly unless it is kept
- **More** - Reveal less common per-character tools like swap, alias, style, and group
- **Search / Sort / Add** - Find, organize, and add entries
- **Batch bar** - Bulk select characters for lock, unlock, style, or delete

### Advanced

Less common tools are tucked away here.

**Automation** - Auto-scan on chat load, auto-scan new messages, auto-lock new characters, auto-colorize fallback, right-click reassignment, narration toggle, global color sharing, CSS effects, LLM profile selection, reduced toast popups.

**Prompt & narration** - Narrator color, thought symbols, macro copy helper. Prompt depth, role, and mode moved to Basic.

**Palette tools** - Generate, save, and delete custom palettes. Overwrite existing palette toggle.

**Presets & import/export** - Save/load/delete color presets. Export and import full color data or settings. Export legend as PNG.

**Card & sync** - Add current card, use avatar color, save/load to card, auto-sync controls.

**Maintenance** - Undo/Redo, Fix Similar Colors, Regenerate Unlocked, Flip For Theme, Storage Manager.

## Danger Zone

Heavier cleanup tools that all respect **Keep**:

- **Reset Unlocked Colors**
- **Delete Locked**
- **Delete Unlocked**
- **Delete Below Threshold**
- **Delete Duplicate Colors**

If a character is pinned with Keep, the extension preserves it and tells you why.

## Installation

1. Open SillyTavern, go to Extensions, then Install Extension.
2. Paste: `https://github.com/platberlitz/sillytavern-character-colors`
3. Click Install.

## Notes

- Storage and import/export preserve aliases, styles, groups, locks, and keep state.
- Card save/load also preserves keep state since the full normalized color table is stored.
- The floating legend, stats popup, right-click reassignment, and palette generation are all still available.
- Dialogue count badges show ⭐ at 50+ and 💎 at 100+.

## Credits

- CSS effects feature inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)

## License

MIT
