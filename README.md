# Dialogue Colors

> **TL;DR:** A SillyTavern extension that makes the LLM color-code each character's dialogue automatically. No more walls of same-colored text—instantly see who's speaking at a glance. Includes LLM-driven character detection, colorblind-friendly palettes, per-chat memory, floating legend, dialogue statistics, and card-based color persistence.

---

## Features

### Core
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags
- **LLM color blocks** - LLM outputs `[COLORS:Name=#RRGGBB,...]` at end of messages for reliable character detection (auto-removed)
- **Fallback detection** - Scans font tags and dialogue attribution if no color block present
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
- **Narrator color** - Separate color for narration (can be disabled)
- **Thought symbols** - Custom symbols (e.g., `*`, `『』`) for inner thoughts that use current speaker's color
- **Highlight mode** - Background highlights + text color
- **Custom regex patterns** - Add your own speaker detection patterns (with pattern management UI)
- **Card integration** - Save/load colors to character card metadata
- **Conflict resolution** - Auto-fix similar colors with one click
- **Bulk actions** - DelLocked/Delete all locked, DelUnlocked/Delete all unlocked, clear all, reset to defaults

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

1. Enable the extension (checkbox at the top)
2. Start chatting - the LLM will color dialogue and output a `[COLORS:...]` block at the end
3. Characters are detected automatically from the color block
4. Lock your real characters (🔒) to prevent changes
5. Adjust colors with the color picker
6. Toggle **floating legend** to see colors while reading

### How Color Detection Works

The extension instructs the LLM to:
1. Wrap each character's dialogue in `<font color=#RRGGBB>` tags
2. Output a color summary at the end: `[COLORS:Name=#RRGGBB,Name2=#RRGGBB]`

The extension then:
1. Parses the `[COLORS:...]` block to extract character names and their colors
2. Removes the block from the displayed message
3. Falls back to scanning `<font>` tags if no block is present

This approach is more reliable than pattern-matching speaker names from text.

### Common Workflows

**Fresh chat:**
1. Start chatting
2. Characters get detected automatically from `[COLORS:...]` blocks
3. Lock (🔒) characters you want to keep consistent
4. Click **DelUnlocked** to remove any false positives

**Existing chat:**
1. Click **Scan** to detect all characters from existing messages
2. Lock (🔒) your confirmed characters
3. Click **DelUnlocked** to clear the rest

**Backup & Restore:**
- Click **Save→Card** to save colors to character card
- Colors auto-load from card when opening the chat
- Use **Preset↓/↑** for quick color scheme switching

## UI Reference

| Control | Function |
|---------|----------|
| **Core Settings** |
| Enable | Toggle extension on/off. When off, no colors are applied. |
| Highlight mode | Add background highlights to dialogue in addition to text color |
| Auto-scan | Automatically scan for characters when opening a chat with no saved colors |
| Show floating legend | Show overlay on-screen mapping character names to their colors |
| Disable narration coloring | Exclude narrator color instruction from prompt |
| **Appearance** |
| Theme | Force dark/light mode, or let it auto-detect from SillyTavern theme |
| Palette | Choose from 17 color palettes (Pastel, Neon, Earth, Jewel, etc.) |
| Min | Set how many times a name must appear before auto-adding as a character (higher = fewer false positives) |
| Bright | Global brightness adjustment (-30 to +30) for all colors |
| Narrator | Set a specific color for narration text (if LLM uses narrator tag) |
| Thoughts | Custom symbols (e.g., `*`, `『』`) that wrap inner thoughts - LLM wraps these in font tags |
| **Scanning & Management** |
| Scan | Scan all messages in the chat to detect characters and assign colors |
| Clear | Remove all characters from the list |
| Stats | Open popup showing dialogue count per character (bar graph) |
| Fix | Automatically resolve color conflicts (too-similar colors) |
| Regen | Regenerate all unlocked colors from the current palette |
| Preset↓ | Save current character colors as a named preset |
| Preset↑ | Load a previously saved color preset |
| **Data Management** |
| Export | Download all colors and settings as a JSON file (backup) |
| Import | Load colors and settings from a JSON file |
| +Card | Add the active character card to the character list |
| Save→Card | Save current colors to the active character card metadata |
| Card→Load | Load colors from the active character card metadata |
| **Bulk Actions** |
| ↶/↷ | Undo/Redo changes (also Ctrl+Z/Y shortcuts) |
| DelLocked | Delete ALL locked characters (useful for cleanup) |
| DelUnlocked | Delete ALL unlocked characters (useful for removing false positives after scanning) |
| Reset | Reset all unlocked colors to random defaults from current palette |
| **Character List Controls** |
| Search | Filter character list by name (type to find specific characters) |
| Sort | Sort character list by Name or Dialogue Count |
| + | Add a new character manually (type name and press Enter) |
| **Pattern Management** |
| +Pat | Add a custom regex pattern for speaker detection |
| Patterns | Open popup to view/delete custom regex patterns |
| **Per-Character Actions** |
| 🔒 | Lock/unlock a character's color (locked characters won't change color during scans) |
| ⇄ | Click one character, then another to swap their colors |
| S | Cycle text style (none → bold → italic → bold italic) |
| + | Add an alias (alternative name) for this character |
| × | Delete this character |
| **Indicators** |
| ⭐ | Character has 50+ dialogue lines |
| 💎 | Character has 100+ dialogue lines |

## How It Works

1. Extension injects a prompt telling LLM to use `<font color>` tags and output `[COLORS:...]` block
2. Regex script strips tags from AI context (it doesn't see its own coloring)
3. Extension parses `[COLORS:Name=#RRGGBB,...]` block and removes it from display
4. Falls back to scanning font tags if no color block present
5. Names must appear minimum threshold times before being confirmed (reduces false positives)
6. Subsequent messages include locked colors for consistency
7. Colors persist per chat or can be saved to character cards

## Troubleshooting

### Colors Not Being Detected

**Problem:** Characters aren't showing up in the list.

**Solutions:**
1. Check if the LLM is outputting `[COLORS:...]` at the end of messages
2. If not, the LLM may not be following the instruction - try a different model or adjust your system prompt
3. Click **Scan** to use fallback detection from font tags

### False Positives (Wrong Characters Detected)

**Problem:** The extension detects words like "Just" or "At" as characters.

**Solutions:**
1. **Lock your real characters** (🔒), then click **DelUnlocked** to remove all false positives
2. **Increase the Min threshold** to require more occurrences before auto-adding

### Character Colors Change Randomly

**Problem:** Characters keep getting new colors.

**Solution:** 
- **Lock the character** (🔒) to prevent color changes

### Colors Don't Show

**Problem:** Dialogue isn't colored even though extension is enabled.

**Solutions:**
1. Make sure **Enable** checkbox is checked
2. Verify the LLM is using `<font color>` tags
3. Check the **Prompt Preview** to see if colors are being injected

## License

MIT
