# Dialogue Colors

A SillyTavern extension that makes the LLM color-code each character's dialogue automatically. Instantly see who's speaking at a glance with LLM-driven character detection, colorblind-friendly palettes, and optional CSS effects for dramatic text.

---

## Features

### Core
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags
- **LLM color blocks** - LLM outputs `[COLORS:Name=#RRGGBB,...]` at end of messages for reliable character detection (auto-removed)
- **Text-safe colorize fallback** - Rejects LLM rewrites that alter dialogue text or introduce escaped/extra quotes, then falls back to deterministic quote matching
- **Auto-detect nicknames/usernames** - LLM can include nicknames in parentheses: `[COLORS:Alice(xX_Alice_Xx)=#FF0000]` - these are automatically added as character aliases
- **Per-chat or global colors** - Store colors per character or share across all chats
- **Auto-lock detected characters** - Automatically lock newly detected characters (default: on)
- **Right-click/long-press reassignment** - Right-click (desktop) or long-press (mobile) on colored dialogue to reassign it to a different character with searchable dropdown (default: off)
- **Auto-sync settings** - Settings automatically sync across all devices accessing the same SillyTavern instance via SillyTavern's managed extension settings store (enabled by default)

### Color Management
- **Color lock** 🔒 - Lock a character's color to prevent changes
- **Quick swap** ⇄ - Click two characters to swap their colors
- **Avatar color extraction** - Auto-suggest colors from character avatar's dominant color
- **Brightness adjustment** - Bias newly generated/regenerated colors lighter or darker without retroactively changing established assignments
- **Theme flip** ☀/🌙 - Instantly flip all colors between dark↔light suited variants
- **Undo/Redo** ↶↷ - Full history with Ctrl+Z/Y shortcuts
- **Export/Import** - Save and load color schemes as JSON
- **Settings sync** - Export/import settings separately, or enable auto-sync to share settings across devices without writing a separate extension `settings.json`
- **Export as PNG** - Generate a theme-aware visual legend image (dark/light background)
- **Color presets** - Save, load, and delete presets via dropdown UI
- **Recolor messages** - Rewrite all existing message colors to match current assignments after changing a character's color
- **Auto-recolor** - Automatically recolor + reload chat when colors change via picker, harmony popup, regen, or theme flip (default: on)
- **Smart color suggestions** - Auto-suggests colors based on character names (e.g., "Rose" → pink)
- **Color harmony** - Double-click a color input to see complementary, triadic, and analogous suggestions
- **Custom palettes** - Generate palettes from words (optionally LLM-enhanced) or save your current character colors

### Palettes
- Pastel, Neon, Earth, Jewel, Muted, Jade, Forest, Ocean, Sunset, Aurora, Warm, Cool, Berry, Monochrome
- **Colorblind-friendly:** Protanopia, Deuteranopia, Tritanopia
- **Custom palettes** - Generate from words or save snapshots alongside the built-in ones

### Word-Based Custom Palettes
Click **Gen** next to the Palette dropdown, enter a palette name, and add optional notes. If LLM enhancement is enabled, the result is refined by the LLM; if it fails, the extension automatically falls back to the local generator.

Example prompts:
- Psychedelic
- Noir rain city
- Soft cottagecore sunrise

### CSS Effects
*Inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)*

When enabled, instructs the LLM to apply CSS transforms for dramatic effect:
- **Chaos/madness** → `rotate(2deg) skew(5deg)`
- **Magic** → `scale(1.2)`
- **Unease** → `skew(-10deg)`
- **Rage** → `uppercase`
- **Whispers** → `lowercase`

Effects are visible in chat but stripped from the prompt context.

