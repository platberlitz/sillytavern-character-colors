// attribution.js - extracted from index.js (mechanical split)
import { buildDialogueRegex, buildNameColorLookup, DIALOGUE_SKIP_GROUP, parseNamedColorAssignmentsFromText, registerLookupAssignment, resolveCharacterKeyByNameOrAlias, resolveSingleSpeakerAssignment } from './color-blocks.js';
import { ATTRIBUTION_SOURCE, normalizeAttributionConfidence, normalizeAttributionEvidence, normalizeAttributionSource } from './attribution-store.js';
import { buildCharacterEntry, getEntryEffectiveColor } from './palettes.js';
import { normalizeRegistryIdentity, normalizeRegistryIdentityName } from './group-profiles.js';
import { formatColorBlockPair } from './prompts.js';
import { escapeRegex, getContext } from './st-api.js';
import { characterColors, isStreamingGenerationActive, streamingHeuristicCache } from './state.js';
import { buildMaskedDialogueText, getDialogueParagraphRange, isCompositeSpeakerLabel, isSameDialogueParagraph, makeLengthPreservingSearchText } from './utils.js';

// Invalidates derived caches (speaker mention regexes). Called on chat change and UI init.
export function clearDomCache() { clearSpeakerRegexCache(); }

export const speakingVerbs = new Set([
    'say', 'says', 'said', 'saying',
    'ask', 'asks', 'asked', 'asking',
    'reply', 'replies', 'replied', 'replying',
    'retort', 'retorts', 'retorted', 'retorting',
    'answer', 'answers', 'answered', 'answering',
    'whisper', 'whispers', 'whispered', 'whispering',
    'yell', 'yells', 'yelled', 'yelling',
    'shout', 'shouts', 'shouted', 'shouting',
    'scream', 'screams', 'screamed', 'screaming',
    'bellow', 'bellows', 'bellowed', 'bellowing',
    'roar', 'roars', 'roared', 'roaring',
    'call', 'calls', 'called', 'calling',
    'cry', 'cries', 'cried', 'crying',
    'whimper', 'whimpers', 'whimpered', 'whimpering',
    'sob', 'sobs', 'sobbed', 'sobbing',
    'sigh', 'sighs', 'sighed', 'sighing',
    'groan', 'groans', 'groaned', 'groaning',
    'gasp', 'gasps', 'gasped', 'gasping',
    'mutter', 'mutters', 'muttered', 'muttering',
    'mumble', 'mumbles', 'mumbled', 'mumbling',
    'murmur', 'murmurs', 'murmured', 'murmuring',
    'sputter', 'sputters', 'sputtered', 'sputtering',
    'stammer', 'stammers', 'stammered', 'stammering',
    'stutter', 'stutters', 'stuttered', 'stuttering',
    'giggle', 'giggles', 'giggled', 'giggling',
    'laugh', 'laughs', 'laughed', 'laughing',
    'chuckle', 'chuckles', 'chuckled', 'chuckling',
    'snicker', 'snickers', 'snickered', 'snivering', 'snickering',
    'smirk', 'smirks', 'smirked', 'smirking',
    'grin', 'grins', 'grinned', 'grinning',
    'smile', 'smiles', 'smiled', 'smiling',
    'nod', 'nods', 'nodded', 'nodding',
    'shrug', 'shrugs', 'shrugged', 'shrugging',
    'frown', 'frowns', 'frowned', 'frowning',
    'pout', 'pouts', 'pouted', 'pouting',
    'sneer', 'sneers', 'sneered', 'sneering',
    'scoff', 'scoffs', 'scoffed', 'scoffing',
    'growl', 'growls', 'growled', 'growling',
    'hiss', 'hisses', 'hissed', 'hissing',
    'snap', 'snaps', 'snapped', 'snapping',
    'bark', 'barks', 'barked', 'barking',
    'rasp', 'rasps', 'rasped', 'rasping',
    'croak', 'croaks', 'croaked', 'croaking',
    'squeak', 'squeaks', 'squeaked', 'squeaking',
    'pipe', 'pipes', 'piped', 'piping',
    'chime', 'chimes', 'chimed', 'chiming',
    'agree', 'agrees', 'agreed', 'agreeing',
    'add', 'adds', 'added', 'adding',
    'continue', 'continues', 'continued', 'continuing',
    'comment', 'comments', 'commented', 'commenting',
    'note', 'notes', 'noted', 'noting',
    'observe', 'observes', 'observed', 'observing',
    'suggest', 'suggests', 'suggested', 'suggesting',
    'insist', 'insists', 'insisted', 'insisting',
    'demand', 'demands', 'demanded', 'demanding',
    'plead', 'pleads', 'pleaded', 'pleading',
    'beg', 'begs', 'begged', 'begging',
    'gesture', 'gestures', 'gestured', 'gesturing',
    'motion', 'motions', 'motioned', 'motioning',
    'wave', 'waves', 'waved', 'waving',
    'point', 'points', 'pointed', 'pointing',
    'turn', 'turns', 'turned', 'turning',
    'snort', 'snorts', 'snorted', 'snorting',
    'quip', 'quips', 'quipped', 'quipping',
    'exclaim', 'exclaims', 'exclaimed', 'exclaiming',
    'interject', 'interjects', 'interjected', 'interjecting',
    'spit', 'spits', 'spat', 'spitting',
    'muse', 'muses', 'mused', 'musing',
    'ponder', 'ponders', 'pondered', 'pondering',
    'think', 'thinks', 'thought', 'thinking',
    'wonder', 'wonders', 'wondered', 'wondering',
    'breathe', 'breathes', 'breathed', 'breathing',
    'snarl', 'snarls', 'snarled', 'snarling',
    'jeer', 'jeers', 'jeered', 'jeering',
    'taunt', 'taunts', 'taunted', 'taunting',
    'tease', 'teases', 'teased', 'teasing',
    'scold', 'scolds', 'scolded', 'scolding',
    'warn', 'warns', 'warned', 'warning',
    'protest', 'protests', 'protested', 'protesting'
]);

