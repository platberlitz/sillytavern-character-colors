# Dialogue Colors

A SillyTavern extension that gives each character's dialogue a consistent visual identity. Use the LLM engine to write persistent `<font color>` tags into chat text, or use the local DOM-only engine to color rendered dialogue without changing saved messages.

## Quick Start

1. Open **Dialogue Colors** in the Extensions panel. Settings sit in the tab and scroll with it. For heavier work use **Fullscreen**, which gives the sections a left-hand nav; **Escape** or the same button returns to the tab.
2. On **Current setup**, enable the extension and choose where colors are saved: **Per chat**, **Per card**, or **Global**.
3. Choose the **LLM** or **Local (DOM-only)** engine.
4. Use **Scan entire chat** to discover existing speakers, or start chatting so new speakers are detected automatically.
5. Open **Characters** to edit a speaker. Use **Keep** to pin main characters against bulk deletion, and to carry them into every chat when colors are saved **Per chat**. The card's own character is Kept automatically unless you turn that off.
6. Use the clearly labeled actions under **Process chat** when you need to discover, colorize, verify, recolor, or refresh dialogue.

## Highlights

- **Optional fullscreen settings**: the panel flows at its natural height in the extensions tab instead of inside a capped inner scroller. Fullscreen is opt-in and swaps the stacked accordions for a left-hand section nav, which collapses to a horizontal strip on narrow screens.
- **Two coloring engines**: persistent LLM formatting or reversible local DOM rendering.
- **Three storage scopes**: separate colors per chat, share them across one character card, or use one global table.
- **Reviewed scope switching**: choose whether to use, copy, merge, replace, or start an empty destination. Existing data is never overwritten merely by changing the scope selector.
- **Compact character editor**: Keep and Edit stay visible; color, lock, typography, aliases, groups, deletion, and gradients are disclosed on demand.
- **Custom gradients**: create linear, radial, or conic gradients with 2–5 stops, deterministic `dc-gradient-v1` seeds, animation, exact positions, 37 built-in presets, custom presets, preset gallery, and one-click randomization. Conic sweeps around a pivot, using both the start angle and the origin, so it reaches looks the other two types cannot: hue wheels, chromatic fringing, and single bright wedges. Presets range from conventional (`sunset-ribbon`, `ocean-current`) through hard-banded (`heraldic-bands`, `stained-glass`) to pigment and emission studies (`cinnabar-verdigris`, `orpiment-realgar`, `cherenkov-blue`, `event-horizon`, `foxfire`). Two stops sharing a position render as a hard cut rather than a blend, which is how the banded presets are built.
- **Group profiles**: define scoped group styles and automation rules. Group profiles are stored with the active color table and apply materialized styles on assignment or character creation.
- **Multi-select bulk editing & style copy/paste**: select multiple character rows to lock, keep, group, randomize, or delete in one transaction. Copy character style fields (gradient, font, text style) and paste them across rows.
- **Color-vision simulation & perceptual conflict reports**: preview how dialogue appears under protanopia, deuteranopia, tritanopia, or achromatopsia without mutating stored colors. Conflict analysis uses deterministic item, gradient-sample, and pair limits; partial reports identify omitted visuals and unexamined pairs, and only complete reports can be auto-repaired.
- **Narrator style**: configure dedicated narrator colors, gradients, and text styles. Narrator styling works across LLM prompts, DOM rendering, legend, statistics, and conflict reports.
- **Attribution reviews**: verifier suggestions are queued for explicit human review by default. Accept, edit, or reject suggestions segment by segment or in bulk.
- **Automatic NPC gradients**: optionally randomize gradients for newly discovered NPCs while excluding the current card, group cards, and user persona. Off by default.
- **Persona coloring**: color your own dialogue too. "Add my persona" under Characters → Advanced adds the active persona as a tracked character, marked with a **You** badge and sorted to the top. Once your persona has a color, its messages are rendered locally in either engine; LLM mode never writes tags into user messages or makes a request for this. "Add my persona automatically" under Automation does the adding for you and keeps the entry in step with persona switches and renames. **Keep my persona entry** marks an existing tracked persona Kept and applies Keep to later manual or automatic additions, without adding or coloring a persona by itself. **Keep each persona's color everywhere** remembers a color for every persona you use, outside the per-chat, per-card, or global table, and brings each one back in every chat: switching personas restores the new one's color, a chat played under several personas shows every one of them in its own color, and editing a persona's color anywhere updates it everywhere. Your other personas are marked with a **Persona** badge while that option is on. Independently of any option, a user message is colored whenever the name it was sent under is in the character list, not only when it matches the active persona.
- **Automatic gradients for every new character**: a separate default-off override can randomize gradients for every newly created entry.
- **Global gradient drift**: optionally animate every gradient without changing each character's individual Drift setting. Off by default.
- **Fonts and text styles**: assign installed font families and Normal, Bold, Italic, or Bold Italic styling per character. Optional remote Google Font loading is disclosed, disabled by default, and bounded when enabled.
- **Safer maintenance**: destructive actions review their targets, skip kept characters, and use recovery where available.
- **Accessible interaction**: keyboard assignment, focus-managed dialogs, visible focus, speaker labels for assistive technology, reduced-motion support, forced-color fallbacks, and responsive touch targets.
- **Import and card review**: inspect counts, merge or replace deliberately, and opt in before applying an imported storage scope.
- **Storage recovery**: the Storage Manager protects the active table, selects nothing by default, and can restore its latest archived batch.
- **Auto-sync, presets, palettes, statistics, floating legend, and PNG legend export**.

