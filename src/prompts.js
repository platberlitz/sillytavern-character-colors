// prompts.js - extracted from index.js (mechanical split)
import { resolveCharacterKeyByNameOrAlias } from './color-blocks.js';
import { normalizeRegistryIdentity, normalizeRegistryIdentityName } from './group-profiles.js';
import { applyThemeReadabilityAndBrightness, getBrightnessOffset, getBrightnessTargetLightnessRange, getCustomPaletteMeta, getCustomPalettes, getEntryEffectiveColor, getPersonaName, getThemeLightnessBounds } from './palettes.js';
import { getNarratorVisual } from './narrator-style.js';
import { escapeHtml, extension_prompt_roles, extension_prompt_types, extension_settings, getContext, power_user, promptManager, setExtensionPrompt } from './st-api.js';
import { MODULE_NAME, characterColors, isDomEngine, settings } from './state.js';
import { normalizeAliases, normalizeHexColor } from './utils.js';

export let injectDebouncedTimer = null;
let promptInjectionActive = false;

export const PROMPT_THOUGHT_DELIMITER_PAIRS = Object.freeze({
    '(': ')',
    '[': ']',
    '{': '}',
    '<': '>',
    '「': '」',
    '『': '』',
    '【': '】',
    '《': '》',
    '〈': '〉',
    '（': '）',
    '［': '］',
    '｛': '｝',
    '“': '”',
    '‘': '’',
    '«': '»',
    '‹': '›',
});

export function normalizePromptThoughtSymbols(thoughtSymbols) {
    // Accepts a bare run of characters ("*\"") or a comma-separated list ("*, \"").
    // Downstream consumers (buildDialogueRegex character classes, delimiter pairing)
    // only support single-character delimiters, so tokens are flattened per character.
    const tokens = Array.isArray(thoughtSymbols)
        ? thoughtSymbols
        : String(thoughtSymbols ?? '').split(',');
    const symbols = [];
    for (const token of tokens) {
        for (const symbol of formatPromptLiteralSymbol(token)) {
            if (symbol.trim()) symbols.push(symbol);
        }
    }
    return [...new Set(symbols)];
}

export function getPromptThoughtDelimiterPairs(thoughtSymbols) {
    const symbols = normalizePromptThoughtSymbols(thoughtSymbols);
    const pairs = [];
    for (let i = 0; i < symbols.length; i++) {
        const open = symbols[i];
        const pairedClose = PROMPT_THOUGHT_DELIMITER_PAIRS[open];
        const next = symbols[i + 1];
        const close = pairedClose || open;
        pairs.push({ open, close });
        if (pairedClose && next === pairedClose) i++;
    }
    return pairs;
}

export function formatThoughtDelimiterPattern(pair) {
    return `${pair.open}...${pair.close}`;
}

export function buildThoughtSymbolColorPromptExample(thoughtSymbols) {
    const [pair] = getPromptThoughtDelimiterPairs(thoughtSymbols);
    return pair ? `<font color="#aabbcc">${pair.open}I should run.${pair.close}</font>` : '';
}

export function buildColorPromptExample(thoughtSymbols) {
    const thoughtExample = buildThoughtSymbolColorPromptExample(thoughtSymbols);
    return thoughtExample
        ? `<font color="#aabbcc">"Hello."</font> and ${thoughtExample}`
        : '<font color="#aabbcc">"Hello."</font>';
}

export function buildThoughtSymbolTrackingPrompt(thoughtSymbols) {
    const patterns = getPromptThoughtDelimiterPairs(thoughtSymbols).map(formatThoughtDelimiterPattern).join(', ');
    return patterns ? `Inner-thought delimiters ${patterns} belong to the surrounding speaker; include them in the same color block as that speaker's dialogue.` : '';
}

export function buildThoughtSymbolColorPromptRule(thoughtSymbols) {
    const pairs = getPromptThoughtDelimiterPairs(thoughtSymbols);
    const patterns = pairs.map(formatThoughtDelimiterPattern).join(', ');
    const example = buildThoughtSymbolColorPromptExample(thoughtSymbols);
    const [pair] = pairs;
    if (!patterns || !example) return '';
    return `Thought delimiter HARD RULE: color every ${patterns} span as one unit; opening and closing delimiters must be inside the same <font> tag. Correct: ${example}. Wrong: ${pair.open}<font color="#aabbcc">I should run.</font>${pair.close}.`;
}

