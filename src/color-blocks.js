// color-blocks.js - extracted from index.js (mechanical split)
import { DOM_RETRY_REFRESH_DELAYS, decorateAllMessages, scheduleDomSettleRefresh } from './dom-engine.js';
import { normalizeRegistryIdentity, normalizeRegistryIdentityName } from './group-profiles.js';
import { commit, repaintDomAfterCharacterDataChange } from './live-colors.js';
import { applyThemeReadabilityAndBrightness, buildCharacterEntry, checkColorConflicts, deriveBaseColorFromEffectiveColor, getEntryEffectiveColor, setEntryFromEffectiveColor } from './palettes.js';
import { NARRATOR_VISUAL_ID, getNarratorVisual, setTransientNarratorCount } from './narrator-style.js';
import { getThoughtDelimiterSymbols } from './prompts.js';
import { escapeHtml, escapeRegex, getContext } from './st-api.js';
import { characterColors, isDomEngine, settings } from './state.js';
import { isCompositeSpeakerLabel, normalizeAliases, normalizeGoogleFontName, normalizeHexColor, parseNameWithNicknames, splitCompositeSpeakerName, toast } from './utils.js';

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

export function resolveCharacterKeyByNameOrAlias(rawName) {
    const lookupName = normalizeRegistryIdentity(rawName);
    if (!lookupName) return '';
    if (hasOwn(characterColors, lookupName) && characterColors[lookupName]) return lookupName;
    for (const [key, entry] of Object.entries(characterColors)) {
        if (!entry) continue;
        if (normalizeRegistryIdentity(entry.name) === lookupName) return key;
        if (normalizeAliases(entry.aliases).some(alias => normalizeRegistryIdentity(alias) === lookupName)) return key;
    }
    return '';
}

export function resolveLookupAssignmentByName(lookup, rawName) {
    if (!(lookup instanceof Map)) return null;
    if (typeof rawName !== 'string') return null;
    const trimmedName = rawName.trim();
    if (!trimmedName) return null;
    const { name, nicknames } = parseNameWithNicknames(trimmedName);
    const candidates = [];
    const pushCandidate = value => {
        const normalized = normalizeRegistryIdentity(value);
        if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
    };
    pushCandidate(trimmedName);
    pushCandidate(name);
    nicknames.forEach(pushCandidate);
    for (const candidate of candidates) {
        const assignment = lookup.get(candidate);
        if (assignment) return assignment;
    }
    return null;
}

export function resolveCompositeSpeakerParts(rawName, lookup) {
    const parts = splitCompositeSpeakerName(rawName);
    if (parts.length < 2 || !(lookup instanceof Map)) return [];
    const resolved = [];
    const seenKeys = new Set();
    for (const part of parts) {
        const assignment = resolveLookupAssignmentByName(lookup, part);
        if (!assignment || isCompositeSpeakerLabel(assignment.name)) return [];
        if (seenKeys.has(assignment.key)) continue;
        seenKeys.add(assignment.key);
        resolved.push(assignment);
    }
    return resolved;
}

export function isReducibleCompositeSpeakerName(rawName, lookup) {
    return resolveCompositeSpeakerParts(rawName, lookup).length >= 2;
}

export function resolveSingleSpeakerAssignment(rawName, lookup) {
    const trimmedName = String(rawName ?? '').trim();
    if (!trimmedName || !(lookup instanceof Map)) return null;
    const resolvedCompositeParts = resolveCompositeSpeakerParts(trimmedName, lookup);
    if (resolvedCompositeParts.length === 1) return resolvedCompositeParts[0];
    if (resolvedCompositeParts.length >= 2 || isCompositeSpeakerLabel(trimmedName)) return null;
    const directAssignment = resolveLookupAssignmentByName(lookup, trimmedName);
    if (!directAssignment || isCompositeSpeakerLabel(directAssignment.name)) return null;
    return directAssignment;
}

