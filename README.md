# Dialogue Colors

> **TL;DR:** A SillyTavern extension that makes the LLM color-code each character's dialogue automatically. No more walls of same-colored text—instantly see who's speaking at a glance. Includes smart character detection, colorblind-friendly palettes, per-chat memory, floating legend, dialogue statistics, card-based color persistence, and inner thought coloring.

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
- **Narrator color** - Separate color for narration (can be disabled)
- **Thought symbols** - Custom symbols (e.g., `*`, `『』`) for inner thoughts that use current speaker's color
- **Highlight mode** - Background highlights + text color
- **Custom regex patterns** - Add your own speaker detection patterns (with pattern management UI)
- **Card integration** - Save/load colors to character card metadata
- **Conflict resolution** - Auto-fix similar colors with one click
- **Auto-lock consistent** - Automatically lock characters that appear consistently across 3 messages
- **Auto-delete unlocked** - Automatically delete unlocked characters after 5 messages (cleanup false positives)
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
2. Start chatting - dialogue gets colored automatically
3. If you see wrong colors detected, click **Scan** again after setting **Min** higher
4. Lock your real characters (🔒) to prevent changes
5. Click **DelUnlocked** to remove all false positives at once
6. Adjust colors with the color picker
7. Toggle **floating legend** to see colors while reading

### Common Workflows

**Fresh chat:**
1. Start chatting
2. Characters get detected automatically (if they appear 2+ times)
3. Click **Scan** to detect more
4. Lock (🔒) real characters, click **DelUnlocked** to remove false positives

**Existing chat:**
1. Click **Scan** to detect all characters
2. Increase **Min** to 3-5 if too many false positives
3. Click **Scan** again
4. Lock (🔒) your confirmed characters
5. Click **DelUnlocked** to clear the rest

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
| Auto-lock consistent | Automatically lock characters that appear across 3 consecutive messages |
| Auto-delete unlocked | Automatically delete unlocked characters after 5 messages |
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

1. Extension injects a prompt telling LLM to use `<font color>` tags
2. Regex script strips tags from AI context (it doesn't see its own coloring)
3. Extension scans for character names near dialogue and caches colors
4. Names must appear minimum threshold times before being confirmed (reduces false positives)
5. Subsequent messages include assigned colors for consistency
6. Colors persist per chat or can be saved to character cards
7. Custom thought symbols (e.g., `*`, `『』`) are instructed to be wrapped in font tags by the LLM
8. Auto-lock feature locks consistent characters after 3 messages
9. Auto-delete feature removes unlocked characters after 5 messages to clean up false positives

## Troubleshooting

### False Positives (Wrong Characters Detected)

**Problem:** The extension detects words like "Just", "At", or "At least" as characters.

**Solutions:**

1. **Increase the Min threshold** - Set it higher (3-5) to require more occurrences before auto-adding characters
   - Go to the **Min** input and change from `2` to `3` or higher

2. **Use the DelUnlocked button** - After scanning, lock your real characters (🔒), then click **DelUnlocked**
   - This removes all false positives at once while keeping your locked characters

3. **Manually delete false characters** - Click the **×** button next to each false character

**Why this happens:**
The extension looks for patterns like: `[Name] said/dialogue`. Common words can appear before dialogue markers, so they're mistakenly detected as character names. The **Min occurrence threshold** and **locking** features are designed to mitigate this.

### Character Colors Change Randomly

**Problem:** Characters keep getting new colors despite being established.

**Solution:** 
- **Lock the character** (🔒) to prevent color changes during scans
- Locked characters won't be reassigned new colors

### Colors Don't Show

**Problem:** Dialogue isn't colored even though extension is enabled.

**Solutions:**
1. Make sure **Enable** checkbox is checked
2. Verify the LLM is actually using `<font color>` tags (check raw message source)
3. Check the **Prompt Preview** to see if colors are being injected
4. Try **Reseting** or **Regenerating** colors

### Thoughts Not Colored

**Problem:** Inner thoughts wrapped in custom symbols aren't colored.

**Solutions:**
1. Make sure **Thoughts** field has your symbols (e.g., `*`)
2. The color used is the **last speaker's** color - ensure someone spoke recently
3. Check the speaker color is locked (thoughts respect the speaker's assigned color)

## License

MIT