export function formatColorBlockName(entry) {
    const name = normalizeRegistryIdentityName(entry?.name);
    if (!name) return '';
    // A name containing block delimiters cannot round-trip through ingest;
    // skip it rather than emit a corrupt [COLORS:] block.
    if (/[\[\]=,()]/.test(name)) return '';
    const nameKey = name.toLowerCase();
    const aliases = normalizeAliases(entry.aliases)
        .filter(alias => alias.toLowerCase() !== nameKey)
        .filter(alias => !/[\[\]=,()]/.test(alias));
    return `${name}${aliases.map(alias => `(${alias})`).join('')}`;
}

export function formatColorBlockPair(name, color, sourceEntry = null) {
    const normalizedColor = normalizeHexColor(color, null);
    if (!normalizedColor) return '';
    const key = sourceEntry ? '' : resolveCharacterKeyByNameOrAlias(name);
    const blockName = formatColorBlockName(sourceEntry || (key ? characterColors[key] : { name }));
    return blockName ? `${blockName}=${normalizedColor}` : '';
}

function getPromptPersonaIdentities() {
    try {
        const personas = power_user?.personas;
        if (!personas || typeof personas !== 'object') return null;
        const identities = new Set(Object.values(personas)
            .filter(value => typeof value === 'string')
            .map(value => normalizeRegistryIdentity(value))
            .filter(Boolean));
        const activeIdentity = normalizeRegistryIdentity(getPersonaName());
        const inactiveIdentities = new Set(identities);
        inactiveIdentities.delete(activeIdentity);
        return { activeIdentity, inactiveIdentities };
    } catch {
        return null;
    }
}

export function filterPromptCharacterEntries(entries = Object.values(characterColors)) {
    const personaState = getPromptPersonaIdentities();
    if (!personaState?.inactiveIdentities.size) return entries;

    return entries.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [entry];
        const identities = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
            .map(identity => normalizeRegistryIdentity(identity))
            .filter(Boolean);
        const isActivePersona = personaState.activeIdentity && identities.includes(personaState.activeIdentity);
        if (personaState.inactiveIdentities.has(normalizeRegistryIdentity(entry.name)) && !isActivePersona) return [];
        if (!Array.isArray(entry.aliases)) return [entry];
        const aliases = entry.aliases.filter(alias => !personaState.inactiveIdentities.has(normalizeRegistryIdentity(alias)));
        return aliases.length === entry.aliases.length ? [entry] : [{ ...entry, aliases }];
    });
}

export function buildCurrentColorPairsList() {
    const pairs = filterPromptCharacterEntries(Object.values(characterColors))
        .map(entry => formatColorBlockPair(entry?.name, getEntryEffectiveColor(entry), entry))
        .filter(Boolean);
    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    if (narrator) pairs.push(formatColorBlockPair('Narrator', narrator.color));
    return pairs.join(',');
}

export function buildColorMetadataPromptLines(options = {}) {
    const usageBlockMode = options.usageBlockMode || 'used';
    const currentPairs = buildCurrentColorPairsList();
    const coloredContent = getNarratorVisual(settings, applyThemeReadabilityAndBrightness)
        ? 'dialogue/thought/narration'
        : 'dialogue/thought';
    const lines = currentPairs
        ? [`Known colors (reuse exact names/colors; keep aliases with their canonical name): ${currentPairs}`]
        : [];
    lines.push(usageBlockMode === 'new'
        ? 'Append one final [COLORS:Name=#RRGGBB,...] line only for speakers not already listed in Known colors; omit it if none.'
        : `If any ${coloredContent} is colored, append one final [COLORS:Name=#RRGGBB,...] line listing every colored speaker, including known speakers; otherwise omit it.`);
    return lines;
}

export function buildLLMColorizeRules(extraRule = '') {
    const rules = [
        '- Wrap every complete dialogue and inner-thought span in <font color="#RRGGBB">...</font>.',
        '- For delimiter spans, the opening and closing delimiters must be inside the same <font> tag.',
        '- Do not change, add, or remove any text; only insert color tags.',
        '- Do not escape or alter quotes or delimiters.',
        '- Never place a color tag inside an HTML tag: attribute values such as class="row" are markup, not dialogue.',
        '- Do not output markdown code fences, commentary, or explanations.',
    ];
    if (extraRule) rules.push(extraRule);
    return rules;
}

