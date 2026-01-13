# SillyTavern Character Colors (Client-Side)

Automatically colors character dialogue and inner thoughts entirely client-side - no context impact!

## Features

- **Client-Side Only**: No prompt injection, zero token usage
- **Dialogue Coloring**: Colors all quoted dialogue ("text", 'text', «text»)
- **Thought Coloring**: Inner thoughts in *asterisks* are colored
- **Theme Modes**: Auto/Light/Dark - generates appropriate colors
- **Session Storage**: Colors stored in memory only, cleared on chat change
- **Color Distance**: Ensures distinct colors for different characters

## Installation

1. Place folder in SillyTavern `data/<user>/extensions/`
2. Restart SillyTavern

## How It Works

- Detects character names from message blocks
- Generates distinct colors per character (pastel for dark theme, muted for light)
- Parses dialogue quotes and wraps them with colored spans client-side
- Parses *asterisked thoughts* and colors them
- Colors reset when switching chats (session-scoped only)

## Usage

1. Enable "Enable coloring" in Extensions settings
2. Chat generates normally - colors appear automatically
3. Click the droplet icon (next to send button) to refresh colors
4. Use "Clear Colors" to reset and regenerate colors

No regex scripts needed - this is pure client-side processing!