export const passivePrepositions = new Set([
    'to', 'at', 'with', 'from', 'behind', 'beside', 'next', 'near', 'against', 'toward', 'towards', 'for', 'of', 'about', 'upon', 'on', 'under', 'above', 'by', 'in', 'into', 'onto', 'through', 'across', 'around'
]);

// Cache compiled per-speaker name-match regexes.  Invalidated when the
// character list changes (loadData/addCharacter/deleteCharacter/renameCharacter).

export function isBetterSpeakerCandidate(candidate, best) {
    if (!best) return true;
    if (candidate.strength > best.strength) return true;
    if (candidate.strength < best.strength) return false;
    const afterTagWindow = 30;
    const nearTie = 20;
    const candidateAfterTag = candidate.side === 'after' && candidate.distance <= afterTagWindow;
    const bestAfterTag = best.side === 'after' && best.distance <= afterTagWindow;
    if (candidateAfterTag && !bestAfterTag && candidate.distance <= best.distance + nearTie) return true;
    if (bestAfterTag && !candidateAfterTag && best.distance <= candidate.distance + nearTie) return false;
    return candidate.distance < best.distance;
}

// Cache compiled per-speaker name-match regexes.  Invalidated when the
// character list changes (loadData/addCharacter/deleteCharacter/renameCharacter).
export const speakerRegexCache = new Map();

export function clearSpeakerRegexCache() { speakerRegexCache.clear(); }