## Coloring Engines

### LLM

The extension injects formatting instructions into the chat context. The model is asked to wrap dialogue and inner thoughts in `<font color="#RRGGBB">...</font>` and end its reply with `[COLORS:Name=#RRGGBB,...]`. The extension reads that mapping and hides it from rendered output.

**Colorize missing** can add tags to the latest message or the entire chat when output was not formatted. **Recolor saved tags** rewrites existing color references across the entire chat. Gradients remain a local visual enhancement; the primary solid color stays in persisted tags as a compatible fallback and speaker identifier.

### Local (DOM-only)

Local mode attributes and colors rendered quotes and thoughts without editing `msg.mes`. It is fully reversible, but styling is visible only while the extension is active.

**Stealth speaker color blocks** can ask the model for hidden `[COLORS:...]` metadata without visible font tags. Optional LLM attribution verification can review the latest or visible rendered messages and save corrections in chat metadata.

#### Local attribution

Attribution runs entirely on your machine and needs no model calls. Each quote is resolved by the first rule that fits, strongest first:

1. A manual override you saved by right-clicking a quote.
2. A name near the quote. A speech tag or label glued to it (`Alice said, "..."`, `"...," Alice said`, `Alice: "..."`, `[Alice]:`, `**Alice**:`) is strongest, then a reporting verb bound to the name a little further off, then an action beat — the sentence that runs straight into the quote with that name acting (`Alice folded her arms. "Fine."` and its mirror `"Fine." Alice folded her arms.`). Beat verbs like *smiled*, *nodded* and *frowned* resolve a quote but never outrank a reporting verb, so a bystander reacting afterwards cannot take the line from whoever spoke. A name that only owns a prop (`Alice's coat`) or is an addressee (`turned to Alice`) is ignored, though one that owns a body part or a voice (`Alice's eyes narrowed`) counts as her acting.
3. A pronoun speech tag (`"...," she said`) bound to the nearest preceding name that is not itself a prop owner or an addressee, including one on an earlier line. This is gender-free: no pronoun-to-character mapping is stored or guessed, so it is always scored lower than a literal name.
4. The character the paragraph is about: the first name in it that opens a sentence, read through asterisked actions as well as plain narration.
5. The character acting on the line above. Models break a beat and its dialogue apart with a newline constantly, and a bare quote under `Alice folded her arms.` is hers. The walk back crosses nameless scene lines at falling confidence and stops as soon as it reaches a line that already contains speech.
6. The previous speaker, when the quote sits on the same line.
7. Whoever the previous quote called out by name, when a reply follows on a new line.
8. Alternation between recent speakers across new lines.
9. The message's own speaker.

