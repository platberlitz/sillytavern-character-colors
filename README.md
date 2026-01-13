# SillyTavern Dialogue Colors

Automatically colors character dialogue and thoughts entirely client-side - detects speakers within messages!

## Features

- **Client-Side Only**: No prompt injection, zero token usage
- **Speaker Detection**: Detects character names appearing before dialogue quotes
- **Dialogue Coloring**: Colors all quoted dialogue based on speaker
- **Thought Coloring**: Inner thoughts in *asterisks* are colored
- **Theme Modes**: Auto/Light/Dark - generates appropriate colors
- **Session Storage**: Colors stored in memory only, cleared on chat change
- **Multi-Character Support**: Handles multiple speakers within a single message

## Installation

1. Place folder in SillyTavern `data/<user>/extensions/`
2. Restart SillyTavern

## How It Works

The extension detects speakers using these patterns before dialogue quotes:
- `Name: "Dialogue"`
- `Name says "Dialogue"`
- `Name said "Dialogue"` (and other speech verbs: asks, asked, replied, answers, etc.)

Each detected speaker gets a unique color that persists within the chat session. If no speaker is detected before a quote, the message owner's color is used.

Thoughts (*text*) are colored based on the message owner.

## Usage

1. Enable "Enable coloring" in Extensions settings
2. Chat generates normally - colors appear automatically
3. Click the droplet icon (next to send button) to refresh colors
4. Use "Clear Colors" to reset and regenerate colors

## Example

```
John: "Hello there!"
Mary said: "Hi John!"
"Nice to see you both!" -> Uses message owner's color (no speaker detected)
*She smiled warmly.* -> Colored with message owner's color
```

Colors reset when switching chats (session-scoped only).