### Advanced
- **Character aliases** - Map multiple names to same color, shown as removable chips
- **Per-character styles** - Bold, italic, or both
- **Character grouping** - Assign characters to groups, sort by group with visual headers
- **Batch operations** - Multi-select characters with checkboxes for bulk lock/unlock/delete/style
- **Narrator color** - Separate color for narration (included in color block)
- **Thought symbols** - Custom symbols (e.g., `*`, `『』`) for inner thoughts
- **Highlight mode** - Background highlights + text color
- **Card integration** - Save/load colors to character card metadata
- **Conflict resolution** - Auto-fix similar colors with detailed feedback on which pairs were fixed

### Visual
- **Floating legend** - Toggle overlay showing character→color mapping
- **Dialogue statistics** - Bar graph of who's talking most
- **Dialogue count badges** - ⭐ (50+), 💎 (100+) for frequent speakers
- **Collapsible UI sections** - Settings organized into Display, Behavior, Actions, and Characters sections
- **Mobile-optimized** - Larger touch targets and responsive layout on small screens

## What's New in 4.1.1

- **Fixed auto-sync persistence** — settings sync now uses SillyTavern's managed extension settings store instead of trying to read/write a standalone extension `settings.json`.
- **Fixed Docker/non-default user installs** — auto-sync no longer depends on extension-folder write permissions or hardcoded `default-user` file paths, which resolves the `403` save failures some users were seeing.

## What's New in 4.1.0

- **Right-click character reassignment** — Right-click colored dialogue to reassign it to a different character using a searchable dropdown of existing characters. Color updates immediately in chat. No more manual HTML editing for misattributions!
- **Settings sync** — Export/import settings separately from color data, or enable auto-sync (on by default) to automatically share settings across all devices accessing the same SillyTavern instance through SillyTavern's own settings backend. Perfect for PC + mobile via Tailscale.

## What's New in 4.0.0

- **Streamlined prompt system** — new minimal prompt mode (~40% shorter, removes redundant emphasis like "HARD RULE", "HARD RANGE")
- **Macro support** — use `{{dialoguecolors}}` macro in your system prompt for flexible placement
- **Role selection** — choose System or User injection (User role helps stubborn models like Kimi K2.5, GLM-5/5.1 with None/Merge post-processing)
- **Global behavior settings** — Depth, Role, and Mode now persist across all chats
- **Bug fixes** — brightness slider now updates unlocked characters, extension panel overflow fixed, auto-conflict resolution now recolors chat

## What's New in 3.5.2

- **Stable established colors** — once a character has an assigned color, later replies keep that exact assignment instead of re-deriving it from the current brightness slider.
- **Duplicate NPC color protection** — newly detected characters are now remapped locally if the model reuses or closely matches an existing character color.
- **Cleaner delimiter prompt text** — prompt injection now lists literal quote/thought delimiters directly, which reduces awkward phrasing that could confuse the model.

## What's New in 3.5.1

- **Safer quote handling** — the injected prompt now describes dialogue delimiters without JSON-style escaped quote syntax, which helps avoid models echoing back escaped-string formatting.
- **Text-preserving LLM colorize fallback** — LLM-assisted colorization now rejects outputs that alter message text or introduce escaped/doubled quotes like `""\"...\""` and falls back to deterministic quote matching instead.

## What's New in 3.4

- **Connection Manager profiles** — LLM Profile dropdown now uses `ConnectionManagerRequestService` to list all connection profiles and send requests directly to a selected profile without switching the global active profile. Requires SillyTavern 1.15.0+; falls back to the main chat AI on older versions.

## What's New in 3.2

- **Speaker-aware colorize fallback** — `Colorize` and the automatic fallback now resolve per-quote speakers from nearby labels/attributions and preserve established character colors instead of painting every quote with one speaker color.
- **Better recovery for non-compliant generations** — messages with no `<font color>` tags and no `[COLORS:]` block can still be colorized when speakers are inferable, while newly seen main speakers are added automatically when needed.
- **Composite speaker cleanup** — reducible labels like `Kaveh & Alhaitham` no longer become their own fallback color when those characters already exist, and stale combined entries are auto-removed from saved data.

