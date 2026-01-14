# Dialogue Colors

> **TL;DR:** A SillyTavern extension that makes the LLM color-code each character's dialogue automatically. No more walls of same-colored text—instantly see who's speaking at a glance. Includes smart character detection, colorblind-friendly palettes, per-chat memory, floating legend, dialogue statistics, and card-based color persistence.

---

## Features

### Core
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags
- **Character detection** - Scans messages and detects speakers from dialogue attribution
- **Per-chat memory** - Colors saved per chat session
- **Auto-scan on load** - Automatically scans when opening a chat with no saved colors

### Color Management
- **Color lock** 🔒 - Lock a character's color to prevent overwrites
- **Quick swap** ⇄ - Click two characters to swap their colors
- **Brightness adjustment** - Global slider for lighter/darker colors
- **Undo/Redo** ↶↷ - Full history with Ctrl+Z/Y shortcuts
- **Export/Import** - Save and load color schemes as JSON

### Palettes
- Pastel, Neon, Earth, Jewel, Muted
- **Colorblind-friendly:** Protanopia, Deuteranopia, Tritanopia

### Advanced
- **Character aliases** - Map multiple names to same color
- **Per-character styles** - Bold, italic, or both
- **Narrator color** - Separate color for narration
- **Highlight mode** - Background highlights + text color
- **Custom regex patterns** - Add your own speaker detection patterns
- **Card integration** - Save/load colors to character card metadata

### Visual
- **Floating legend** - Toggle overlay showing character→color mapping
- **Dialogue statistics** - Bar graph of who's talking most
- **Colored preview** - See character colors in the prompt preview
- **Conflict detection** - Warns when colors are too similar

### Technical
- **Regex auto-install** - Strips font tags from AI context automatically
- **Theme-aware** - Adjusts colors for dark/light themes
- **Japanese quote support** - 「」『』«» brackets

## Installation

1. Open SillyTavern → Extensions → Install Extension
2. Paste: `https://github.com/platberlitz/sillytavern-character-colors`
3. Click Install

## Quick Start

1. Enable the extension
2. Start chatting - dialogue gets colored automatically
3. Click **Scan** to detect characters from existing messages
4. Adjust colors with the color picker
5. Toggle **floating legend** to see colors while reading

## UI Reference

| Control | Function |
|---------|----------|
| Scan | Detect characters from all messages |
| Clear | Remove all characters |
| Stats | Show dialogue distribution graph |
| +Card | Add character from active card |
| Save→Card | Save colors to character card |
| Card→Load | Load colors from character card |
| ↶/↷ | Undo/Redo (also Ctrl+Z/Y) |
| Export/Import | JSON file backup |
| 🔒 | Lock color |
| ⇄ | Swap colors |
| S | Cycle style |
| + | Add alias |
| × | Delete |

## How It Works

1. Extension injects a prompt telling the LLM to use `<font color>` tags
2. Regex script strips tags from AI context (it doesn't see its own coloring)
3. Extension scans for character names near dialogue and caches colors
4. Subsequent messages include assigned colors for consistency

## License

MIT
