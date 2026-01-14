# Dialogue Colors

A SillyTavern extension that automatically colors character dialogue using LLM-generated `<font color>` tags, with intelligent character detection and color management.

## Features

### Core
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color=#RRGGBB>` tags
- **Character detection** - Automatically scans messages and detects speakers from dialogue attribution
- **Per-chat memory** - Colors are saved per chat session
- **Auto-scan** - Scans for new characters after each message

### Color Management
- **Color lock** 🔒 - Lock a character's color to prevent overwrites
- **Quick swap** ⇄ - Click two characters to swap their colors
- **Brightness adjustment** - Global slider to make all colors lighter/darker
- **Undo/Redo** ↶↷ - History of color changes
- **Export/Import** - Save and load color schemes as JSON

### Palettes
- **Pastel** - Soft, light colors
- **Neon** - Vibrant, saturated
- **Earth** - Natural, warm tones
- **Jewel** - Rich, deep colors
- **Muted** - Subtle, desaturated
- **Protanopia** - Red-blind friendly
- **Deuteranopia** - Green-blind friendly
- **Tritanopia** - Blue-blind friendly

### Advanced
- **Character aliases** - Map multiple names to the same color (e.g., "Kaveh" and "the architect")
- **Per-character styles** - Bold, italic, or bold italic per character
- **Narrator color** - Separate color for narration/action text
- **Highlight mode** - Request background highlights in addition to text color
- **Auto-assign from card** - Pull character name from active ST character card
- **Dialogue statistics** - Shows dialogue count per character
- **Conflict detection** - Warns when characters have similar colors

### Technical
- **Regex auto-install** - Automatically installs a regex script to strip font tags from AI context
- **Japanese quote support** - Colors 「brackets」『double』«guillemets» in addition to standard quotes
- **Theme-aware** - Adjusts color lightness based on dark/light theme

## Installation

1. Open SillyTavern
2. Go to Extensions → Install Extension
3. Paste: `https://github.com/platberlitz/sillytavern-character-colors`
4. Click Install

## Usage

1. Enable the extension in the Extensions panel
2. Start chatting - the LLM will color dialogue automatically
3. Click **Scan** to detect characters from existing messages
4. Adjust colors by clicking the color picker next to each character
5. Use **Lock** to prevent a color from changing
6. Use **Swap** to exchange colors between characters
7. Add **Aliases** for characters with multiple names
8. **Export** your color scheme to reuse later

## UI Controls

| Button | Function |
|--------|----------|
| Scan | Scan all messages for characters |
| Clear | Remove all characters |
| Card | Add character from active card |
| ↶ | Undo last change |
| ↷ | Redo |
| Export | Save colors to JSON file |
| Import | Load colors from JSON file |
| 🔒/🔓 | Toggle color lock |
| ⇄ | Swap colors with another character |
| S | Cycle font style (normal/bold/italic) |
| + | Add alias for character |
| × | Remove character |

## Settings

- **Enable** - Toggle the extension on/off
- **Highlight mode** - Request background highlights
- **Theme** - Auto/Dark/Light color adjustment
- **Palette** - Color scheme for new characters
- **Brightness** - Global brightness adjustment (-30 to +30)
- **Narrator** - Color for narrator/action text

## How It Works

1. The extension injects a prompt instructing the LLM to use `<font color>` tags
2. A regex script strips these tags from the AI's context (so it doesn't see them in history)
3. Users see the colored text in the chat
4. The extension scans for character names near dialogue and caches their colors
5. On subsequent messages, the prompt includes assigned colors for consistency

## License

MIT

## Author

platberlitz