## What's New in 3.1.8

- **Disable toast notifications** — new toggle in the Behavior section suppresses all pop-up toasts (success, info, warning) from the extension. Error toasts still show so you never miss failures. Undo toasts are also suppressed when disabled.

## What's New in 3.1.7

- **Storage Manager** — new "Storage" button in Actions lets you browse and clear stored color data across all chats. Useful for freeing localStorage or fixing corrupted entries that cause buttons to stop working. Current chat is highlighted and unchecked by default to prevent accidental self-clearing.

## What's New in 3.1.6

- **Reliable undo toasts** — destructive actions (Clear, Delete, Reset, etc.) now capture a snapshot before mutating, so clicking the undo toast always restores correctly even if chat events reset the history stack.

## Installation

1. Open SillyTavern → Extensions → Install Extension
2. Paste: `https://github.com/platberlitz/sillytavern-character-colors`
3. Click Install

## Quick Start

1. Enable the extension (checkbox at the top)
2. Start chatting - the LLM will color dialogue and output a `[COLORS:...]` block
3. Characters are detected automatically from the color block and locked by default
4. Enable right-click context menu if you want to manually assign colors
5. Right-click or long-press colored text to manually assign colors (when enabled)

### How It Works

1. Extension injects a prompt telling LLM to use `<font color>` tags
2. LLM outputs `[COLORS:Name=#RRGGBB,...]` at the end of each response
3. Extension parses the block, extracts characters/colors, and removes it from display
4. Regex scripts strip font tags and color blocks from the prompt context
5. LLM colorize fallback validates that message text is unchanged before accepting it; malformed rewrites fall back to deterministic quote matching
6. Colors persist per chat or globally (configurable)

## UI Reference

### Display Section
| Control | Function |
|---------|----------|
| **Enable** | Toggle extension on/off |
| **Show control help** | Show/hide inline help panel explaining each control |
| **Highlight mode** | Add background highlights behind colored dialogue |
| **Show floating legend** | Draggable overlay showing character→color mapping |
| **CSS effects** | Enable emotion/magic CSS transforms on dialogue |
| **Theme** | Auto/Dark/Light — controls color lightness targeting for readability (Auto detects from ST background) |
| **Palette** | Color palette used for new or regenerated character colors (17 built-in + custom) |
| **Gen** (Palette) | Generate a custom palette from the name + notes fields below |
| **+/−** (Palette) | Save current character colors as custom palette / Delete selected custom palette |
| **Palette name** | Name for the custom palette to create or save |
| **Palette notes** | Optional notes that guide generated palette style |
| **Overwrite existing** | Allow replacing an existing custom palette with the same name |
| **Brightness** | Bias newly generated or regenerated colors lighter/darker without changing established character assignments |

### Behavior Section
| Control | Function |
|---------|----------|
| **Auto-scan on chat load** | Scan existing messages for characters when opening a chat |
| **Auto-scan new messages** | Scan each newly generated message for `[COLORS:]` blocks |
| **Auto-lock detected characters** | Automatically lock newly detected characters (default: on) |
| **Auto-recolor on change** | Recolor + reload chat when colors change via picker, regen, or theme flip (default: on) |
| **Enable right-click context menu** | Right-click (desktop) or long-press (mobile) colored dialogue to assign it to a character (default: off) |
| **Disable narration** | Exclude narrator from the color prompt instructions (default: on) |
| **Share colors globally** | Use one shared color table across all chats instead of per-chat storage |
| **Enhance palettes with LLM** | Use LLM to refine generated custom palettes; falls back to local generator on failure |
| **LLM Profile** | Connection profile to use for LLM colorization and palette generation — routes requests directly without switching the active profile (requires ST 1.15.0+) |
| **Disable toast notifications** | Suppress all pop-up toast notifications from this extension (errors always show) |
| **Narrator** | Set the narrator color used in prompt instructions |
| **Clear** (Narrator) | Clear custom narrator color and return to default |
| **Thoughts** | Symbols used to detect and color inner-thought dialogue (e.g., `*`, `『』`) |
| **+** (Thought) | Add another thought symbol |
| **Clear** (Thought) | Remove all thought symbols |
| **Depth** | How many messages from the chat end to inject the color prompt (default: 4) |
| **Role** | System or User injection — User role helps models that ignore system prompts with None/Merge post-processing |
| **Mode** | Inject (auto-inject prompt at depth) or Macro (use `{{dialoguecolors}}` in your system prompt) |
| **Copy Macro** | Copy `{{dialoguecolors}}` macro to clipboard (appears when Mode is set to Macro) |