export function findClosestMentionedSpeakerInContext(maskedText, windowStart, windowEnd, segmentStart, segmentEnd, lookup, sortedLookupKeys, defaultSpeaker = null) {
    const text = String(maskedText ?? '');
    const boundedStart = Math.max(0, Math.min(text.length, windowStart));
    const boundedEnd = Math.max(boundedStart, Math.min(text.length, windowEnd));
    if (boundedStart >= boundedEnd) return null;

    const cleanWindow = makeLengthPreservingSearchText(text.slice(boundedStart, boundedEnd));
    let best = null;

    for (const speakerKey of sortedLookupKeys) {
        const assignment = lookup.get(speakerKey);
        if (!assignment) continue;
        let regex = speakerRegexCache.get(speakerKey);
        if (!regex) {
            regex = new RegExp(`\\b${escapeRegex(speakerKey)}(?:'s?)?\\b`, 'gi');
            speakerRegexCache.set(speakerKey, regex);
        }
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(cleanWindow)) !== null) {
            const matchStart = boundedStart + match.index;
            const matchEnd = matchStart + match[0].length;
            let side = '';
            let distance = Infinity;
            if (matchEnd <= segmentStart) {
                side = 'before';
                distance = segmentStart - matchEnd;
            } else if (matchStart >= segmentEnd) {
                side = 'after';
                distance = matchStart - segmentEnd;
            } else {
                continue;
            }

            // --- COMPUTE STRENGTH ---
            const textBefore = text.slice(Math.max(0, matchStart - 30), matchStart);
            const preMatch = textBefore.match(/\b([a-zA-Z]+)\b\s*$/);
            const preWord = preMatch ? preMatch[1].toLowerCase() : '';

            const textAfter = text.slice(matchEnd, Math.min(text.length, matchEnd + 40));
            const postMatch = textAfter.match(/^\s*([a-zA-Z]+)\b/);
            const postWord = postMatch ? postMatch[1].toLowerCase() : '';

            const hasPostColon = /^\s*:/.test(textAfter);

            const isRightBeforeQuote = (matchEnd <= segmentStart) && (segmentStart - matchEnd <= 6) && /^[ \t\r\n:,-]*$/.test(text.slice(matchEnd, segmentStart));
            const isRightAfterQuote = (matchStart >= segmentEnd) && (matchStart - segmentEnd <= 6) && /^[ \t\r\n:,-]*$/.test(text.slice(segmentEnd, matchStart));

            const endsWithPossessive = match[0].endsWith("'s") || match[0].endsWith("'S") || match[0].endsWith("'");
            const isPassivePreposition = passivePrepositions.has(preWord);

            const isPostWordSpeakingVerb = speakingVerbs.has(postWord);
            const isPreWordSpeakingVerb = speakingVerbs.has(preWord);

            const isStrongTag = isRightBeforeQuote || isPostWordSpeakingVerb || isPreWordSpeakingVerb || hasPostColon || (isRightAfterQuote && isPostWordSpeakingVerb);

            let strength = 2; // Moderate (subject of sentence/action)
            if (isStrongTag) {
                strength = 3; // Strongest (explicit speaking)
            } else if (endsWithPossessive || isPassivePreposition) {
                strength = 1; // Weak (passive mention or possessive)
            }

            const candidate = { assignment, distance, side, strength };
            if (isBetterSpeakerCandidate(candidate, best)) best = candidate;
        }
    }

    if (best && best.strength <= 1 && defaultSpeaker) {
        return null;
    }

    return best?.assignment || null;
}

export function ensureCharacterEntry(name, color) {
    const trimmedName = normalizeRegistryIdentityName(String(name ?? ''));
    if (!trimmedName) return { key: '', entry: null, created: false };
    // Names containing [COLORS:] block delimiters or control characters would
    // corrupt the color block on the next ingest round-trip; refuse to create them.
    if (/[\r\n\t\[\]=,()]/.test(trimmedName)) return { key: '', entry: null, created: false };
    const existingKey = resolveCharacterKeyByNameOrAlias(trimmedName);
    if (existingKey) return { key: existingKey, entry: characterColors[existingKey], created: false };
    const key = normalizeRegistryIdentity(trimmedName);
    if (characterColors[key]) return { key, entry: characterColors[key], created: false };
    const built = buildCharacterEntry(trimmedName, {
        color,
        colorMode: 'base',
        origin: 'detected',
        dialogueCount: 0
    });
    if (!built.entry) return { key, entry: null, created: false };
    characterColors[key] = built.entry;
    return { key, entry: characterColors[key], created: true };
}

