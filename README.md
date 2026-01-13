# SillyTavern Character Dialogue Colors

Automatically colors character names in dialogue with theme-aware colors and character card storage.

## Features

- **Theme-aware colors**: Automatically adjusts colors for dark/light modes
- **Character card storage**: Colors are saved to character cards and persist across sessions
- **Per-chat reset**: Each new chat starts with fresh color assignments
- **Custom color support**: Define your own color palette
- **Auto-detection**: Automatically detects your current theme

## Installation

1. Download or clone this repository
2. Place the folder in your SillyTavern `public/scripts/extensions/` directory
3. Restart SillyTavern or reload extensions
4. Configure in Extensions > Character Dialogue Colors

## Configuration

### Theme Options
- **Auto-detect**: Automatically chooses colors based on your current theme
- **Dark Mode**: Optimized colors for dark backgrounds
- **Light Mode**: Optimized colors for light backgrounds  
- **Custom Colors**: Define your own hex color palette

### Default Color Palettes

**Dark Mode:**
- #FF6B35 (Hot Orange)
- #FF1493 (Deep Pink)
- #00CED1 (Dark Turquoise)
- #32CD32 (Lime Green)
- #FFD700 (Gold)
- #FF69B4 (Hot Pink)
- #8A2BE2 (Blue Violet)
- #FF4500 (Orange Red)

**Light Mode:**
- #CC4400 (Dark Orange)
- #CC0066 (Dark Pink)
- #006699 (Dark Blue)
- #228B22 (Forest Green)
- #B8860B (Dark Goldenrod)
- #C71585 (Medium Violet Red)
- #6A1B9A (Dark Violet)
- #D2691E (Chocolate)

## Usage

The extension automatically:
1. Detects character names at message start (format: "Name:")
2. Assigns theme-appropriate colors
3. Saves colors to character cards
4. Resets colors when starting new chats
5. Maintains consistency within each chat session

## Custom Colors

Enter hex codes separated by commas in the custom colors field:
```
#FF0000, #00FF00, #0000FF, #FFFF00, #FF00FF, #00FFFF
```
