// color-blocks.js - extracted from index.js (mechanical split)
import { isHostSystemOrToolMessage } from './attribution-store.js';
import { DOM_RETRY_REFRESH_DELAYS, decorateAllMessages, refreshDomDialogueCounts, scheduleDomSettleRefresh } from './dom-engine.js';
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

function isInsideMarkdownCode(source, position) {
    let fence = null;
    let inlineTicks = 0;
    let lineStart = 0;
    while (lineStart < position) {
        let lineEnd = source.indexOf('\n', lineStart);
        if (lineEnd === -1 || lineEnd > position) lineEnd = position;
        const line = source.slice(lineStart, lineEnd).replace(/\r$/, '');
        if (fence) {
            const close = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
            if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
        } else if (!inlineTicks) {
            const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
            if (open) {
                fence = { char: open[1][0], length: open[1].length };
            } else {
                for (let i = 0; i < line.length;) {
                    if (line[i] !== '`') { i++; continue; }
                    let end = i + 1;
                    while (line[end] === '`') end++;
                    const run = end - i;
                    if (!inlineTicks) inlineTicks = run;
                    else if (run === inlineTicks) inlineTicks = 0;
                    i = end;
                }
            }
        } else {
            for (let i = 0; i < line.length;) {
                if (line[i] !== '`') { i++; continue; }
                let end = i + 1;
                while (line[end] === '`') end++;
                if (end - i === inlineTicks) inlineTicks = 0;
                i = end;
            }
        }
        lineStart = lineEnd + 1;
    }
    return !!fence || !!inlineTicks;
}

/** Parse the one metadata form this extension owns: a final standalone line outside code. */
export function parseTrailingColorMetadata(text) {
    const source = String(text ?? '');
    const match = /(^|\r\n?|\n)([ \t]*)\[(COLORS?):([^\]\r\n]*)\][ \t]*((?:\r\n?|\n)?[ \t]*)$/i.exec(source);
    if (!match) return null;
    const start = match.index + match[1].length + match[2].length;
    if (/\t| {4}/.test(match[2]) || isInsideMarkdownCode(source, start)) return null;
    const pairsStart = start + match[0].slice(match[1].length + match[2].length).indexOf(':') + 1;
    return {
        source,
        label: match[3].toUpperCase(),
        pairs: match[4],
        start,
        end: pairsStart + match[4].length + 1,
        pairsStart,
        pairsEnd: pairsStart + match[4].length,
        removeStart: match.index,
        removeEnd: source.length,
    };
}

export function stripTrailingColorMetadata(text) {
    const source = String(text ?? '');
    const block = parseTrailingColorMetadata(source);
    return block ? source.slice(0, block.removeStart) : source;
}

function isUserMessageElement(element) {
    return element?.closest?.('.mes')?.getAttribute?.('is_user') === 'true';
}

function collectElementColorMetadata(element) {
    const documentRef = element?.ownerDocument || globalThis.document;
    const nodeFilter = documentRef?.defaultView?.NodeFilter || globalThis.NodeFilter;
    if (!element || !nodeFilter || typeof documentRef?.createTreeWalker !== 'function') return null;
    const walker = documentRef.createTreeWalker(element, nodeFilter.SHOW_TEXT);
    const nodes = [];
    let combined = '';
    let searchable = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = String(node.nodeValue ?? '');
        nodes.push({ node, start: combined.length });
        combined += value;
        let parent = node.parentElement;
        let inCode = false;
        while (parent) {
            if (parent.tagName === 'CODE' || parent.tagName === 'PRE') { inCode = true; break; }
            parent = parent.parentElement;
        }
        searchable += inCode ? value.replace(/[^\r\n]/g, '\ufffc') : value;
    }
    const block = parseTrailingColorMetadata(searchable);
    if (!block) return null;
    return {
        nodes,
        block: {
            ...block,
            source: combined,
            pairs: combined.slice(block.pairsStart, block.pairsEnd),
        },
    };
}