export function buildSingleSpeakerEntryLookup(rawColors) {
    const lookup = new Map();
    for (const entry of Object.values(rawColors || {})) {
        if (!entry || isCompositeSpeakerLabel(entry.name)) continue;
        registerLookupAssignment(lookup, entry.name, getEntryEffectiveColor(entry), entry.aliases, false, entry.font);
    }
    return lookup;
}

// Phase 1A: Shared color-pair processing — deduplicates parseColorBlock, scanAllMessages, onNewMessage
// Also fixes auto-lock inconsistency (2A) and adds group field (6B)

export function pruneReducibleCompositeEntries(rawColors) {
    if (!rawColors || typeof rawColors !== 'object' || Array.isArray(rawColors)) return Object.create(null);
    let removed = false;
    do {
        removed = false;
        const lookup = buildSingleSpeakerEntryLookup(rawColors);
        for (const [key, entry] of Object.entries(rawColors)) {
            if (!entry || !isCompositeSpeakerLabel(entry.name)) continue;
            if (!isReducibleCompositeSpeakerName(entry.name, lookup)) continue;
            delete rawColors[key];
            removed = true;
        }
    } while (removed);
    return rawColors;
}

// Phase 1A: Shared color-pair processing — deduplicates parseColorBlock, scanAllMessages, onNewMessage
// Also fixes auto-lock inconsistency (2A) and adds group field (6B)
export function processColorPairs(pairsString) {
    let foundNew = false;
    let hadRemapping = false;
    const remappedAssignments = [];
    const countedKeys = new Set();
    let narratorSeen = false;
    const colorPairs = pairsString.split(',');
    for (const pair of colorPairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const rawName = pair.substring(0, eqIdx).trim();
        const { name, nicknames } = parseNameWithNicknames(rawName);
        const rawColor = pair.substring(eqIdx + 1).trim();
        const nameKey = normalizeRegistryIdentity(name);
        if (!nameKey || !rawColor || !/^#[a-fA-F0-9]{6}$/i.test(rawColor)) continue;
        const assignedColor = normalizeHexColor(rawColor);
        if (nameKey === 'narrator') {
            narratorSeen = true;
            continue;
        }
        const existingKey = resolveCharacterKeyByNameOrAlias(name);
        const key = existingKey || nameKey;
        const canonicalName = existingKey ? characterColors[existingKey].name : name;
        if (hasOwn(characterColors, key) && characterColors[key]) {
            characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1;
            if (!normalizeHexColor(characterColors[key].color, null)) {
                setEntryFromEffectiveColor(characterColors[key], assignedColor);
            }
            characterColors[key].baseColor = normalizeHexColor(characterColors[key].baseColor, deriveBaseColorFromEffectiveColor(getEntryEffectiveColor(characterColors[key])));
        } else {
            const built = buildCharacterEntry(canonicalName, {
                color: assignedColor,
                colorMode: 'effective',
                locked: settings.autoLockDetected !== false,
                dialogueCount: 1
            });
            if (!built.entry) continue;
            characterColors[key] = built.entry;
            foundNew = true;
            if (built.remapped) {
                const finalColor = normalizeHexColor(getEntryEffectiveColor(built.entry), null);
                hadRemapping = true;
                if (finalColor && finalColor !== assignedColor) {
                    remappedAssignments.push({ name: canonicalName, key, oldColor: assignedColor, newColor: finalColor });
                }
            }
        }
        countedKeys.add(key);
        if (nicknames.length) {
            characterColors[key].aliases = normalizeAliases([...(characterColors[key].aliases || []), ...nicknames]);
        }
    }
    return { foundNew, hadRemapping, remappedAssignments, countedKeys: Array.from(countedKeys), narratorSeen };
}

export function processColorBlocksInText(text) {
    const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
    const countedKeys = new Set();
    let match;
    let foundColorBlock = false;
    let foundNew = false;
    let hadRemapping = false;
    let narratorSeen = false;
    const remappedAssignments = [];

    while ((match = colorBlockRegex.exec(text || '')) !== null) {
        const result = processColorPairs(match[1]);
        foundColorBlock = true;
        if (result.foundNew) foundNew = true;
        if (result.hadRemapping) hadRemapping = true;
        if (result.narratorSeen) narratorSeen = true;
        if (Array.isArray(result.remappedAssignments)) remappedAssignments.push(...result.remappedAssignments);
        if (Array.isArray(result.countedKeys)) result.countedKeys.forEach(key => countedKeys.add(key));
    }

    return { foundColorBlock, foundNew, hadRemapping, remappedAssignments, countedKeys, narratorSeen };
}

export function buildUniqueKnownColorStatsLookup() {
    const lookup = new Map();
    const ambiguousColors = new Set();

    for (const [key, entry] of Object.entries(characterColors)) {
        const color = normalizeHexColor(getEntryEffectiveColor(entry), null);
        if (!color || ambiguousColors.has(color)) continue;
        if (lookup.has(color)) {
            lookup.delete(color);
            ambiguousColors.add(color);
            continue;
        }
        lookup.set(color, { key, entry });
    }

    return lookup;
}

// Occurrence counts rather than the distinct-color set, so DOM mode can count
// a font-tagged message per tag the way it counts every other message per quote.
export function countFontColorOccurrencesFromText(text) {
    const counts = new Map();
    const source = String(text ?? '');
    const regex = /<font(?=\s|\/?>)[^<>]*\bcolor\s*=\s*["']?(#[0-9a-fA-F]{6})["']?[^<>]*\/?>/gi;
    let match;
    while ((match = regex.exec(source)) !== null) {
        const color = match[1].toLowerCase();
        counts.set(color, (counts.get(color) || 0) + 1);
    }
    return counts;
}

export function countFontColorStatsFromKnownColors(text, countedKeys = new Set(), colorLookup = buildUniqueKnownColorStatsLookup()) {
    let count = 0;
    const existingKeys = countedKeys instanceof Set ? countedKeys : new Set(countedKeys || []);

    for (const color of collectFontColorsFromText(text)) {
        const assignment = colorLookup.get(normalizeHexColor(color, null));
        if (!assignment?.key || existingKeys.has(assignment.key)) continue;
        const entry = hasOwn(characterColors, assignment.key) ? characterColors[assignment.key] : null;
        if (!entry) continue;
        entry.dialogueCount = (entry.dialogueCount || 0) + 1;
        existingKeys.add(assignment.key);
        count++;
    }

    return count;
}

export function parseColorBlock(element) {
    const mesText = element.querySelector?.('.mes_text') || element;
    if (!mesText) return false;
    const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
    let match, foundNew = false;
    // Parse from textContent for data extraction
    while ((match = colorBlockRegex.exec(mesText.textContent)) !== null) {
        const result = processColorPairs(match[1]);
        if (result.foundNew) foundNew = true;
    }
    stripColorBlockFromElement(mesText);
    return foundNew;
}

export function stripColorBlockFromElement(element) {
    const mesText = element?.querySelector?.('.mes_text') || element;
    if (!mesText) return false;
    const documentRef = mesText.ownerDocument || document;
    const nodeFilter = documentRef?.defaultView?.NodeFilter || globalThis.NodeFilter;
    if (!nodeFilter || typeof documentRef?.createTreeWalker !== 'function') return false;
    const walker = documentRef.createTreeWalker(mesText, nodeFilter.SHOW_TEXT);
    // Text nodes are edited in place instead of rewriting innerHTML: serialized
    // markup lets a `[COLOR:` run match across tag boundaries and delete elements,
    // and reassigning innerHTML discards listeners and open <details> state.
    const nodes = [];
    let combined = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push({ node, start: combined.length });
        combined += node.nodeValue;
    }
    if (!nodes.length) return false;

    // Matching runs over the concatenated text so a block interrupted by inline
    // markup is still removed, mirroring what parseColorBlock reads via textContent.
    const removals = [];
    const blockRegex = /\[COLORS?:[^\]]*\]/gi;
    for (let match = blockRegex.exec(combined); match; match = blockRegex.exec(combined)) {
        removals.push([match.index, match.index + match[0].length]);
    }
    if (!removals.length) return false;

    let changed = false;
    for (const { node, start } of nodes) {
        const end = start + node.nodeValue.length;
        let value = node.nodeValue;
        for (let i = removals.length - 1; i >= 0; i--) {
            const [removeStart, removeEnd] = removals[i];
            if (removeEnd <= start || removeStart >= end) continue;
            const from = Math.max(removeStart, start) - start;
            const to = Math.min(removeEnd, end) - start;
            value = value.slice(0, from) + value.slice(to);
        }
        if (value === node.nodeValue) continue;
        node.nodeValue = value;
        changed = true;
    }
    return changed;
}

