# Dialogue Colors

A SillyTavern extension that makes the LLM color-code each character's dialogue automatically. Instantly see who's speaking at a glance with LLM-driven character detection, colorblind-friendly palettes, and optional CSS effects for dramatic text.

---

## Features

### Core
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags
- **LLM color blocks** - LLM outputs `[COLORS:Name=#RRGGBB,...]` at end of messages for reliable character detection (auto-removed)
- **Per-chat or global colors** - Store colors per character or share across all chats
- **Right-click/long-press** - Tap and hold (mobile) or right-click (desktop) on colored dialogue to assign it to a character

### Color Management
- **Color lock** 🔒 - Lock a character's color to prevent changes
- **Quick swap** ⇄ - Click two characters to swap their colors
- **Avatar color extraction** - Auto-suggest colors from character avatar's dominant color
- **Brightness adjustment** - Global slider for lighter/darker colors
- **Undo/Redo** ↶↷ - Full history with Ctrl+Z/Y shortcuts
- **Export/Import** - Save and load color schemes as JSON
- **Export as PNG** - Generate a visual legend image
- **Color presets** - Save/load color presets
- **Smart color suggestions** - Auto-suggests colors based on character names (e.g., "Rose" → pink)

### Palettes
- Pastel, Neon, Earth, Jewel, Muted, Jade, Forest, Ocean, Sunset, Aurora, Warm, Cool, Berry, Monochrome
- **Colorblind-friendly:** Protanopia, Deuteranopia, Tritanopia

### CSS Effects
*Inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)*

When enabled, instructs the LLM to apply CSS transforms for dramatic effect:
- **Chaos/madness** → `rotate(2deg) skew(5deg)`
- **Magic** → `scale(1.2)`
- **Unease** → `skew(-10deg)`
- **Rage** → `uppercase`
- **Whispers** → `lowercase`

Effects are visible in chat but stripped from the prompt context.

### Advanced
- **Character aliases** - Map multiple names to same color
- **Per-character styles** - Bold, italic, or both
- **Narrator color** - Separate color for narration (included in color block)
- **Thought symbols** - Custom symbols (e.g., `*`, `『』`) for inner thoughts
- **Highlight mode** - Background highlights + text color
- **Card integration** - Save/load colors to character card metadata
- **Conflict resolution** - Auto-fix similar colors

### Visual
- **Floating legend** - Toggle overlay showing character→color mapping
- **Dialogue statistics** - Bar graph of who's talking most
- **Dialogue count badges** - ⭐ (50+), 💎 (100+) for frequent speakers

## Installation

1. Open SillyTavern → Extensions → Install Extension
2. Paste: `https://github.com/platberlitz/sillytavern-character-colors`
3. Click Install

## Quick Start

1. Enable the extension (checkbox at the top)
2. Start chatting - the LLM will color dialogue and output a `[COLORS:...]` block
3. Characters are detected automatically from the color block
4. Lock characters (🔒) you want to keep consistent
5. Right-click or long-press colored text to manually assign colors

### How It Works

1. Extension injects a prompt telling LLM to use `<font color>` tags
2. LLM outputs `[COLORS:Name=#RRGGBB,...]` at the end of each response
3. Extension parses the block, extracts characters/colors, and removes it from display
4. Regex scripts strip font tags and color blocks from the prompt context
5. Colors persist per chat or globally (configurable)

## UI Reference

| Control | Function |
|---------|----------|
| **Enable** | Toggle extension on/off |
| **Highlight mode** | Add background highlights to dialogue |
| **Auto-scan on chat load** | Scan for characters when opening a chat |
| **Auto-scan new messages** | Scan each new generated message for colors |
| **Show floating legend** | Overlay showing character colors |
| **Disable narration** | Exclude narrator from coloring |
| **Share colors globally** | Use same colors across all chats |
| **CSS effects** | Enable emotion/magic CSS transforms |
| **Theme** | Auto/Dark/Light mode |
| **Palette** | Choose from 17 color palettes |
| **Brightness** | Adjust all colors lighter/darker |
| **Narrator** | Set narrator color |
| **Thoughts** | Symbols for inner thoughts |
| **Scan** | Scan messages for color blocks |
| **Clear** | Remove all characters |
| **Stats** | Show dialogue statistics |
| **Fix** | Auto-resolve color conflicts |
| **Regen** | Regenerate all colors |
| **Preset↓/↑** | Save/load color presets |
| **Export/Import** | Backup colors as JSON |
| **PNG** | Export legend as image |
| **+Card** | Add current character |
| **Avatar** | Extract color from avatar |
| **Save→Card** | Save to character card |
| **Card→Load** | Load from character card |
| **🔒** | Lock/unlock character color |
| **⇄** | Swap colors between characters |
| **S** | Cycle text style |
| **+** | Add alias |
| **×** | Delete character |

## Auto-Imported Regex Scripts

The extension automatically imports these regex scripts:

1. **Trim Font Colors** - Removes `<font>` tags from prompt
2. **Trim Color Blocks** - Removes `[COLORS:...]` from prompt and display
3. **Trim CSS Effects (Prompt)** - Strips CSS transform spans from prompt only (keeps display)

## Credits

- CSS effects feature inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)

## License

MIT