export const PALETTE_DESCRIPTIONS = {
    pastel: 'Use soft pastel tones.',
    neon: 'Use vivid neon colors.',
    earth: 'Use earthy, natural tones.',
    jewel: 'Use rich jewel tones.',
    muted: 'Use muted, desaturated tones.',
    jade: 'Use jade/teal greens.',
    forest: 'Use forest/woodland greens.',
    ocean: 'Use ocean/aquatic blues.',
    sunset: 'Use sunset colors (oranges, pinks, golds).',
    aurora: 'Use aurora/northern lights purples and greens.',
    warm: 'Use warm tones (reds, oranges, yellows).',
    cool: 'Use cool tones (blues, teals, purples).',
    berry: 'Use berry/magenta shades.',
    monochrome: 'Use only grayscale.',
    protanopia: 'Use colorblind-safe colors (protanopia type).',
    deuteranopia: 'Use colorblind-safe colors (deuteranopia type).',
    tritanopia: 'Use colorblind-safe colors (tritanopia type).',
};

export function getThoughtDelimiterSymbols() {
    return normalizePromptThoughtSymbols(settings.thoughtSymbols);
}

export function formatPromptLiteralSymbol(symbol) {
    return String(symbol ?? '');
}

export function buildCustomPalettePrompt() {
    if (!settings.colorTheme?.startsWith('custom:')) return '';
    const paletteName = settings.colorTheme.slice(7);
    if (!paletteName) return '';
    const customs = getCustomPalettes();
    const palette = customs[paletteName];
    if (!Array.isArray(palette) || !palette.length) return '';
    const meta = getCustomPaletteMeta();
    const notes = meta?.[paletteName]?.notes?.trim() || '';
    const colors = palette.map(c => normalizeHexColor(c, null)).filter(Boolean).join(', ');
    if (!colors) return '';
    const notesPart = notes ? ` Note: ${notes}.` : '';
    return `Use palette "${paletteName}": ${colors}.${notesPart} Prefer these for new characters.`;
}

export function buildMinimalPromptInstruction() {
    if (!settings.enabled) return '';
    const { mode, minLightness, maxLightness } = getThemeLightnessBounds();
    const thoughtSymbols = getThoughtDelimiterSymbols();
    const delimiterSymbols = [...new Set(['"', ...thoughtSymbols])];
    const delimiterList = delimiterSymbols.map(formatPromptLiteralSymbol).join(', ');
    const brightnessOffset = getBrightnessOffset();

    const parts = [
        '[Dialogue Colors — strict output]',
        'Only add <font color="#RRGGBB">...</font> tags to dialogue/thought spans.',
        `- Delimiters: ${delimiterList}`,
        `- Example: ${buildColorPromptExample(thoughtSymbols)}`,
    ];
    if (thoughtSymbols.length) {
        parts.push(`- ${buildThoughtSymbolColorPromptRule(thoughtSymbols)}`);
    }
    parts.push(
        '- Preserve exact text; do not add, remove, escape, or move quotes/delimiters.',
        '- Never place a color tag inside an HTML tag: attribute values such as class="row" are markup, not dialogue.',
        '- No code fences, commentary, or explanations.',
        mode === 'dark'
            ? `- Use readable colors for a dark background (${minLightness}-${maxLightness}% lightness).`
            : `- Use readable colors for a light background (${minLightness}-${maxLightness}% lightness).`
    );
    if (brightnessOffset !== 0) {
        // The raw slider value used to be handed over as a lightness bias, and a large one read
        // as "pick white". State the band the colors land in, and that hues still have to be
        // told apart once they get there.
        const biased = getBrightnessTargetLightnessRange();
        parts.push(`- New-character color bias: keep lightness within ${biased.minLightness}-${biased.maxLightness}% and saturation high enough that hues stay distinct.`);
    }

    const customPalettePrompt = buildCustomPalettePrompt();
    if (customPalettePrompt) {
        parts.push(`- ${customPalettePrompt}`);
    } else {
        const paletteDesc = PALETTE_DESCRIPTIONS[settings.colorTheme];
        if (paletteDesc) parts.push(`- ${paletteDesc}`);
    }

    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    if (narrator) {
        parts.push(`- Narrator text: <font color="${narrator.color}">...</font>.`);
    }
    if (settings.highlightMode) {
        parts.push('- Add a subtle background highlight to colored spans when it improves readability.');
    }

    parts.push(...buildColorMetadataPromptLines());
    return parts.join('\n');
}