export function stripColorBlocksFromDisplay() {
    let removed = false;
    document.querySelectorAll('.mes_text').forEach(el => {
        if (stripColorBlockFromElement(el)) removed = true;
    });
    return removed;
}

export function scanAllMessages() {
    Object.values(characterColors).forEach(c => c.dialogueCount = 0);
    const ctx = getContext();
    const chat = ctx?.chat || [];
    const processedMessages = [];

    for (const msg of chat) {
        const text = msg?.mes || '';
        const result = processColorBlocksInText(text);
        processedMessages.push({ text, countedKeys: result.countedKeys });
    }

    const colorLookup = buildUniqueKnownColorStatsLookup();
    for (const { text, countedKeys } of processedMessages) {
        countFontColorStatsFromKnownColors(text, countedKeys, colorLookup);
    }
    refreshTransientNarratorCount(chat);

    commit();
    stripColorBlocksFromDisplay();
    if (isDomEngine()) {
        decorateAllMessages();
        scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
    } else {
        repaintDomAfterCharacterDataChange(0);
    }
    const conflicts = checkColorConflicts();
    if (conflicts.length) toast.warning(`Similar: ${conflicts.slice(0, 3).map(c => c.map(escapeHtml).join(' & ')).join(', ')}`);
    toast.info(`Found ${Object.keys(characterColors).length} characters`);
}