function removeElementColorMetadata(metadata) {
    let changed = false;
    const { nodes, block } = metadata;
    for (const { node, start } of nodes) {
        const end = start + node.nodeValue.length;
        if (block.removeEnd <= start || block.removeStart >= end) continue;
        const from = Math.max(block.removeStart, start) - start;
        const to = Math.min(block.removeEnd, end) - start;
        node.nodeValue = node.nodeValue.slice(0, from) + node.nodeValue.slice(to);
        changed = true;
    }
    return changed;
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
export function parseColorMetadataPairs(pairsString) {
    if (typeof pairsString !== 'string') return [];
    const assignments = [];
    for (const pair of pairsString.split(',')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx < 1) continue;
        const rawName = pair.slice(0, eqIdx).trim();
        const expression = rawName.match(/^([^()]+)((?:\([^()]+\))*)$/);
        const name = expression && normalizeRegistryIdentityName(expression[1]);
        const color = normalizeHexColor(pair.slice(eqIdx + 1).trim(), null);
        if (!name || !color || /[\[\]=,()]/.test(name)) continue;
        const aliases = [];
        let valid = true;
        for (const match of expression[2].matchAll(/\(([^()]+)\)/g)) {
            const alias = normalizeRegistryIdentityName(match[1]);
            if (!alias || /[\[\]=,()]/.test(alias)) { valid = false; break; }
            aliases.push(alias);
        }
        if (valid) assignments.push({ name, aliases: normalizeAliases(aliases), color });
    }
    return assignments;
}