A name the quote itself calls out (`"Alice, wait."`, `"Come here, Alice."`) marks the listener, so from rule 4 down that character is ruled out as the speaker. A name that merely appears in the sentence (`"I saw Alice yesterday."`) is not an address and changes nothing.

Every quote carries a confidence derived from the evidence that resolved it, not a fixed number per rule — distance, tag strength, and how crowded the scene is all move it, and a carried or alternated speaker can never read as more certain than the quote it came from. Right-click any quote to see its source and confidence, and to correct it. Correcting one quote pins its neighbours as they were, so a fix never cascades.

**Underline uncertain dialogue** (Engine settings) draws a dotted underline under the quotes the heuristics were least sure about, so the ones worth checking are visible at a glance.

#### Verification accuracy

Small, fast models often answer the same message differently on each run, which shows up as attribution that changes every time you press Verify. **Agreement passes** (Engine settings) verifies each message several times and keeps only the corrections that most passes agree on. A pass that proposes nothing for a segment counts as a vote to leave it alone, so with 3 passes a correction has to be proposed at least twice, with the same speaker, to be applied.

The default is 1 pass, which behaves exactly as before and costs one request. Raising it multiplies tokens per verification, so it is worth it mainly for cheap, fast models. The reported confidence is capped at the agreement rate, so a model that always claims high confidence cannot push a bare-majority result past the **auto-high** review policy.

Independently of that setting, a correction naming a speaker who is not already configured will only create that character if the name appears verbatim in the message or its recent context.

## Storage Scopes

- **Per chat**: one color table for the current chat. A durable ID is stored in chat metadata so renaming the chat does not lose its colors. Characters marked **Keep** are carried into every chat with the same character or group.
- **Per card**: one table shared by chats using the current character card or group identity.
- **Global**: one table shared everywhere.

Changing scope first saves the current table. If the destination is empty, the panel asks whether to copy the current table, start empty, or cancel. If it already has data, the panel offers to use it, merge the current table, replace it, or cancel.

Older per-card/global data remains available and is migrated without destructive rewrites. Importing older settings preserves the active scope unless the review explicitly offers and you approve a saved scope change.

## Character Management

The **Characters** section searches names, aliases, groups, fonts, and status. Sorting is available by name, dialogue activity, or group.

- **Keep**: pins an entry so clear and bulk-delete actions skip it. Under **Per chat** storage a pinned character is also added to every chat with the same character or group, keeping the exact color you gave them, so a new chat no longer starts empty. Turning Keep off stops that everywhere. The character on the current card (every member, in a group chat) is Kept automatically by default; see **Keep the card's character** under Appearance and Automation.
- **Edit**: reveals the full character editor.
- **Color and Harmony**: choose a color directly or open keyboard-accessible complementary, triadic, and analogous suggestions.
- **Lock**: prevents regeneration and reset from changing that character. Locking has no deletion side effects.
- **Swap**: exchanges complete color and gradient data with another character.
- **Rename**: change the character's primary name. **Add Alias** keeps the primary name and adds another name that resolves to it.
- **Style, Font, Group**: set typography and metadata directly.
- **Gradient**: enable, randomize, configure, animate, or apply a reusable preset.
- **Delete**: reviews the target first and remains blocked while Keep is active.

Adding an existing canonical name or alias reveals its current row instead of silently recoloring it.

## Process Chat

- **Scan entire chat**: discover speakers and update tracked dialogue activity.
- **Colorize missing** (LLM): add missing font tags to the latest message or entire chat. Messages the model colored only partially are completed locally, segment by segment, leaving the model's own tags untouched.
- **Verify attribution** (Local): ask the selected profile to verify the latest or visible messages.
- **Recolor saved tags** (LLM): rewrite existing tags across the entire chat after reviewed confirmation.
- **Refresh local colors** (Local): reapply current render-only styles.
- **Statistics**: review attributed dialogue segments. Counts can differ between engines because attribution methods differ.
- **Clear unpinned**: review and remove every entry not protected by Keep.