export function parseColorAssignmentsFromText(text) {
    const latestByColor = {};
    const namesByColor = {};
    const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
    let blockMatch;
    while ((blockMatch = colorBlockRegex.exec(text || '')) !== null) {
        for (const pair of blockMatch[1].split(',')) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) continue;
            const { name } = parseNameWithNicknames(pair.substring(0, eqIdx).trim());
            const rawColor = pair.substring(eqIdx + 1).trim();
            if (!name || !/^#[0-9a-fA-F]{6}$/.test(rawColor)) continue;
            const colorKey = rawColor.toLowerCase();
            const nameKey = normalizeRegistryIdentity(name);
            if (!nameKey) continue;
            latestByColor[colorKey] = nameKey;
            if (!namesByColor[colorKey]) namesByColor[colorKey] = new Set();
            namesByColor[colorKey].add(nameKey);
        }
    }
    return { latestByColor, namesByColor };
}

export function collectFontColorsFromText(text) {
    const colors = new Set();
    const fontTagRegex = /<font(?=\s|\/?>)[^<>]*\bcolor\s*=\s*["']?(#[0-9a-fA-F]{6})["']?[^<>]*\/?>/gi;
    let match;
    while ((match = fontTagRegex.exec(text || '')) !== null) {
        colors.add(match[1].toLowerCase());
    }
    return colors;
}

export function parseNamedColorAssignmentsFromText(text) {
    const assignments = [];
    const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
    let blockMatch;
    while ((blockMatch = colorBlockRegex.exec(text || '')) !== null) {
        for (const pair of blockMatch[1].split(',')) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) continue;
            const rawName = pair.substring(0, eqIdx).trim();
            const { name, nicknames } = parseNameWithNicknames(rawName);
            const color = normalizeHexColor(pair.substring(eqIdx + 1).trim(), null);
            if (!name || !color) continue;
            assignments.push({ name, aliases: nicknames, color });
        }
    }
    return assignments;
}