export function buildDomStealthColorsInstruction() {
    if (!settings.enabled) return '';
    const { mode, minLightness, maxLightness } = getThemeLightnessBounds();
    const thoughtSymbols = getThoughtDelimiterSymbols();
    const thoughtSymbolTrackingPrompt = buildThoughtSymbolTrackingPrompt(thoughtSymbols);
    const brightnessOffset = getBrightnessOffset();

    const parts = [
        '[Dialogue Colors — metadata only]',
        'Write the reply normally. Do not add visible <font> tags, CSS color formatting, or color commentary in the reply text.',
    ];
    parts.push(...buildColorMetadataPromptLines({ usageBlockMode: 'new' }));
    parts.push(
        mode === 'dark'
            ? `- Use dark-background colors (${minLightness}-${maxLightness}% lightness) when choosing new colors.`
            : `- Use light-background colors (${minLightness}-${maxLightness}% lightness) when choosing new colors.`
    );
    if (brightnessOffset !== 0) {
        // The raw slider value used to be handed over as a lightness bias, and a large one read
        // as "pick white". State the band the colors land in, and that hues still have to be
        // told apart once they get there.
        const biased = getBrightnessTargetLightnessRange();
        parts.push(`- New-character color bias: keep lightness within ${biased.minLightness}-${biased.maxLightness}% and saturation high enough that hues stay distinct.`);
    }
    const customPalettePrompt = buildCustomPalettePrompt();
    if (customPalettePrompt) {
        parts.push(`- ${customPalettePrompt}`);
    } else {
        const paletteDesc = PALETTE_DESCRIPTIONS[settings.colorTheme];
        if (paletteDesc) parts.push(`- ${paletteDesc}`);
    }
    if (thoughtSymbolTrackingPrompt) parts.push(`- ${thoughtSymbolTrackingPrompt}`);
    return parts.join('\n');
}

export function buildColoredPromptPreview() {
    if (!settings.enabled) return '<span style="opacity:0.5">(disabled)</span>';
    if (!isDomEngine() && getEffectivePromptMode() === 'profile') {
        return settings.llmConnectionProfile
            ? '<span style="opacity:0.5">(colorize profile colors each reply: nothing is sent to the reply model)</span>'
            : '<span style="opacity:0.5">(no colorize profile selected: the main chat AI colors each reply in a second request)</span>';
    }
    if (isDomEngine()) {
        if (settings.domStealthColors) return '<span style="opacity:0.5">(local DOM engine + stealth colors block)</span>';
        return '<span style="opacity:0.5">(local DOM engine: no prompt injected)</span>';
    }
    const entries = filterPromptCharacterEntries(Object.values(characterColors));
    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    if (!entries.length && !narrator) return '<span style="opacity:0.5">(no characters)</span>';
    return [
        ...entries.map(v => `<span style="color:${getEntryEffectiveColor(v)}">${escapeHtml(v.name)}</span>`),
        ...(narrator ? [`<span style="color:${narrator.color}">Narration</span>`] : []),
    ].join(', ');
}

function updatePromptUi() {
    const preview = document.getElementById('dc-prompt-preview');
    if (preview) preview.innerHTML = buildColoredPromptPreview();
    updateSystemPromptDisplay();
}

const DIALOGUE_COLORS_MACRO_PATTERN = /\{\{\s*dialoguecolors\s*\}\}/i;

// A {{// ...}} comment never reaches the model, so a macro written inside one (a
// preset README noting "added {{dialoguecolors}}") is not delivery. Comments hold
// nested macros, so the closer is the "}}" that returns the brace depth to zero,
// not the first one.
export function stripMacroComments(text) {
    let out = '';
    let cursor = 0;
    for (;;) {
        const start = text.indexOf('{{//', cursor);
        if (start === -1) return out + text.slice(cursor);
        out += text.slice(cursor, start);
        let depth = 0;
        let i = start;
        while (i < text.length) {
            if (text.startsWith('{{', i)) { depth++; i += 2; continue; }
            if (text.startsWith('}}', i)) { depth--; i += 2; if (!depth) break; continue; }
            i++;
        }
        cursor = i;
    }
}

