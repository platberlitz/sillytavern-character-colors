# Dialogue Colors

A SillyTavern extension that color-codes each character's dialogue automatically. Use the LLM engine to write persistent `<font color>` tags into the chat text, or use the local DOM-only engine to color rendered quotes without changing the saved message text.

## Quick Start

1. Enable the extension in the **Basic** section.
2. Start chatting so the model can emit a `[COLORS:Name=#RRGGBB,...]` block.
3. Use **Scan Chat** if you want to pull colors from existing messages right away.
4. Mark your main characters with **Keep** in the **Characters** list.
5. Use **Clear Non-Kept** when you want to clean out temporary NPCs without losing pinned characters.

## Features

- **Two coloring engines** - Choose persistent LLM coloring or local DOM-only coloring from the **Basic** section.
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags.
- **DOM-only coloring** - Colors rendered dialogue locally without modifying `msg.mes` or saving chat text.
- **LLM color blocks** - Reads `[COLORS:Name=#RRGGBB,...]` blocks and removes them from display.
- **Keep / pin protection** - Mark important characters with **Keep** so they survive `Clear Non-Kept`, batch delete tools, duplicate cleanup, and other destructive bulk actions.
- **Safer destructive tools** - Heavy cleanup actions live in a dedicated **Danger Zone** and respect kept characters.
- **Cleaner everyday workflow** - Common actions are grouped into **Basic**, **Characters**, **Advanced**, and **Danger Zone**.
- **Per-chat or global colors** - Store colors per chat or share them across all chats.
- **Auto-lock detected characters** - Newly detected characters can lock automatically by default.
- **Right-click / long-press reassignment** - Optional manual reassignment on dialogue text.
- **Per-chat quote overrides** - DOM-mode manual quote assignments are stored in chat metadata and reapplied on render.
- **Undo / Redo** - Undo destructive or accidental changes quickly inside the extension panel.
- **Custom palettes and presets** - Save reusable color setups without losing advanced flexibility.
- **Per-character Google Font** - Assign a Google Font name to any character; it loads and applies to their dialogue, legend, stats, and character card.
- **Per-character text style** - Cycle each character through Normal, Bold, Italic, or Bold Italic.
- **Color harmony suggestions** - Double-click a character's color dot to open a popup with complementary, triadic, and analogous color suggestions.
- **Floating legend** - Show a draggable legend of active character colors.
- **Dialogue statistics** - Open a popup showing how many lines each character has spoken.
- **Storage manager** - Browse and clear stored color data across chats.
- **Export legend PNG** - Save the floating legend as a PNG image.

## Coloring Engines

### LLM Engine

The extension injects a formatting instruction into the chat context. The model is asked to wrap dialogue and inner-thought spans in `<font color="#RRGGBB">...</font>` tags and to end the reply with a single `[COLORS:Name=#RRGGBB,...]` block. The color block is read by the extension to track character colors, then hidden from view.

If the model forgets to add color tags, the **Auto-colorize fallback** option can catch the message after generation and colorize it automatically. It tries the LLM first, then falls back to deterministic regex matching.

### DOM Engine

The DOM engine colors quotes while rendering them on screen. It does not edit `msg.mes` or save color tags into the chat text. This makes it fully reversible, but the colors are only visible while the extension is active.

In DOM mode you can enable **Stealth colors block** to ask the model to emit a hidden `[COLORS:...]` block for new speakers without adding visible `<font>` tags. You can also enable **LLM attribution check** to have a separate LLM profile verify who spoke each quote segment and save corrections in chat metadata.

## Prompt Injection

In LLM mode, the extension sends the formatting instruction using three controls in the **Basic** section:

- **Depth** - How many messages back the instruction is placed in the context. Default is 1.
- **Role** - Whether the instruction is injected as a system or user message. Default is system after v4.8.9.
- **Mode** - Either `Inject` (automatic) or `Macro` (manual).

### Inject Mode

The extension places the prompt automatically on every generation. You do not need to edit your system prompt.

### Macro Mode

The extension exposes a `{{dialoguecolors}}` macro. When Macro mode is selected, the extension does not inject anything automatically; instead, you copy the macro into your own system prompt wherever you want it. A copy helper appears in the **Advanced** section under **Prompt & narration**.

## Character Management

The **Characters** section lists every tracked character and their color.

- **Keep** - Protects a character from clear and bulk-delete tools. Kept characters sort to the top of the list.
- **Lock** - Freezes a character's color so regeneration and reset tools leave it alone.
- **Delete** - Removes a character directly unless it is kept.
- **More** - Reveals less common per-character tools: swap color, alias, style, group, and font.
- **Search / Sort / Add** - Find, organize, and manually add entries.

### More Actions

- **Swap** - Swap one character's color with another character's color.
- **Alias** - Add alternate names that should be treated as the same character.
- **Style** - Cycle the character's text style between Normal, Bold, Italic, and Bold Italic.
- **Group** - Assign a group name for organization.
- **Font** - Assign a Google Font name to that character.

### Color Harmony

Double-click a character's color dot to open a small popup with harmony suggestions: complementary, triadic, analogous, split-complementary, and tetradic colors. Click a swatch to apply it.

## Advanced Features

The **Advanced** section groups less common tools into subsections.

### Automation

