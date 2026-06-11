# Dialogue Colors

A SillyTavern extension that color-codes each character's dialogue automatically. Use the LLM engine to write persistent `<font color>` tags, or the local DOM-only engine to color rendered quotes without editing chat text.

---

## Highlights

- **Two coloring engines** - Choose persistent LLM coloring or local DOM-only coloring from the **Basic** section
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags
- **DOM-only coloring** - Colors rendered dialogue locally without modifying `msg.mes` or saving chat text
- **LLM color blocks** - Reads `[COLORS:Name=#RRGGBB,...]` blocks and removes them from display
- **Keep / pin protection** - Mark important characters with **Keep** so they survive `Clear Non-Kept`, batch delete tools, duplicate cleanup, and other destructive bulk actions
- **Safer destructive tools** - Heavy cleanup actions now live in a dedicated **Danger Zone** and respect kept characters
- **Cleaner everyday workflow** - Common actions are grouped into **Basic**, **Characters**, **Advanced**, and **Danger Zone**
- **Per-chat or global colors** - Store colors per chat or share them across all chats
- **Auto-lock detected characters** - Newly detected characters can still lock automatically by default
- **Right-click/long-press reassignment** - Optional manual reassignment on dialogue text
- **Per-chat quote overrides** - DOM-mode manual quote assignments are stored in chat metadata and reapplied on render
- **Undo/Redo** - Undo destructive or accidental changes quickly
- **Custom palettes and presets** - Save reusable color setups without losing advanced flexibility

## Everyday Workflow

### Basic

This section is meant to be the only place most users need most of the time.

- **Scan Chat** - Scan the current chat for characters and colors
- **Coloring engine** - Pick `LLM` for persistent font tags or `Local (DOM-only)` for reversible local decoration
- **Clear Non-Kept** - Clear tracked characters except anything marked with **Keep**
- **Recolor Chat / Refresh DOM Colors** - Rewrite persistent font tags in LLM mode, or refresh local decorations in DOM mode
- **Colorize Missing** - Colorize uncolored messages in LLM mode
- **Show Stats** - Open dialogue statistics
- **Theme / Palette / Brightness** - Control the look of newly generated colors
- **Enable Dialogue Colors / Highlight dialogue / Show floating legend / Auto-recolor after changes** - Core visual toggles

### Characters

This section is where manual character management happens.

- **Keep** - Protect a character from clear and bulk-delete tools
- **Lock** - Prevent regen/reset tools from changing that character's color
- **Delete** - Remove a character directly unless it is kept
- **More** - Reveal less common per-character tools like swap, alias, style, and group
- **Search / Sort / Add Character** - Find, organize, and add entries quickly
- **Batch bar** - Bulk select characters for lock, unlock, style, or delete actions

Kept characters are also sorted to the top so the most important cast members stay visible.

## Advanced Tools

Advanced options are still there, but they are intentionally tucked away so they do not crowd the default experience.

### Automation

- Auto-scan on chat load
- Auto-scan new messages
- Auto-lock new characters
- Auto-colorize fallback, LLM mode only
- Right-click reassignment
- Narration toggle
- Global color sharing
- CSS effects
- LLM palette enhancement
- Reduced toast popups
- LLM profile selection

### Prompt & narration

- Narrator color
- Thought symbols
- Prompt depth, LLM mode only
- Prompt role, LLM mode only
- Prompt mode, LLM mode only
- Macro copy helper, LLM mode only

### Palette tools

- Generate a custom palette from a name and notes
- Save current colors as a custom palette
- Delete the selected custom palette
- Overwrite existing custom palette toggle

### Presets & import/export

- Save / load / delete color presets
- Export and import full color data
- Export legend PNG
- Export and import settings only

### Card & sync

- **Add Current Card**
- **Use Avatar Color**
- **Save To Card**
- **Load From Card**
- Auto-sync controls

### Maintenance

- Undo / Redo
- Fix Similar Colors
- Regenerate Unlocked
- Flip For Theme
- Storage Manager

## Danger Zone

This section contains the heavier cleanup tools.