function getSegmentMapValue(map, index) {
    if (map instanceof Map) return map.get(index) ?? map.get(String(index));
    return map && typeof map === 'object' ? map[String(index)] : undefined;
}

function getOverrideSpeaker(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    return value.speaker ?? value.name ?? value.assignment?.name ?? value.value ?? '';
}

function createSegmentProvenance(source, method, confidence, evidence) {
    return {
        provenance: {
            source: normalizeAttributionSource(source),
            method,
        },
        confidence: normalizeAttributionConfidence(confidence),
        evidence: normalizeAttributionEvidence(evidence),
    };
}

export function attributeDialogueSegments(rawText, messageSpeakerName = '', options = {}) {
    const result = { segments: [], hadDialogueMatches: false, hadResolvableSpeaker: false, createdCharacters: false, usedAssignments: [] };
    const dialogueRegex = buildDialogueRegex();
    if (!dialogueRegex) return result;

    const raw = String(rawText ?? '');
    const localAssignments = parseNamedColorAssignmentsFromText(raw);
    const lookup = buildNameColorLookup(localAssignments);
    const sortedLookupKeys = Array.from(lookup.keys())
        .filter(key => !isCompositeSpeakerLabel(lookup.get(key)?.name || key))
        .sort((left, right) => right.length - left.length);
    const trimmedSpeakerName = String(messageSpeakerName ?? '').trim();
    let defaultSpeaker = resolveSingleSpeakerAssignment(trimmedSpeakerName, lookup);
    let defaultSpeakerSource = defaultSpeaker ? ATTRIBUTION_SOURCE.MESSAGE_SPEAKER : ATTRIBUTION_SOURCE.UNKNOWN;

    if (!defaultSpeaker && localAssignments.length === 1) {
        defaultSpeaker = resolveSingleSpeakerAssignment(localAssignments[0].name, lookup);
        if (defaultSpeaker) defaultSpeakerSource = ATTRIBUTION_SOURCE.COLOR_BLOCK;
    }

    const ensureDefaultSpeaker = () => {
        if (defaultSpeaker || !options.autoAddMessageSpeaker || !trimmedSpeakerName || isCompositeSpeakerLabel(trimmedSpeakerName)) return defaultSpeaker;
        const ensured = ensureCharacterEntry(trimmedSpeakerName);
        if (!ensured?.entry) return null;
        if (ensured.created) result.createdCharacters = true;
        registerLookupAssignment(lookup, ensured.entry.name, getEntryEffectiveColor(ensured.entry), ensured.entry.aliases, false, ensured.entry.font);
        defaultSpeaker = lookup.get(trimmedSpeakerName.toLowerCase()) || lookup.get(ensured.key) || null;
        if (defaultSpeaker) defaultSpeakerSource = ATTRIBUTION_SOURCE.MESSAGE_SPEAKER;
        if (defaultSpeaker && !sortedLookupKeys.includes(ensured.key)) {
            sortedLookupKeys.push(ensured.key);
            sortedLookupKeys.sort((left, right) => right.length - left.length);
        }
        return defaultSpeaker;
    };

    const overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : null;
    const usedCanonicalKeys = new Set();
    const recentSpeakerKeys = defaultSpeaker?.key ? [defaultSpeaker.key] : [];
    let lastResolvedSpeakerKey = '';
    let segmentIndex = -1;
    let match;
    const collectedSegments = [];
    dialogueRegex.lastIndex = 0;

    while ((match = dialogueRegex.exec(raw)) !== null) {
        // Code spans, fences and style blocks are matched only so that quotes
        // inside them are consumed instead of segmented, mirroring how
        // SillyTavern skips them when it renders <q> elements.
        if (match.groups?.[DIALOGUE_SKIP_GROUP] !== undefined) continue;
        result.hadDialogueMatches = true;
        segmentIndex++;
        const offset = match.index;
        const matchText = match[0];
        collectedSegments.push({
            index: segmentIndex,
            start: offset,
            end: offset + matchText.length,
            text: matchText,
            delimiter: matchText.charAt(0),
            paragraph: getDialogueParagraphRange(raw, offset, offset + matchText.length),
        });
    }

    const maskedText = buildMaskedDialogueText(raw, collectedSegments);
    const rememberSpeaker = assignment => {
        if (!assignment?.key) return;
        const lastKey = recentSpeakerKeys[recentSpeakerKeys.length - 1];
        if (lastKey !== assignment.key) recentSpeakerKeys.push(assignment.key);
        while (recentSpeakerKeys.length > 2) recentSpeakerKeys.shift();
    };
    const getAlternatingAssignment = () => {
        if (!lastResolvedSpeakerKey) return null;
        for (let i = recentSpeakerKeys.length - 2; i >= 0; i--) {
            const key = recentSpeakerKeys[i];
            if (key && key !== lastResolvedSpeakerKey) return lookup.get(key) || null;
        }
        if (defaultSpeaker?.key && defaultSpeaker.key !== lastResolvedSpeakerKey) return defaultSpeaker;
        return null;
    };
    let previousParagraph = null;

    // Determine if we are attributing the active streaming message to check/save cached assignments
    let isStreamingMsg = false;
    if (isStreamingGenerationActive && options.mesIndex !== undefined) {
        const chat = getContext()?.chat || [];
        if (options.mesIndex === chat.length - 1) {
            isStreamingMsg = true;
        }
    }

    for (const segment of collectedSegments) {
        const sameParagraphAsPrevious = isSameDialogueParagraph(segment.paragraph, previousParagraph);
        let assignment = null;
        let attributionMetadata = createSegmentProvenance(
            ATTRIBUTION_SOURCE.UNKNOWN,
            'unresolved',
            0,
            [{ type: 'no-speaker-match' }],
        );

        // Tier 1: explicit per-segment override. Manual/verifier overrides
        // must always beat cached streaming heuristics, otherwise a stale
        // cached speaker can make right-click and Verified DOM corrections
        // appear to do nothing on the latest message.
        const overrideValue = getSegmentMapValue(overrides, segment.index);
        const overrideRecord = getSegmentMapValue(options.overrideRecords, segment.index);
        const overrideName = getOverrideSpeaker(overrideValue) || getOverrideSpeaker(overrideRecord);
        if (overrideName) {
            assignment = resolveSingleSpeakerAssignment(String(overrideName), lookup);
            if (assignment) {
                const source = getSegmentMapValue(options.overrideSources, segment.index)
                    ?? overrideRecord?.source
                    ?? overrideValue?.source
                    ?? ATTRIBUTION_SOURCE.OVERRIDE;
                const confidence = getSegmentMapValue(options.overrideConfidences, segment.index)
                    ?? overrideRecord?.confidence
                    ?? overrideValue?.confidence;
                const evidence = overrideRecord?.evidence
                    ?? overrideValue?.evidence
                    ?? [{ type: 'segment-override', segmentIndex: segment.index }];
                const normalizedSource = normalizeAttributionSource(source, ATTRIBUTION_SOURCE.OVERRIDE);
                const fallbackConfidence = normalizedSource === ATTRIBUTION_SOURCE.MANUAL ? 1 : 0.95;
                attributionMetadata = createSegmentProvenance(
                    normalizedSource,
                    'override',
                    normalizeAttributionConfidence(confidence, fallbackConfidence),
                    evidence,
                );
            }
        }

        if (!assignment && isStreamingMsg && streamingHeuristicCache.has(segment.start)) {
            assignment = streamingHeuristicCache.get(segment.start);
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.STREAMING_CACHE,
                    'streaming-cache',
                    0.8,
                    [{ type: 'cached-segment-offset', start: segment.start }],
                );
            }
        }

        // Tier 2: masked, paragraph-scoped proximity near the quote.
        if (!assignment) {
            const windowStart = Math.max(segment.paragraph.start, segment.start - 240);
            const windowEnd = Math.min(segment.paragraph.end, segment.end + 120);
            assignment = findClosestMentionedSpeakerInContext(maskedText, windowStart, windowEnd, segment.start, segment.end, lookup, sortedLookupKeys, defaultSpeaker);
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.EXPLICIT_MENTION,
                    'context-proximity',
                    0.85,
                    [{ type: 'nearby-speaker-mention' }],
                );
            }
        }

        // Tier 3: carry only within the same paragraph/line.
        if (!assignment && sameParagraphAsPrevious && lastResolvedSpeakerKey) {
            assignment = lookup.get(lastResolvedSpeakerKey) || null;
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.PARAGRAPH_CARRY,
                    'same-paragraph-carry',
                    0.7,
                    [{ type: 'same-paragraph-speaker' }],
                );
            }
        }

        // Tier 4: alternate speakers across unattributed new paragraphs.
        if (!assignment && !sameParagraphAsPrevious) {
            assignment = getAlternatingAssignment();
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.ALTERNATION,
                    'recent-speaker-alternation',
                    0.45,
                    [{ type: 'recent-speaker-alternation' }],
                );
            }
        }

        // Tier 5: default message speaker.
        if (!assignment) {
            assignment = defaultSpeaker || ensureDefaultSpeaker();
            if (assignment) {
                const fromColorBlock = defaultSpeakerSource === ATTRIBUTION_SOURCE.COLOR_BLOCK;
                attributionMetadata = createSegmentProvenance(
                    fromColorBlock ? ATTRIBUTION_SOURCE.COLOR_BLOCK : ATTRIBUTION_SOURCE.MESSAGE_SPEAKER,
                    fromColorBlock ? 'sole-color-assignment' : 'message-speaker-default',
                    fromColorBlock ? 0.75 : 0.6,
                    [{ type: fromColorBlock ? 'sole-color-assignment' : 'message-speaker' }],
                );
            }
        }

        if (isStreamingMsg && assignment) {
            streamingHeuristicCache.set(segment.start, assignment);
        }

        if (assignment) {
            result.hadResolvableSpeaker = true;
            lastResolvedSpeakerKey = assignment.key;
            rememberSpeaker(assignment);
            if (!usedCanonicalKeys.has(assignment.key)) {
                usedCanonicalKeys.add(assignment.key);
                result.usedAssignments.push({ name: assignment.name, color: assignment.color });
            }
        }

        result.segments.push({
            index: segment.index,
            start: segment.start,
            end: segment.end,
            text: segment.text,
            delimiter: segment.delimiter,
            assignment: assignment ? { key: assignment.key, name: assignment.name, color: assignment.color, font: assignment.font } : null,
            ...attributionMetadata,
        });
        previousParagraph = segment.paragraph;
    }

    return result;
}

// ===== DOM coloring engine (non-destructive) =====

export function colorizeMessageText(rawText, messageSpeakerName = '', options = {}) {
    const { segments, hadDialogueMatches, hadResolvableSpeaker, createdCharacters, usedAssignments } = attributeDialogueSegments(rawText, messageSpeakerName, options);

    let updatedText = rawText;
    for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        if (!seg.assignment) continue;
        updatedText = `${updatedText.slice(0, seg.start)}<font color="${seg.assignment.color}">${seg.text}</font>${updatedText.slice(seg.end)}`;
    }

    let finalText = updatedText;
    if (updatedText !== rawText && usedAssignments.length && !/\[COLORS?:([^\]]*)\]/i.test(finalText)) {
        finalText += `\n[COLORS:${usedAssignments.map(({ name, color }) => formatColorBlockPair(name, color)).filter(Boolean).join(',')}]`;
    }

    return {
        updatedText: finalText,
        changed: finalText !== rawText,
        hadDialogueMatches,
        hadResolvableSpeaker,
        createdCharacters,
        usedAssignments
    };
}