export function processColorPairs(pairsString) {
    let foundNew = false;
    let hadRemapping = false;
    const remappedAssignments = [];
    let narratorSeen = false;
    for (const { name, aliases, color: assignedColor } of parseColorMetadataPairs(pairsString)) {
        const nameKey = normalizeRegistryIdentity(name);
        if (!nameKey) continue;
        if (nameKey === 'narrator') {
            narratorSeen = true;
            continue;
        }
        const existingKey = resolveCharacterKeyByNameOrAlias(name);
        const key = existingKey || nameKey;
        const canonicalName = existingKey ? characterColors[existingKey].name : name;
        if (hasOwn(characterColors, key) && characterColors[key]) {
            if (!normalizeHexColor(characterColors[key].color, null)) {
                setEntryFromEffectiveColor(characterColors[key], assignedColor);
            }
            characterColors[key].baseColor = normalizeHexColor(characterColors[key].baseColor, deriveBaseColorFromEffectiveColor(getEntryEffectiveColor(characterColors[key])));
        } else {
            const built = buildCharacterEntry(canonicalName, {
                color: assignedColor,
                colorMode: 'effective',
                locked: settings.autoLockDetected !== false
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
        if (aliases.length) {
            characterColors[key].aliases = normalizeAliases([...(characterColors[key].aliases || []), ...aliases]);
        }
    }
    return { foundNew, hadRemapping, remappedAssignments, narratorSeen };
}

export function processColorBlocksInText(text) {
    const block = parseTrailingColorMetadata(text);
    let foundColorBlock = false;
    let foundNew = false;
    let hadRemapping = false;
    let narratorSeen = false;
    const remappedAssignments = [];

    if (block) {
        const result = processColorPairs(block.pairs);
        foundColorBlock = true;
        if (result.foundNew) foundNew = true;
        if (result.hadRemapping) hadRemapping = true;
        if (result.narratorSeen) narratorSeen = true;
        if (Array.isArray(result.remappedAssignments)) remappedAssignments.push(...result.remappedAssignments);
    }

    return { foundColorBlock, foundNew, hadRemapping, remappedAssignments, narratorSeen };
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

export function parseColorBlock(element) {
    const mesText = element.querySelector?.('.mes_text') || element;
    if (!mesText || isUserMessageElement(mesText)) return false;
    const metadata = collectElementColorMetadata(mesText);
    if (!metadata) return false;
    const foundNew = processColorPairs(metadata.block.pairs).foundNew;
    removeElementColorMetadata(metadata);
    return foundNew;
}

export function stripColorBlockFromElement(element) {
    const mesText = element?.querySelector?.('.mes_text') || element;
    if (!mesText || isUserMessageElement(mesText)) return false;
    // Text nodes are edited in place instead of rewriting innerHTML: serialized
    // markup lets a `[COLOR:` run match across tag boundaries and delete elements,
    // and reassigning innerHTML discards listeners and open <details> state.
    const metadata = collectElementColorMetadata(mesText);
    return metadata ? removeElementColorMetadata(metadata) : false;
}

export function stripColorBlocksFromDisplay() {
    let removed = false;
    document.querySelectorAll('.mes_text').forEach(el => {
        if (stripColorBlockFromElement(el)) removed = true;
    });
    return removed;
}

export function recountDialogueCountsFromChat(chat = getContext()?.chat || []) {
    const messages = Array.isArray(chat) ? chat : [];
    const counts = new Map(Object.keys(characterColors).map(key => [key, 0]));
    const colorLookup = buildUniqueKnownColorStatsLookup();

    for (const msg of messages) {
        if (msg?.is_user || isHostSystemOrToolMessage(msg)) continue;
        const text = msg?.mes || '';
        const countedKeys = new Set();
        for (const assignment of parseNamedColorAssignmentsFromText(text)) {
            if (normalizeRegistryIdentity(assignment.name) === 'narrator') continue;
            const key = resolveCharacterKeyByNameOrAlias(assignment.name);
            if (!key || countedKeys.has(key) || !characterColors[key]) continue;
            counts.set(key, (counts.get(key) || 0) + 1);
            countedKeys.add(key);
        }
        for (const [color, occurrences] of countFontColorOccurrencesFromText(text)) {
            const key = colorLookup.get(color)?.key;
            if (!key || !characterColors[key]) continue;
            counts.set(key, (counts.get(key) || 0) + Math.max(0, occurrences - (countedKeys.has(key) ? 1 : 0)));
            countedKeys.add(key);
        }
    }

    let changed = false;
    for (const [key, entry] of Object.entries(characterColors)) {
        const count = counts.get(key) || 0;
        if ((entry.dialogueCount || 0) === count) continue;
        entry.dialogueCount = count;
        changed = true;
    }
    refreshTransientNarratorCount(messages);
    return changed;
}

// The one place any caller asks for dialogueCount to be brought up to date. Both
// engines recompute the tally from the chat, so a recount can never disagree with
// what a message ingest happened to add: a re-render, a swipe or an extension that
// rewrites a message cannot move the numbers on its own.
export function syncDialogueCounts(chat = getContext()?.chat || []) {
    if (isDomEngine()) {
        const result = refreshDomDialogueCounts(chat);
        refreshTransientNarratorCount(chat);
        return result.changed || result.countsChanged;
    }
    return recountDialogueCountsFromChat(chat);
}

export function scanAllMessages() {
    const ctx = getContext();
    const chat = ctx?.chat || [];

    for (const msg of chat) {
        if (msg?.is_user || isHostSystemOrToolMessage(msg)) continue;
        processColorBlocksInText(msg?.mes || '');
    }
    // Ingest registers speakers; the tally is computed from the chat afterwards so
    // this scan cannot disagree with the recount that every other path runs.
    recountDialogueCountsFromChat(chat);

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
    const block = parseTrailingColorMetadata(text);
    if (block) {
        for (const { name, color } of parseColorMetadataPairs(block.pairs)) {
            const colorKey = color;
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
    const block = parseTrailingColorMetadata(text);
    return block ? parseColorMetadataPairs(block.pairs) : [];
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
        if (msg?.is_user || isHostSystemOrToolMessage(msg)) continue;
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
const RENDERED_QUOTE_SKIP_PATTERN = '<[sS][tT][yY][lL][eE]>[\\s\\S]*?<\\/[sS][tT][yY][lL][eE]>|```[\\s\\S]*?```|~~~[\\s\\S]*?~~~|``[\\s\\S]*?``|`[\\s\\S]*?`';

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
    // Do not use new RegExp(source, 'gi') here: STYLE is case-insensitive, but
    // user-selected alphabetic thought delimiters are not.
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