// Places a user can realistically type {{dialoguecolors}} by hand: the chat
// completion preset prompts, the text completion system prompt and story
// string, and the author's note (chat override first, global default second).
// Only prompts enabled in the active prompt order are sent, so only those
// count; a disabled one holding the macro would otherwise silence the
// injection while delivering nothing. The live prompt manager lives in
// SillyTavern's OpenAI module, not on the context, so it is imported through
// st-api.js. When the manager is missing, uninitialized, or throws, fail open:
// keep the injection instead of trusting prompts whose delivery is unknown.
// ponytail: text scan only. It does not read World Info or character cards,
// which load asynchronously, and it does not check which API is active.
function collectUserPromptSources() {
    let context = null;
    try {
        context = getContext?.();
    } catch {
        context = null;
    }
    const sources = [
        power_user?.sysprompt?.content,
        power_user?.context?.story_string,
        context?.chatMetadata?.note_prompt,
        extension_settings?.note?.default,
    ];
    let presetPrompts = null;
    try {
        if (promptManager?.activeCharacter && typeof promptManager.getPromptsForCharacter === 'function') {
            presetPrompts = promptManager.getPromptsForCharacter(promptManager.activeCharacter, true);
        }
    } catch {
        presetPrompts = null;
    }
    if (Array.isArray(presetPrompts)) {
        for (const prompt of presetPrompts) sources.push(prompt?.content);
    }
    return sources;
}

export function promptHasDialogueColorsMacro() {
    return collectUserPromptSources().some(value => typeof value === 'string' && DIALOGUE_COLORS_MACRO_PATTERN.test(stripMacroComments(value)));
}

// The dropdown is the manual choice; auto-detection can upgrade 'inject' to
// 'macro' so the instruction is not delivered twice when the macro is present.
// 'profile' outranks the detection: the reply model is not asked to color at all,
// so a macro sitting in a preset must not deliver the instruction behind its back.
export function getEffectivePromptMode() {
    if (settings.promptMode === 'profile') return 'profile';
    if (settings.promptMode === 'macro') return 'macro';
    if (settings.autoPromptMode !== false && promptHasDialogueColorsMacro()) return 'macro';
    return 'inject';
}

export function flushPromptInjection() {
    if (injectDebouncedTimer) clearTimeout(injectDebouncedTimer);
    injectDebouncedTimer = null;
    if (!settings.enabled && !promptInjectionActive) {
        updatePromptUi();
        return '';
    }

    let promptText = '';
    if (settings.enabled && !isDomEngine() && getEffectivePromptMode() === 'inject') {
        promptText = buildMinimalPromptInstruction();
    } else if (settings.enabled && isDomEngine() && settings.domStealthColors) {
        promptText = buildDomStealthColorsInstruction();
    }
    const role = settings.promptRole === 'user' ? extension_prompt_roles.USER : extension_prompt_roles.SYSTEM;
    setExtensionPrompt(MODULE_NAME, promptText, extension_prompt_types.IN_CHAT, settings.promptDepth, false, role);
    promptInjectionActive = !!promptText;
    updatePromptUi();
    return promptText;
}

export function injectPrompt() {
    if (injectDebouncedTimer) clearTimeout(injectDebouncedTimer);
    if (!settings.enabled && !promptInjectionActive) {
        injectDebouncedTimer = null;
        updatePromptUi();
        return;
    }
    injectDebouncedTimer = setTimeout(flushPromptInjection, 50);
}

// Phase 3A: Legend with event listener cleanup

// The colorize profile is only reachable from profile mode, and profile mode without
// a profile quietly falls back to the main chat AI. Both are worth saying out loud.
function updatePromptModeNote() {
    const note = document.getElementById('dc-prompt-mode-note');
    if (!note) return;
    const profileMode = settings.enabled && !isDomEngine() && getEffectivePromptMode() === 'profile';
    if (!profileMode) note.textContent = '';
    else if (settings.llmConnectionProfile) note.textContent = 'The reply model is not asked to color. Each reply is colored afterwards by a request on the colorize profile.';
    else note.textContent = 'No colorize profile is selected, so each reply is colored by a second request to the main chat AI.';
    note.style.display = note.textContent ? 'block' : 'none';
}

export function updateSystemPromptDisplay() {
    updatePromptModeNote();
    const container = document.getElementById('dc-system-prompt-container');
    if (!container) return;

    if (getEffectivePromptMode() === 'macro' && settings.enabled && !isDomEngine()) {
        container.style.display = 'block';
        const textarea = document.getElementById('dc-system-prompt-text');
        if (textarea) textarea.value = '{{dialoguecolors}}';
    } else {
        container.style.display = 'none';
    }
}