## Appearance and Automation

- Choose the color brightness — Auto (match theme), Bright (for dark themes), or Dark (for light themes) — and a palette for newly generated colors. Auto reads the composited chat surface; forcing a mode overrides both the palette's lightness range and the readability target, so it is the escape hatch when a theme painted only by a background image is detected wrong.
- Adjust the current table's brightness; the value previews while dragging and applies when released. The slider moves colors a share of the way toward the active mode's lightness limit rather than adding fixed steps, and lifts saturation as they lighten, so characters stay tellable apart at every position instead of converging on one pale tone at the top of the range.
- Enable dialogue highlights, the floating legend, automatic recoloring after edits, or bounded remote Google Font loading. Remote font requests are off by default.
- Bold all colored text renders every colored dialogue, narrator, and font-tag segment in bold. Per-character italic is kept, and turning it off restores each character's own text style.
- Effective colors are adjusted for at least 4.5:1 text contrast against the rendered chat surface in Auto, or against the forced mode's reference surface. Speaker metadata remains available to assistive technology without adding visible name tags to dialogue.
- Scan on load only when the current character list is empty, or scan each new message.
- Automatically lock detected speakers, assign random gradients to new NPCs or every new character, and optionally drift every gradient. Generated gradients are kept perceptually distinct from the colors other characters already use.
- **Keep the card's character** (on by default): the character the current card is for — an Aventurine card keeps Aventurine — is marked Keep when its entry is created and again whenever a chat loads, so it survives clears and, under Per chat storage, follows you into every chat with that card. In a group chat every member counts. Turn it off to manage Keep on card characters by hand; it never adds a character or assigns a color by itself.
- Optionally clear every character except those marked **Keep** when a new chat starts. This is off by default.
- Enable manual dialogue reassignment by pointer, long press, or keyboard.
- Complete partly colored messages (LLM engine, on by default): when the model tags only some of a message's dialogue, the uncolored lines are attributed and colored locally as the message arrives — no extra LLM request.
- Reduce routine success notifications without suppressing required validation and safety feedback.

## Manual Dialogue Reassignment

When enabled, right-click or long-press eligible dialogue to assign it. Keyboard users can Tab to one dialogue target per message, use arrow keys to move between that message's segments, then press **Shift+F10** or the **Context Menu** key.

Local-mode assignments are stored as per-chat quote overrides. LLM-mode assignments update compatible persisted font tags. Assignment dialogs validate names, support Escape, and return focus after closing.

## Style Library

- Save, load, and delete complete assignment presets.
- Generate custom palettes from a name and mood notes, or save current colors as a palette.
- Apply 37 built-in gradient presets or manage reusable custom gradient presets from a character's gradient editor.
- Export/import color data and settings as JSON. Imports are analyzed before any changes are applied.
- Build portable **Style packs** (`dialogue-colors-style-pack` v1) from selected custom palettes, palette metadata, custom gradient presets, optional assignment presets, and safe appearance values. This format is separate from the internal color schema version.
- Style-pack files are local-only and reviewed before installation. Palette, gradient, and assignment-preset conflicts can keep, rename, or replace per category; assignment application and appearance changes are explicit opt-ins.
- Style packs never carry storage scope, auto-sync, connection profiles, prompts, attribution/automation settings, UI positions, URLs, CSS, or font files. Font family names in optional assignment presets are shown during review; they can trigger bounded Google Fonts requests only when remote font loading has been explicitly enabled.

## Storage, Cards, and Sync

- **Save to card** writes the current normalized color table to the character card.
- **Review card data** shows the payload before merge or replacement; automatic empty-table seeding imports colors only.
- **Auto-sync** transports settings, scoped tables, palettes, assignment presets, gradient presets, and UI state.
- **Storage Manager** lists Per chat, Per card, and Global tables with counts and dates. It cannot archive the active table and stores one recoverable archive batch.