- **Reset Unlocked Colors**
- **Delete Locked**
- **Delete Unlocked**
- **Delete Below Threshold**
- **Delete Duplicate Colors**

All of these respect **Keep**. If a character is pinned, the extension will preserve it and tell you why it was not removed.

## Keep Behavior

`Keep` is manual. It is not automatically assigned to the current card.

When a character is marked with **Keep**:

- `Clear Non-Kept` leaves it alone
- Per-row delete is blocked until Keep is turned off
- Batch delete leaves it alone
- Delete Locked / Delete Unlocked leave it alone
- Delete Below Threshold leaves it alone
- Delete Duplicate Colors preserves it
- Clearing the current chat through **Storage Manager** preserves it

This makes it useful for main cast members or card characters you never want to lose during cleanup.

## Features

### Core

- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags
- **Local DOM-only engine** - Applies reversible styles to rendered `<q>` dialogue and detected thought emphasis without writing tags into chat messages
- **LLM color blocks** - LLM outputs `[COLORS:Name=#RRGGBB,...]` at end of messages for reliable character detection
- **Text-safe colorize fallback** - Rejects LLM rewrites that alter dialogue text, then falls back to deterministic matching
- **Persona message support in DOM mode** - Local decoration also attributes and colors user/persona messages
- **Metadata quote overrides** - Right-click or long-press a DOM-colored quote to store a per-chat speaker override guarded by message content hash
- **Auto-detect nicknames/usernames** - Parenthesized nicknames in the color block become aliases automatically
- **Per-chat or global colors** - Store colors per character or share across all chats
- **Auto-sync settings** - Settings can sync across devices through SillyTavern's managed extension settings store

### Color Management

- **Keep** - Protect important characters from destructive cleanup tools
- **Color lock** - Lock a character's color to prevent changes
- **Quick swap** - Swap colors between two characters
- **Avatar color extraction** - Suggest a color from the current avatar
- **Brightness adjustment** - Bias new colors lighter or darker
- **Theme flip** - Flip colors for dark/light transitions
- **Undo/Redo** - History with Ctrl+Z / Ctrl+Y support inside the extension panel
- **Export/Import** - Save and load color schemes as JSON
- **Color presets** - Save, load, and delete preset assignments
- **Recolor messages** - Rewrite existing message colors after changing assignments in LLM mode, or refresh local decorations in DOM mode
- **Auto-recolor** - Optionally recolor chat automatically when colors change
- **Smart color suggestions** - Name-based color suggestions for some characters
- **Color harmony** - Double-click a color picker for harmony suggestions
- **Custom palettes** - Generate palettes from words or save your current colors

### Advanced Character Tools

- **Aliases** - Map multiple names to the same color
- **Per-character styles** - Bold, italic, or both
- **Groups** - Assign and sort characters by group
- **Batch operations** - Multi-select for bulk lock, unlock, delete, and style changes
- **Dialogue count badges** - ⭐ for 50+, 💎 for 100+

## Quick Start

1. Enable the extension in the **Basic** section.
2. Choose **LLM** if you want persistent colored chat text, or **Local (DOM-only)** if you want reversible local coloring.
3. Start chatting so the selected engine can color dialogue. In LLM mode the model can emit a `[COLORS:...]` block; in DOM mode rendered quotes are decorated locally.
4. Use **Scan Chat** if you want to pull colors from existing LLM color blocks immediately.
5. Mark your main characters with **Keep** in the **Characters** list.
6. Use **Clear Non-Kept** when you want to clean out temporary NPCs without losing pinned characters.

## Installation

1. Open SillyTavern → Extensions → Install Extension
2. Paste: `https://github.com/platberlitz/sillytavern-character-colors`
3. Click Install

## Notes

- Storage and import/export still preserve advanced data like aliases, styles, groups, locks, and keep state.
- Card save/load also preserves keep state because the full normalized color table is stored.
- DOM-only quote overrides are stored in the current chat's metadata, not in the message text. If the message text changes, the override is ignored instead of being applied to the wrong quote.
- The floating legend, stats popup, right-click reassignment, and palette generation workflows are still available; they are just no longer competing for space in the default UI.

## Credits

- CSS effects feature inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)

## License

MIT