- **Auto-scan on chat load** - Scan the chat for characters and colors when it opens.
- **Auto-scan new messages** - Scan each new message as it arrives.
- **Auto-lock new characters** - Lock newly detected characters automatically.
- **Auto-colorize fallback** - In LLM mode, automatically colorize a message if the model produced no color output.
- **Right-click reassignment** - Select text in a message and right-click or long-press it to assign it to a character.
- **Narration toggle** - Disable narration coloring.
- **Global color sharing** - Share colors across all chats instead of storing them per chat.
- **CSS effects** - Allow the model to emit brief inline `<span style="...">...</span>` tags for tone shifts. When enabled, an auto-regex script strips them from the prompt context so they do not leak into the model's instructions.
- **Reduced toast popups** - Show fewer notifications.
- **LLM profile** - Choose a SillyTavern connection profile for LLM colorization.

### Prompt and Narration

- **Narrator color** - Pick a color for narration text.
- **Thought symbols** - Characters that mark inner thoughts, such as `*` or `「」`. The extension supports paired delimiters like `()`, `[]`, `{}`, `「」`, `『』`, etc.
- **Macro copy helper** - Appears when prompt mode is set to Macro.

### Presets and Import / Export

- **Save preset** - Save the current character colors as a named preset.
- **Load preset** - Apply a saved preset.
- **Delete preset** - Remove a saved preset.
- **Export / Import color data** - Save or load the full color table as JSON.
- **Export / Import settings** - Save or load extension settings as JSON.
- **Export legend PNG** - Save the floating legend as a PNG image.

### Palette Tools

- **Generate palette** - Create a custom palette from a name and optional notes. The extension first asks the LLM, then falls back to a local heuristic if the LLM fails. Keywords like `warm`, `cool`, `pastel`, `neon`, `cyberpunk`, `noir`, and `vaporwave` seed hue, saturation, and lightness ranges.
- **Save palette** - Save the current colors as a reusable palette.
- **Delete palette** - Remove a saved palette.
- **Overwrite existing** - Allow generating a palette with the same name as an existing one to replace it.

### Card and Sync

- **Add current card** - Add the currently loaded character to the color table.
- **Use avatar color** - Use the character's avatar color as their dialogue color.
- **Save to card** - Save the current color table to the character card.
- **Load from card** - Load a color table stored on the character card.
- **Auto-sync** - Keep card-stored colors in sync with the extension.

### Maintenance

- **Undo / Redo** - Reverse or re-apply recent changes in the extension panel.
- **Fix Similar Colors** - Auto-resolve colors that are too close to each other.
- **Regenerate Unlocked** - Assign new random palette colors to all unlocked characters.
- **Flip For Theme** - Invert the lightness of every character color to adapt to a light/dark theme switch.
- **Storage Manager** - Browse stored color data across chats and clear selected entries.

## Danger Zone

Heavy cleanup tools that all respect **Keep**:

- **Reset Unlocked Colors** - Reassign random palette colors to all unlocked characters.
- **Delete Locked** - Delete all locked characters except kept ones.
- **Delete Unlocked** - Delete all unlocked characters except kept ones.
- **Delete Below Threshold** - Delete characters whose dialogue count is below the threshold, except kept ones.
- **Delete Duplicate Colors** - Delete characters that share the same color, keeping the highest dialogue count and any kept characters.
- **Lock All** - Lock every tracked character color.
- **Unlock All** - Unlock every tracked character color.

If a character is marked with **Keep**, the extension preserves it and tells you why.

## Keep Behavior

Keep is manual. It is not automatically assigned to the current card.

When a character is marked with **Keep**:

- `Clear Non-Kept` leaves it alone.
- Per-row delete is blocked until Keep is turned off.
- Batch delete leaves it alone.
- Delete Locked / Delete Unlocked leave it alone.
- Delete Below Threshold leaves it alone.
- Delete Duplicate Colors preserves it.
- Clearing the current chat through **Storage Manager** preserves it.

This makes it useful for main cast members or card characters you never want to lose during cleanup.

## Shortcuts

- **Shift + Colorize Missing** - Colorize only the latest message.
- **Shift + Verify Colors (LLM)** - Verify all visible unverified messages in DOM mode.

## Installation

1. Open SillyTavern, go to Extensions, then Install Extension.
2. Paste: `https://github.com/platberlitz/sillytavern-character-colors`
3. Click Install.

## Notes

- Storage and import/export preserve aliases, styles, groups, locks, fonts, and keep state.
- Card save/load also preserves keep state since the full normalized color table is stored.
- DOM-only quote overrides are stored in the current chat's metadata, not in the message text. If the message text changes, the override is ignored instead of being applied to the wrong quote.
- The floating legend, stats popup, right-click reassignment, and palette generation are all available in both engines.
- Composite speaker labels like `Alice & Bob`, `Alice/Bob`, or `Alice and Bob` are split automatically and attributed to each named speaker individually.
- Dialogue count badges appear at 50+ and 100+ messages.

## Troubleshooting

- **Prose feels worse in LLM mode** - The formatting instruction may be competing with the roleplay context. Try switching the prompt **Role** to system (default after v4.8.9), increasing **Depth**, or switching to **DOM-only** mode.
- **Model ignores color tags** - Make sure **Coloring engine** is set to **LLM** and the extension is enabled. Some models obey system-role instructions better; others obey user-role instructions better.
- **DOM colors disappear on refresh** - DOM coloring is render-only. If you want persistent colors, use the LLM engine or enable **Stealth colors block** in DOM mode.
- **Auto-colorize never runs** - It only triggers when the model produces no color block and no existing `<font>` tags in the latest non-user message.
- **LLM profile dropdown is disabled** - Connection profiles require SillyTavern 1.15.0 or newer with ConnectionManagerRequestService available.

## Credits

- CSS effects feature inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)

## License

MIT
