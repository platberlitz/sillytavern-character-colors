# SillyTavern Character Colors

Automatically colors character dialogue and inner thoughts using prompt injection.

## Features

- **Prompt Injection**: Instructs the LLM to wrap dialogue in `<font color>` tags
- **Thought Coloring**: Inner thoughts in *asterisks* are also colored
- **Theme Modes**: Auto/Light/Dark - generates appropriate pastel colors
- **Color Persistence**: Character colors saved and reused across sessions
- **Context Stripping**: Includes regex script to remove font tags from context

## Installation

1. Place folder in SillyTavern `data/<user>/extensions/`
2. Import `regex-script.json` in Extensions > Regex
3. Restart SillyTavern

## Regex Script

The regex script strips `<font>` tags from context so they're display-only.

## How It Works

Injects a system instruction before generation telling the LLM to wrap dialogue in `<font color=#HEX>` tags with distinct pastel colors per speaker.