**Per card** names a scope, not a destination: it keys one table to the character card's identity inside the extension's own settings. Nothing is written into the card file unless you press **Save to card**. Colors, scoped tables, and settings live in SillyTavern's settings; manual quote reassignments and attribution verdicts live in chat metadata.

## Maintenance and Danger Zone

Maintenance provides Undo/Redo, similar-color repair, unlocked-color regeneration, gradient re-randomization, theme flipping, and reviewed setting-default restoration. Re-randomizing gradients skips locked characters and characters without a gradient.

Danger Zone deletion tools show target and pinned counts before acting:

- Delete locked or unlocked entries.
- Delete entries below a dialogue-segment threshold.
- Delete duplicate primary colors.

Reset unlocked colors and Lock/Unlock All are reviewed state changes rather than deletion tools. Keep protection applies to deletion and clearing.

## Prompt Configuration

LLM mode supports prompt depth, system/user role, and three delivery modes:

- **Inject automatically**: add instructions on each generation.
- **Use macro manually**: expose `{{dialoguecolors}}` for placement in your own prompt.
- **Use the colorize profile**: send nothing to the model that writes the reply, and color each reply afterwards in a separate request on the **Colorize profile**. Pick a profile first; without one the second request goes to the main chat AI.

The two connection profiles cover different requests. **Colorize profile** is used by the Colorize button, automatic colorizing, palette generation, and the delivery mode above; **Verify profile** is used only by attribution verification. In Inject and Macro delivery the reply model colors as it writes, so neither profile is called for that.

**Switch to macro when detected** is on by default. It scans your chat completion preset prompts, system prompt, story string, and author's note for `{{dialoguecolors}}`, and delivers through the macro whenever it finds one, so placing the macro yourself does not also inject a second copy of the instructions. Only preset prompts enabled in the current prompt order count, and a mention inside a `{{// }}` comment is ignored, since neither reaches the model. It does not read World Info or character cards. Turn it off to always inject.

## Installation

1. Open SillyTavern, then go to Extensions and choose Install Extension.
2. Paste `https://github.com/platberlitz/sillytavern-character-colors`.
3. Click Install.

## Notes

- Storage and import/export preserve gradients, aliases, styles, groups, locks, fonts, Keep state, custom gradient presets, and settings. Style packs additionally round-trip custom palette metadata when palettes are selected.
- DOM-only quote overrides are stored in chat metadata and ignored if the source message changes, preventing stale assignment to the wrong quote.
- Composite speaker labels such as `Alice & Bob`, `Alice/Bob`, or `Alice and Bob` are split and attributed individually.
- Ctrl/Cmd+Z and redo operate on extension history while focus is outside text-editing fields.
- Gradient drift respects Reduce Motion, forced colors, unsupported clipping, and print output.

## Troubleshooting

