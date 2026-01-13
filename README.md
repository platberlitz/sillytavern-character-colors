# SillyTavern Dialogue Colors

Automatically colors character dialogue and thoughts via LLM prompt injection - consistent colors per chat!

## Features

- **Prompt Injection**: Instructs LLM to use `<font color>` tags for dialogue/thoughts
- **LLM Detection**: LLM detects and assigns unique colors to each named character
- **Persistent per Chat**: Colors saved per chat session in localStorage
- **Context Clean**: Regex script strips font tags from context (minimal token impact)
- **Thought Coloring**: Inner thoughts in *asterisks* are also colored
- **Theme Modes**: Auto/Light/Dark - instructs LLM to generate appropriate colors
- **Color Tracking**: Scans messages to track which character uses which color

## Installation

1. Place folder in SillyTavern `data/<user>/extensions/`
2. Import `regex-script.json` in Extensions > Regex
3. Restart SillyTavern

## How It Works

**Step 1: Prompt Injection**
The extension injects a system prompt before each generation telling the LLM:
- Wrap all dialogue in `<font color=#RRGGBB>` tags
- Use distinct colors for each character
- Reuse established colors (tracked per chat)
- Generate light pastel colors for dark themes, dark muted for light

**Step 2: LLM Generates Colored Output**
LLM automatically detects speakers and colors their dialogue:
```
<font color=#abc123>"Hello!"</font> <font color=#abc123>*She smiled.*</font>
<font color=#def456>"Nice to meet you!"</font> <font color=#def456>*He nodded.*</font>
```

**Step 3: Extension Tracks Colors**
After each message, the extension:
- Scans for all `<font color>` tags
- Associates colors with character names from message headers
- Saves color assignments to localStorage (per chat ID)
- Updates prompt with "Established colors" list

**Step 4: Regex Script (Important!)**
The included regex script strips `<font>` tags from context so colors don't consume tokens. Colors are display-only in chat, but not sent back to LLM.

## Usage

1. Enable "Enable color injection" in Extensions settings
2. LLM will start coloring dialogue in new messages
3. Click "Scan" button to extract colors from existing messages
4. Each chat maintains its own color assignments
5. Switching chats loads different color sets

## How LLM Detects Characters

The LLM is instructed to:
- Detect any named character/speaker in the message
- Assign them a unique hex color (#RRGGBB)
- Use the same color consistently for each character
- Reuse colors from the "Established colors" list

For example, if Mary is established as `#aabbcc`, any future dialogue from Mary will use that color.

## Manual Overrides

- Edit colors: Click color picker in character list to change manually
- Clear colors: Use "Clear Colors" button to reset for current chat
- Refresh prompt: Click droplet icon to scan messages and update LLM instruction

## Example Output

```
Chat with Alice and Bob:

Message 1 (Alice):
<font color=#ff88aa>"Hi Bob!"</font> <font color=#ff88aa>*She waved excitedly.*</font>

Message 2 (Bob):  
<font color="#66aaff>"Hey Alice!"</font> <font color="#66aaff">*He smiled back.*</font>

Message 3 (Alice):
<font color=#ff88aa>"How are you?"</font> <- Same color as before!
```

Colors are consistent within chat, reset when switching chats.