export function countNarratorFontTagsFromText(text) {
    const assignments = parseNamedColorAssignmentsFromText(text);
    const narratorColors = new Set(assignments
        .filter(assignment => normalizeRegistryIdentity(assignment.name) === 'narrator')
        .map(assignment => assignment.color));
    if (!narratorColors.size) return { present: false, count: null };
    const namesByColor = new Map();
    assignments.forEach(assignment => {
        if (!namesByColor.has(assignment.color)) namesByColor.set(assignment.color, new Set());
        const nameKey = normalizeRegistryIdentity(assignment.name);
        if (nameKey) namesByColor.get(assignment.color).add(nameKey);
    });
    if ([...narratorColors].some(color => [...(namesByColor.get(color) || [])].some(name => name !== 'narrator'))) {
        return { present: true, count: null };
    }
    let count = 0;
    const fontTagRegex = /<font(?=\s|\/?>)[^<>]*\bcolor\s*=\s*["']?(#[0-9a-fA-F]{6})["']?[^<>]*\/?>/gi;
    let match;
    while ((match = fontTagRegex.exec(text || '')) !== null) {
        if (narratorColors.has(match[1].toLowerCase())) count++;
    }
    return { present: true, count: count || null };
}

export function refreshTransientNarratorCount(chat = getContext()?.chat || []) {
    let total = 0;
    let present = false;
    for (const msg of chat) {
        const result = countNarratorFontTagsFromText(msg?.mes || '');
        if (!result.present) continue;
        present = true;
        if (result.count === null) return setTransientNarratorCount(null, chat);
        total += result.count;
    }
    return setTransientNarratorCount(present ? total : null, chat);
}

// SillyTavern wraps these pairs in <q> unconditionally, whatever the thought
// symbols are set to (public/script.js, the quote replace in messageFormatting).
// Segmenting a different set of pairs desynchronises segment indices from the
// rendered <q> elements, which makes a manual override land on the wrong quote.
const RENDERED_QUOTE_PAIRS = Object.freeze([
    ['"', '"'],
    ['\u201C', '\u201D'],
    ['\u00AB', '\u00BB'],
    ['\u300C', '\u300D'],
    ['\u300E', '\u300F'],
    ['\uFF02', '\uFF02'],
]);

// The leading alternatives of SillyTavern's quote regex, which swallow code and
// style spans before any quote inside them can match. Copied verbatim so both
// sides skip the same regions.
const RENDERED_QUOTE_SKIP_PATTERN = '<style>[\\s\\S]*?<\\/style>|```[\\s\\S]*?```|~~~[\\s\\S]*?~~~|``[\\s\\S]*?``|`[\\s\\S]*?`';

// Alternation named group marking a skipped region rather than a dialogue
// segment. Consumers must discard these matches.
export const DIALOGUE_SKIP_GROUP = 'dcSkip';

export function buildDialogueRegex() {
    const delimiters = new Set();
    for (const ch of getThoughtDelimiterSymbols()) {
        delimiters.add(ch);
    }
    
    const ASYMMETRIC_MAP = {
        '“': '”',
        '『': '』',
        '「': '」',
        '（': '）',
        '《': '》',
        '〈': '〉',
        '【': '】',
        '〔': '〕',
        '〖': '〗',
        '〘': '〙',
        '〚': '〛',
        '(': ')',
        '{': '}',
        '[': ']',
        '<': '>',
    };
    const REVERSE_ASYMMETRIC_MAP = {};
    for (const [open, close] of Object.entries(ASYMMETRIC_MAP)) {
        REVERSE_ASYMMETRIC_MAP[close] = open;
    }

    const patterns = [];
    const processedAsymmetricPairs = new Set();

    // Quote pairs come first and are never conditional, so segment order and
    // count line up with the <q> elements SillyTavern rendered. The character
    // classes exclude line breaks because SillyTavern's quote regex runs without
    // the dotAll flag, so a quote it renders can never span a line.
    for (const [openChar, closeChar] of RENDERED_QUOTE_PAIRS) {
        processedAsymmetricPairs.add(`${openChar}:${closeChar}`);
        const escapedOpen = escapeRegex(openChar);
        const escapedClose = escapeRegex(closeChar);
        patterns.push(`${escapedOpen}([^${escapedClose}\\n\\r]*)${escapedClose}`);
    }

    for (const delimiter of delimiters) {
        const isOpening = ASYMMETRIC_MAP[delimiter] !== undefined;
        const isClosing = REVERSE_ASYMMETRIC_MAP[delimiter] !== undefined;

        if (isOpening || isClosing) {
            const openChar = isOpening ? delimiter : REVERSE_ASYMMETRIC_MAP[delimiter];
            const closeChar = isOpening ? ASYMMETRIC_MAP[delimiter] : delimiter;
            const pairKey = `${openChar}:${closeChar}`;

            if (processedAsymmetricPairs.has(pairKey)) {
                continue;
            }
            processedAsymmetricPairs.add(pairKey);

            const escapedOpen = escapeRegex(openChar);
            const escapedClose = escapeRegex(closeChar);
            patterns.push(`${escapedOpen}([^${escapedClose}]+)${escapedClose}`);
        } else {
            if (processedAsymmetricPairs.has(`${delimiter}:${delimiter}`)) continue;
            processedAsymmetricPairs.add(`${delimiter}:${delimiter}`);
            const escaped = escapeRegex(delimiter);
            // Reject doubled delimiters (e.g. markdown **bold** or __bold__) so a
            // bold span is not misattributed as a thought/delimiter segment; such
            // segments never match rendered <em> elements and previously caused a
            // permanent readiness/health-check re-render loop in the DOM engine.
            patterns.push(`(?<!${escaped})${escaped}([^${escaped}]+)${escaped}(?!${escaped})`);
        }
    }
    if (!patterns.length) return null;
    // The skip alternative is first so a quote inside a code or style span is
    // consumed as a skipped region, exactly as SillyTavern consumes it before
    // it can become a <q>.
    return new RegExp(`(?<${DIALOGUE_SKIP_GROUP}>${RENDERED_QUOTE_SKIP_PATTERN})|(${patterns.join('|')})`, 'g');
}

export function registerLookupAssignment(lookup, name, color, aliases = [], preserveExisting = false, font = '') {
    const normalizedName = normalizeRegistryIdentityName(name);
    const normalizedColor = normalizeHexColor(color, null);
    const canonicalKey = normalizeRegistryIdentity(normalizedName);
    if (!canonicalKey || !normalizedColor) return;
    const assignment = { key: canonicalKey, name: normalizedName, color: normalizedColor, font: normalizeGoogleFontName(font) };
    const lookupNames = [normalizedName, ...normalizeAliases(aliases)];
    for (const lookupName of lookupNames) {
        const lookupKey = normalizeRegistryIdentity(lookupName);
        if (!lookupKey) continue;
        if (preserveExisting && lookup.has(lookupKey)) continue;
        lookup.set(lookupKey, assignment);
    }
}

export function buildNameColorLookup(extraAssignments = []) {
    const lookup = new Map();
    for (const entry of Object.values(characterColors)) {
        registerLookupAssignment(lookup, entry.name, getEntryEffectiveColor(entry), entry.aliases, false, entry.font);
    }
    const pendingCompositeAssignments = [];
    for (const assignment of Array.isArray(extraAssignments) ? extraAssignments : []) {
        if (!assignment) continue;
        if (isCompositeSpeakerLabel(assignment.name)) {
            pendingCompositeAssignments.push(assignment);
            continue;
        }
        registerLookupAssignment(lookup, assignment.name, assignment.color, assignment.aliases, true);
    }
    for (const assignment of pendingCompositeAssignments) {
        if (isReducibleCompositeSpeakerName(assignment.name, lookup)) continue;
        registerLookupAssignment(lookup, assignment.name, assignment.color, assignment.aliases, true);
    }
    return lookup;
}

export function setColorFontMapping(colorToFont, ambiguousColors, lockedColors, color, font, options = {}) {
    const normalizedColor = normalizeHexColor(color, null);
    const normalizedFont = normalizeGoogleFontName(font);
    if (!normalizedColor || !normalizedFont) return;
    if (lockedColors.has(normalizedColor) && !options.force) return;
    const existing = colorToFont.get(normalizedColor);
    if (existing && existing !== normalizedFont && !options.force) {
        ambiguousColors.add(normalizedColor);
        return;
    }
    colorToFont.set(normalizedColor, normalizedFont);
    if (options.force) {
        ambiguousColors.delete(normalizedColor);
        lockedColors.add(normalizedColor);
    }
}

export function buildColorFontLookup(rawText = '') {
    const colorToFont = new Map();
    const ambiguousColors = new Set();
    const lockedColors = new Set();
    const lookup = buildNameColorLookup();
    const parsed = parseColorAssignmentsFromText(rawText);

    for (const [color, names] of Object.entries(parsed.namesByColor || {})) {
        const normalizedColor = normalizeHexColor(color, null);
        if (!normalizedColor) continue;
        lockedColors.add(normalizedColor);
        if (!names || names.size !== 1) {
            colorToFont.delete(normalizedColor);
            continue;
        }
        const [nameKey] = Array.from(names);
        const assignment = lookup.get(nameKey);
        if (assignment?.font) setColorFontMapping(colorToFont, ambiguousColors, lockedColors, normalizedColor, assignment.font, { force: true });
        else colorToFont.delete(normalizedColor);
    }

    for (const entry of Object.values(characterColors)) {
        if (!entry?.font) continue;
        setColorFontMapping(colorToFont, ambiguousColors, lockedColors, getEntryEffectiveColor(entry), entry.font);
    }

    for (const color of ambiguousColors) {
        if (!lockedColors.has(color)) colorToFont.delete(color);
    }
    return colorToFont;
}

export function buildColorRenderingLookup(rawText = '') {
    const colorToRendering = new Map();
    const ambiguousColors = new Set();
    const lockedColors = new Set();
    const parsed = parseColorAssignmentsFromText(rawText);

    for (const [color, names] of Object.entries(parsed.namesByColor || {})) {
        const normalizedColor = normalizeHexColor(color, null);
        if (!normalizedColor) continue;
        lockedColors.add(normalizedColor);
        if (!names || names.size !== 1) {
            colorToRendering.delete(normalizedColor);
            continue;
        }
        const [nameKey] = Array.from(names);
        const narrator = nameKey === 'narrator' ? getNarratorVisual(settings, applyThemeReadabilityAndBrightness) : null;
        const key = narrator ? NARRATOR_VISUAL_ID : resolveCharacterKeyByNameOrAlias(nameKey);
        const entry = narrator || (key && hasOwn(characterColors, key) ? characterColors[key] : null);
        if (entry) colorToRendering.set(normalizedColor, { key, entry });
        else colorToRendering.delete(normalizedColor);
    }

    const currentEntries = Object.entries(characterColors);
    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    if (narrator) currentEntries.push([NARRATOR_VISUAL_ID, narrator]);
    for (const [key, entry] of currentEntries) {
        const color = normalizeHexColor(getEntryEffectiveColor(entry), null);
        if (!color || lockedColors.has(color) || ambiguousColors.has(color)) continue;
        const existing = colorToRendering.get(color);
        if (existing && existing.key !== key) {
            colorToRendering.delete(color);
            ambiguousColors.add(color);
            continue;
        }
        colorToRendering.set(color, { key, entry });
    }

    for (const color of ambiguousColors) {
        if (!lockedColors.has(color)) colorToRendering.delete(color);
    }
    return colorToRendering;
}