- **Prose feels worse in LLM mode**: use a system prompt role, increase prompt depth, use the manual macro, or switch to Local mode.
- **The model ignores color tags**: confirm the engine is LLM and the extension is enabled. Try a different prompt role or use Colorize missing.
- **LLM mode never colors on its own, and the read-only Macro text box is showing while the dropdown says Inject automatically**: the extension believes `{{dialoguecolors}}` is already in your prompt and stops injecting. Versions before 5.12.1 counted any mention in the preset, including one inside a `{{// }}` comment or in a disabled prompt, so a preset README that merely talks about the macro silenced the injection while delivering nothing. Only enabled prompts outside comments count now; if a preset you did not write still triggers it, turn off **Switch to macro when detected**.
- **The tracked line counts jump after something touches a message**: fixed in 6.0.3. The counts used to be added up as each message arrived, before local completion had finished adding its own tags, so they sat below the truth until the next full recount - which anything that edits a message triggers, in-chat agents included. Both engines recompute the counts from the chat now, so they only move when the chat does.
- **Local colors disappear on refresh**: Local mode is render-only. Use LLM mode for persisted solid tags.
- **Auto-colorize does not run**: it only triggers when the latest colorable message contains no color block or existing font tags. Your own messages are only colorable once your persona is in the character list.
- **My persona has no color in LLM mode**: add the active persona under Characters, or enable **Add my persona automatically**. Once the tracked entry has a color, LLM mode renders matching user messages locally without editing their text or making an LLM call. **Keep my persona entry** only controls Keep; it does not add a persona or assign a color.
- **I play several personas and only the active one is colored**: update to 6.0.0 or later. Earlier versions painted only the active persona's messages; now any user message whose name is in the character list is painted, and **Keep each persona's color everywhere** gives every persona its own remembered color. If a persona that spoke in the chat has no entry, turn that option on: its color is restored the next time the chat loads.
- **The card's character cannot be deleted, or comes back Kept**: **Keep the card's character** is on by default. Turn it off under Appearance and Automation, or un-Keep the entry and delete it; while the option is on, the entry is Kept again the next time the chat loads.
- **An LLM profile is unavailable**: connection profiles require a compatible SillyTavern ConnectionManagerRequestService.
- **A selected font is not visible**: install it locally, or explicitly enable remote Google Font loading under Appearance and Automation.
- **Gradient drift is paused**: the device's Reduce Motion preference intentionally disables it.
- **Characters detected at a high brightness setting all look alike**: versions before 5.8.3 pushed every color onto the target surface's lightness limit and stored a black base color beside it. Loading a chat repairs those entries in place. Any character whose displayed color had already been flattened to grey has nothing left to recover from and needs recoloring by hand.
- **A greyscale palette repeats a shade**: lightness is the only thing separating characters in a palette with no hue, and full darkening on a dark surface leaves only a few readable lightness steps for the whole cast. Ease the brightness slider back, or pick a palette with hue in it.
- **My character card's creation date keeps resetting**: SillyTavern rewrites the card file itself every time you open or start a chat, so the file is replaced whether or not this extension is installed (`openCharacterChat` and `doNewChat` in `public/script.js` both end in `createOrEditCharacter`). This extension only writes a card when you press **Save to card**.
- **A tool-call message shows colored JSON or a `[COLORS:]` line, or a "SillyTavern System" character appeared in the list**: versions before 5.8.4 treated SillyTavern's tool-call messages as dialogue, so LLM mode wrapped the JSON payload in font tags, appended a color block, and registered the host's system user as a character. Opening the chat restores those messages and removes the entry, or press **Repair** under Process chat to do it on demand. An entry you had marked Keep is left alone, as is any entry still used elsewhere in the chat.
- **A message's HTML is mangled, or a `<div>` shows up as literal text**: versions before 5.9.4 read the double quotes inside an HTML tag as dialogue, so LLM mode wrapped `class="stat-block"` in a font tag and destroyed the element. SillyTavern hides those quotes from its own `<q>` pass, and the extension now hides them the same way, in both engines. Opening the chat removes the misplaced tags from messages the extension itself wrote, leaving the colors on the surrounding dialogue alone; a message carrying markup this extension did not write is left untouched rather than guessed at.
- **"Colors saved" keeps reverting to Per card**: two faults before 5.9.6, either of which was enough. The stored settings snapshot was rebuilt with a storage scope in it even when the saved data had never recorded one, so a record written before the setting existed was stamped with Per card the first time it was read, and any partial snapshot applied over the live one reset the choice. Separately, with Auto-sync on, the sync writer published only its own half of the record and left the half a reload actually restores from empty, so the chosen scope was not there to read on the next start. Both halves are now written together, a reload falls back to whichever half holds the value, and the scope is only read back when it was genuinely saved. If your setting had already been overwritten, set it once more and it will stick.
- **Something is saved on every chat load**: it should not be. The extension writes settings only when a color, setting, or newly discovered character actually changes, and writes chat metadata only when a reassignment or verification verdict actually changes. Per-chat dialogue tallies are recomputed on load and are not a reason to save. The exceptions are the tool-call and HTML repairs above, each of which writes once per damaged chat and then never again.

## License

MIT
