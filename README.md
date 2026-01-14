# Dialogue Colors

> **TL;DR:** A SillyTavern extension that makes the LLM color-code each character's dialogue automatically. No more walls of same-colored text—instantly see who's speaking at a glance. Includes smart character detection, colorblind-friendly palettes, per-chat memory, floating legend, dialogue statistics, and card-based color persistence.

---

## Features

### Core
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags
- **Character detection** - Scans messages and detects speakers from dialogue attribution
- **Per-chat memory** - Colors saved per chat session
- **Auto-scan on load** - Automatically scans when opening a chat with no saved colors
- **Min occurrence threshold** - Require names to appear multiple times (configurable) to reduce false positives

### Color Management
- **Color lock** 🔒 - Lock a character's color to prevent overwrites
- **Quick swap** ⇄ - Click two characters to swap their colors
- **Brightness adjustment** - Global slider for lighter/darker colors
- **Undo/Redo** ↶↷ - Full history with Ctrl+Z/Y shortcuts
- **Export/Import** - Save and load color schemes as JSON
- **Color presets** - Save/load color presets separately from full export
- **Regenerate colors** - Bulk regenerate all colors from current palette
- **Smart color suggestions** - Automatically suggests colors based on character names (e.g., "Red" → red color)
- **Reset colors** - Reset all unlocked colors to defaults

### Palettes
- Pastel, Neon, Earth, Jewel, Muted, Jade, Forest, Ocean, Sunset, Aurora, Warm, Cool, Berry, Monochrome
- **Colorblind-friendly:** Protanopia, Deuteranopia, Tritanopia

### Advanced
- **Character aliases** - Map multiple names to same color
- **Per-character styles** - Bold, italic, or both
- **Narrator color** - Separate color for narration
- **Highlight mode** - Background highlights + text color
- **Custom regex patterns** - Add your own speaker detection patterns (with pattern management UI)
- **Card integration** - Save/load colors to character card metadata
- **Conflict resolution** - Auto-fix similar colors with one click
- **Bulk actions** - Delete all locked characters, clear all, reset to defaults

### Visual
- **Floating legend** - Toggle overlay showing character→color mapping
- **Dialogue statistics** - Bar graph of who's talking most
- **Colored preview** - See character colors in the prompt preview
- **Conflict detection** - Warns when colors are too similar
- **Dialogue count badges** - Visual indicators: ⭐ (50+), 💎 (100+) for high-volume speakers
- **Character sorting** - Sort list by name or dialogue count
- **Character search** - Filter characters by name
- **Pending characters** - View and approve pending characters that haven't met threshold

### Technical
- **Regex auto-install** - Strips font tags from AI context automatically
- **Theme-aware** - Adjusts colors for dark/light themes (auto/dark/light modes)
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
| Enable | Toggle extension on/off |
| Highlight mode | Enable background highlights |
| Auto-scan | Auto-detect on chat load |
| Show floating legend | Toggle character→color overlay |
| Theme | Select Auto/Dark/Light mode |
| Palette | Choose color palette (17 options) |
| Min | Set minimum occurrences before auto-adding |
| Bright | Adjust global brightness |
| Narrator | Set narrator color |
| Scan | Detect characters from all messages |
| Clear | Remove all characters |
| Stats | Show dialogue distribution graph |
| Fix | Auto-resolve color conflicts |
| Regen | Regenerate all colors from palette |
| Preset↓ | Save color preset |
| Preset↑ | Load color preset |
| Export/Import | JSON file backup |
| +Card | Add character from active card |
| Save→Card | Save colors to character card |
| Card→Load | Load colors from character card |
| ↶/↷ | Undo/Redo (also Ctrl+Z/Y) |
| DelLocked | Delete all locked characters |
| Reset | Reset all unlocked colors |
| Search | Filter characters by name |
| Sort | Sort by name or dialogue count |
| +Pat | Add custom regex pattern |
| Patterns | Manage custom patterns |
| 🔒 | Lock color |
| ⇄ | Swap colors |
| S | Cycle style |
| + | Add alias |
| × | Delete |
| ⭐ | 50+ dialogues |
| 💎 | 100+ dialogues |

## How It Works

1. Extension injects a prompt telling the LLM to use `<font color>` tags
2. Regex script strips tags from AI context (it doesn't see its own coloring)
3. Extension scans for character names near dialogue and caches colors
4. Names must appear minimum threshold times before being confirmed (reduces false positives)
5. Subsequent messages include assigned colors for consistency
6. Colors persist per chat or can be saved to character cards

## License

MIT