### Actions Section
| Control | Function |
|---------|----------|
| **Scan** | Scan all chat messages for `[COLORS:]` blocks, extract characters/colors, and reset dialogue counts |
| **Clear** | Remove all tracked characters and color assignments |
| **Stats** | Show dialogue statistics |
| **Recolor** | Rewrite `<font color>` tags in all messages to match current assignments and reload chat |
| **↶/↷** (Undo/Redo) | Undo/redo color-table changes (also Ctrl+Z / Ctrl+Y) |
| **Fix** | Auto-resolve colors that are too visually similar (reports which pairs were changed) |
| **Regen** | Regenerate colors for unlocked characters — uses name-based suggestions (e.g., "Rose" → pink) before falling back to palette |
| **☀/🌙** | Invert color lightness for dark↔light theme switch |
| **Preset Save/Load/Del** | Manage named color presets via dropdown |
| **Export/Import** | Backup/restore colors and settings as JSON |
| **PNG** | Export floating legend as a theme-aware PNG image |
| **+Card** | Add the current card character to the color list (skips if already present) |
| **Avatar** | Extract dominant color from the current character's avatar and assign it |
| **Save→Card** | Save color data into character card metadata |
| **Card→Load** | Load color data from character card metadata |
| **🔒All/🔓All** | Lock/unlock all characters |
| **Reset** | Reassign palette colors to all unlocked characters (random, no name-based suggestions) |
| **DelLocked** | Delete all locked characters |
| **DelUnlocked** | Delete all unlocked characters |
| **DelLeast** | Delete characters below the dialogue-count threshold |
| **DelLeast threshold** | Minimum dialogue count to keep (input next to DelLeast) |
| **DelDupes** | Delete duplicate-color characters, keeping the one with the highest dialogue count |
| **Storage** | Browse and clear stored color data across all chats — shows character names, color counts, and data sizes |

### Characters Section
| Control | Function |
|---------|----------|
| **Search** | Filter characters by name |
| **Sort** | Sort by Name, Dialogue Count, or Group |
| **Add** (name + button) | Manually add a character by typing a name — assigns a suggested color |
| **Batch bar** | Appears when characters are selected: Select All, Deselect All, Delete, Lock, Unlock, Style |
| **☐** (checkbox) | Select character for batch operations |
| **🔒** | Lock/unlock individual character color |
| **⇄** | Swap colors between two characters (click two in sequence) |
| **S** | Cycle text style: normal → bold → italic → bold+italic |
| **+** | Add an alias that maps to this character's color |
| **G** | Assign character to a group |
| **×** | Delete character |
| **Double-click color** | Show color harmony suggestions (complementary, triadic, analogous) |
| **× on alias chip** | Remove an alias |

## Auto-Imported Regex Scripts

The extension automatically imports these regex scripts:

1. **Trim Font Colors** - Removes `<font>` tags from prompt
2. **Trim Color Blocks** - Removes `[COLORS:...]` from prompt (display cleanup is handled by the extension runtime)
3. **Trim CSS Effects (Prompt)** - Strips CSS transform spans from prompt only (keeps display)

## Credits

- CSS effects feature inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)

## License

MIT
