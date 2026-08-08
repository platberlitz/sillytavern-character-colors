// attribution.js - extracted from index.js (mechanical split)
import { buildDialogueRegex, buildNameColorLookup, DIALOGUE_SKIP_GROUP, parseNamedColorAssignmentsFromText, registerLookupAssignment, resolveCharacterKeyByNameOrAlias, resolveSingleSpeakerAssignment } from './color-blocks.js';
import { ATTRIBUTION_SOURCE, normalizeAttributionConfidence, normalizeAttributionEvidence, normalizeAttributionSource } from './attribution-store.js';
import { buildCharacterEntry, getEntryEffectiveColor } from './palettes.js';
import { normalizeRegistryIdentity, normalizeRegistryIdentityName } from './group-profiles.js';
import { formatColorBlockPair } from './prompts.js';
import { escapeRegex } from './st-api.js';
import { characterColors, streamingSession } from './state.js';
import { buildMaskedDialogueText, getDialogueParagraphRange, getPrecedingParagraphRange, isCompositeSpeakerLabel, isSameDialogueParagraph, makeLengthPreservingSearchText, normalizeSegmentText } from './utils.js';

// Invalidates derived caches (speaker mention regexes). Called on chat change and UI init.
export function clearDomCache() { clearSpeakerRegexCache(); }

// Verbs that report speech. A name bound to one of these is a speech tag, the
// strongest textual evidence a quote can carry.
//
// Deliberately excludes the beat verbs a character can perform while somebody
// else talks -- smile, grin, smirk, nod, shrug, frown, pout, gesture, motion,
// wave, point, turn. Scoring those as speech tags let a bystander reacting
// after a quote ('Alice whispered. "Something." Carol frowned.') outrank the
// character who actually spoke. They still resolve quotes, as action beats.
export const speechVerbs = new Set([
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
    'snicker', 'snickers', 'snickered', 'snickering',
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
    'protest', 'protests', 'protested', 'protesting',
    'state', 'states', 'stated', 'stating',
    'declare', 'declares', 'declared', 'declaring',
    'announce', 'announces', 'announced', 'announcing',
    'admit', 'admits', 'admitted', 'admitting',
    'confess', 'confesses', 'confessed', 'confessing',
    'explain', 'explains', 'explained', 'explaining',
    'clarify', 'clarifies', 'clarified', 'clarifying',
    'confirm', 'confirms', 'confirmed', 'confirming',
    'deny', 'denies', 'denied', 'denying',
    'object', 'objects', 'objected', 'objecting',
    'argue', 'argues', 'argued', 'arguing',
    'remark', 'remarks', 'remarked', 'remarking',
    'blurt', 'blurts', 'blurted', 'blurting',
    'venture', 'ventures', 'ventured', 'venturing',
    'drawl', 'drawls', 'drawled', 'drawling',
    'deadpan', 'deadpans', 'deadpanned', 'deadpanning',
    'chirp', 'chirps', 'chirped', 'chirping',
    'huff', 'huffs', 'huffed', 'huffing',
    'correct', 'corrects', 'corrected', 'correcting',
    'press', 'presses', 'pressed', 'pressing',
    'counter', 'counters', 'countered', 'countering',
    'conclude', 'concludes', 'concluded', 'concluding',
    'offer', 'offers', 'offered', 'offering',
    'repeat', 'repeats', 'repeated', 'repeating',
    'echo', 'echoes', 'echoed', 'echoing',
    'remind', 'reminds', 'reminded', 'reminding',
    'urge', 'urges', 'urged', 'urging',
    'purr', 'purrs', 'purred', 'purring',
    'whine', 'whines', 'whined', 'whining',
    'utter', 'utters', 'uttered', 'uttering',
    'inquire', 'inquires', 'inquired', 'inquiring',
    'grumble', 'grumbles', 'grumbled', 'grumbling',
    'complain', 'complains', 'complained', 'complaining',
    'apologize', 'apologizes', 'apologized', 'apologizing',
    'apologise', 'apologises', 'apologised', 'apologising',
    'assure', 'assures', 'assured', 'assuring',
    'promise', 'promises', 'promised', 'promising',
    'threaten', 'threatens', 'threatened', 'threatening',
    'command', 'commands', 'commanded', 'commanding',
    'order', 'orders', 'ordered', 'ordering',
    'greet', 'greets', 'greeted', 'greeting',
    'joke', 'jokes', 'joked', 'joking',
    'swear', 'swears', 'swore', 'swearing',
    'curse', 'curses', 'cursed', 'cursing',
    'hum', 'hums', 'hummed', 'humming',
    'cough', 'coughs', 'coughed', 'coughing',
    'wail', 'wails', 'wailed', 'wailing',
    'howl', 'howls', 'howled', 'howling',
    'shriek', 'shrieks', 'shrieked', 'shrieking',
    'squeal', 'squeals', 'squealed', 'squealing',
    'sing', 'sings', 'sang', 'singing',
    'chant', 'chants', 'chanted', 'chanting',
    'vow', 'vows', 'vowed', 'vowing',
    'concede', 'concedes', 'conceded', 'conceding',
    'chide', 'chides', 'chided', 'chiding',
    'marvel', 'marvels', 'marvelled', 'marveled', 'marvelling', 'marveling',
    'coo', 'coos', 'cooed', 'cooing',
    'croon', 'croons', 'crooned', 'crooning',
    'prompt', 'prompts', 'prompted', 'prompting'
]);

// Kept as the union: a pronoun standing next to the quote is already strong
// enough evidence that either kind of verb confirms it ("she smiled" opens a
// beat just as reliably as "she said" tags one).
export const actionBeatVerbs = new Set([
    'smirk', 'smirks', 'smirked', 'smirking',
    'grin', 'grins', 'grinned', 'grinning',
    'smile', 'smiles', 'smiled', 'smiling',
    'nod', 'nods', 'nodded', 'nodding',
    'shrug', 'shrugs', 'shrugged', 'shrugging',
    'frown', 'frowns', 'frowned', 'frowning',
    'pout', 'pouts', 'pouted', 'pouting',
    'gesture', 'gestures', 'gestured', 'gesturing',
    'motion', 'motions', 'motioned', 'motioning',
    'wave', 'waves', 'waved', 'waving',
    'point', 'points', 'pointed', 'pointing',
    'turn', 'turns', 'turned', 'turning',
    'glance', 'glances', 'glanced', 'glancing',
    'stare', 'stares', 'stared', 'staring',
    'blink', 'blinks', 'blinked', 'blinking',
    'lean', 'leans', 'leaned', 'leant', 'leaning',
    'step', 'steps', 'stepped', 'stepping',
    'tilt', 'tilts', 'tilted', 'tilting',
    'raise', 'raises', 'raised', 'raising',
    'reach', 'reaches', 'reached', 'reaching',
    'rise', 'rises', 'rose', 'rising',
    'stand', 'stands', 'stood', 'standing',
    'sit', 'sits', 'sat', 'sitting',
    'pause', 'pauses', 'paused', 'pausing',
    'hesitate', 'hesitates', 'hesitated', 'hesitating',
    'shake', 'shakes', 'shook', 'shaking',
    'swallow', 'swallows', 'swallowed', 'swallowing',
    'wince', 'winces', 'winced', 'wincing',
    'flinch', 'flinches', 'flinched', 'flinching',
    'straighten', 'straightens', 'straightened', 'straightening',
    'cross', 'crosses', 'crossed', 'crossing',
    'fold', 'folds', 'folded', 'folding'
]);

export const speakingVerbs = new Set([...speechVerbs, ...actionBeatVerbs]);

// Things a person owns that act on their behalf: "Alice's voice dropped" and
// "Alice's eyes narrowed" name Alice as the one acting, while "Alice's coat lay
// across the chair" names a prop and leaves her out of the scene entirely.
export const speakerPossessedNouns = new Set([
    'voice', 'tone', 'whisper', 'breath', 'breathing', 'words', 'word', 'reply', 'answer', 'question', 'laugh', 'laughter', 'chuckle', 'sigh', 'gasp', 'growl', 'snort', 'accent', 'drawl',
    'eye', 'eyes', 'gaze', 'stare', 'glance', 'look', 'expression', 'face', 'features', 'brow', 'brows', 'eyebrow', 'eyebrows', 'lip', 'lips', 'mouth', 'jaw', 'chin', 'cheek', 'cheeks', 'nose', 'ear', 'ears',
    'smile', 'grin', 'smirk', 'frown', 'scowl', 'pout', 'sneer',
    'head', 'hair', 'neck', 'throat', 'shoulder', 'shoulders', 'arm', 'arms', 'elbow', 'elbows', 'hand', 'hands', 'finger', 'fingers', 'fingertips', 'fist', 'fists', 'knuckles', 'palm', 'palms', 'nails', 'claws',
    'chest', 'back', 'spine', 'hip', 'hips', 'leg', 'legs', 'knee', 'knees', 'foot', 'feet', 'heel', 'heels', 'tail', 'wings', 'horns',
    'heart', 'pulse', 'stomach', 'skin', 'posture', 'stance', 'grip', 'touch'
]);

export const passivePrepositions = new Set([
    'to', 'at', 'with', 'from', 'behind', 'beside', 'next', 'near', 'against', 'toward', 'towards', 'for', 'of', 'about', 'upon', 'on', 'under', 'above', 'by', 'in', 'into', 'onto', 'through', 'across', 'around'
]);

// Subject pronouns only. Object and possessive forms ("her", "his") are
// deliberately excluded: they mark the addressee or an owner, never the
// speaker, and binding them would recolour the wrong side of a scene.
export const pronounSubjects = new Set(['he', 'she', 'they', 'it']);

// Cache compiled per-speaker name-match regexes.  Invalidated when the
// character list changes (loadData/addCharacter/deleteCharacter/renameCharacter).

// Evidence strength, strongest first. The gaps matter: an action beat can never
// climb over a speech tag, and a possessive prop or an addressee can never climb
// over anything.
export const SPEAKER_STRENGTH = Object.freeze({
    ADJACENT_TAG: 5,   // 'Alice: "..."', 'Alice said "..."', '"...," said Alice'
    SPEECH_VERB: 4,    // a reporting verb bound to the name a little further off
    ACTION_BEAT: 3,    // the name acts in the sentence that touches the quote
    MENTION: 2,        // the name is simply present in the probe window
    WEAK: 1,           // a prop possessive or the object of a preposition
});

export function isBetterSpeakerCandidate(candidate, best) {
    if (!best) return true;
    if (candidate.strength > best.strength) return true;
    if (candidate.strength < best.strength) return false;
    // Below a real speech tag the prose convention flips: the beat that sets a
    // quote up owns it, and whoever moves afterwards is reacting to it.
    if (candidate.strength <= SPEAKER_STRENGTH.ACTION_BEAT && candidate.side !== best.side) {
        return candidate.side === 'before';
    }
    const afterTagWindow = 30;
    const nearTie = 20;
    const candidateAfterTag = candidate.side === 'after' && candidate.distance <= afterTagWindow;
    const bestAfterTag = best.side === 'after' && best.distance <= afterTagWindow;
    if (candidateAfterTag && !bestAfterTag && candidate.distance <= best.distance + nearTie) return true;
    if (bestAfterTag && !candidateAfterTag && best.distance <= candidate.distance + nearTie) return false;
    return candidate.distance < best.distance;
}

// Label syntaxes wrap the name in punctuation SillyTavern users write by hand:
// '**Alice:**', '[Alice]:', '<Alice>', '(Alice)', '— Alice'. None of it is
// narration, so none of it should push a speaker label out of adjacency.
const ADJACENT_GAP_PATTERN = /^[\s:,\-–—*_~()[\]<>|«»]*$/;
const LABEL_COLON_PATTERN = /^[\s*_~)\]>|]*:/;
// A sentence that ends exactly where the quote begins, with one terminator and
// nothing but closing punctuation after it.
const SENTENCE_TOUCHES_QUOTE_PATTERN = /^[^.!?…\n\r]*[.!?…]?[\s"'*_~)\]>|»]*$/;
// Nothing but a previous sentence's terminator and openers stand before the
// name, so the name opens the sentence and is its subject.
const SENTENCE_LEADING_PATTERN = /(?:^|[.!?…])[\s"'*_~([{<>|«»\-–—]*$/;

// Cache compiled per-speaker name-match regexes.  Invalidated when the
// character list changes (loadData/addCharacter/deleteCharacter/renameCharacter).
export const speakerRegexCache = new Map();
const CJK_SPEAKER_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function getSpeakerNameRegex(speakerKey) {
    let regex = speakerRegexCache.get(speakerKey);
    if (!regex) {
        const name = `${escapeRegex(speakerKey)}(?:['’]s?)?`;
        regex = new RegExp(CJK_SPEAKER_PATTERN.test(speakerKey)
            ? name
            : `(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'giu');
        speakerRegexCache.set(speakerKey, regex);
    }
    return regex;
}

export function clearSpeakerRegexCache() {
    speakerRegexCache.clear();
    vocativeRegexCache.clear();
}

// Returns the winning candidate with its scoring intact ({ assignment,
// strength, distance, side, name }) so callers can derive an honest
// confidence instead of a flat per-tier constant.
export function findSpeakerCandidateInContext(maskedText, windowStart, windowEnd, segmentStart, segmentEnd, lookup, sortedLookupKeys, defaultSpeaker = null, options = {}) {
    const text = String(maskedText ?? '');
    const boundedStart = Math.max(0, Math.min(text.length, windowStart));
    const boundedEnd = Math.max(boundedStart, Math.min(text.length, windowEnd));
    if (boundedStart >= boundedEnd) return null;

    // A name reached only by stepping over another quote is that quote's tag,
    // not this one's: in '"Sit down." "I would rather stand," Alice said.'
    // the trailing tag belongs to the second quote alone.
    const otherSegments = Array.isArray(options.segments) ? options.segments : [];
    const isSeparatedBySegment = (gapStart, gapEnd) => otherSegments.some(other =>
        other.start >= gapStart && other.end <= gapEnd && !(other.start === segmentStart && other.end === segmentEnd));

    // Neighbouring words have to be read on this side of the nearest quote.
    // Reading through one let the verb of an earlier sentence ('Alice laughed.
    // "Sure." Bob rolled his eyes.') present itself as Bob's speech tag.
    const paragraphStart = Math.max(0, Math.min(text.length, options.paragraphStart ?? 0));
    const contextStart = position => otherSegments.reduce(
        (bound, other) => (other.end <= position && other.end > bound ? other.end : bound), paragraphStart);
    const contextEnd = position => otherSegments.reduce(
        (bound, other) => (other.start >= position && other.start < bound ? other.start : bound), text.length);

    // A tag pinned between two quotes belongs to whichever one invited it. A
    // quote that breaks off mid-sentence ('"Sure," Carol said.') is still
    // waiting for its tag; one that closes on a full stop is finished, so the
    // name after it opens a new sentence and tags the quote that sentence runs
    // into -- '"Sure." Carol groaned. "No."' is Carol groaning "No", not "Sure".
    const quoteEndsMidSentence = /[,;:—–-]\s*["'”’»)\]*_~]*$/.test(String(options.segmentText ?? ''));

    const cleanWindow = makeLengthPreservingSearchText(text.slice(boundedStart, boundedEnd));
    let best = null;

    for (const speakerKey of sortedLookupKeys) {
        const assignment = lookup.get(speakerKey);
        if (!assignment) continue;
        const regex = getSpeakerNameRegex(speakerKey);
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(cleanWindow)) !== null) {
            const matchStart = boundedStart + match.index;
            const matchEnd = matchStart + match[0].length;
            let side = '';
            let distance = Infinity;
            if (matchEnd <= segmentStart) {
                if (isSeparatedBySegment(matchEnd, segmentStart)) continue;
                side = 'before';
                distance = segmentStart - matchEnd;
            } else if (matchStart >= segmentEnd) {
                if (isSeparatedBySegment(segmentEnd, matchStart)) continue;
                side = 'after';
                distance = matchStart - segmentEnd;
            } else {
                continue;
            }

            // --- COMPUTE STRENGTH ---
            const sentenceHead = text.slice(contextStart(matchStart), matchStart);
            const preMatch = sentenceHead.slice(-30).match(/\b([a-zA-Z]+)\b\s*$/);
            const preWord = preMatch ? preMatch[1].toLowerCase() : '';

            const textAfter = text.slice(matchEnd, Math.min(contextEnd(matchEnd), matchEnd + 40));
            const postMatch = textAfter.match(/^\s*([a-zA-Z]+)\b/);
            const postWord = postMatch ? postMatch[1].toLowerCase() : '';

            const hasPostColon = LABEL_COLON_PATTERN.test(textAfter);

            const isRightBeforeQuote = (matchEnd <= segmentStart) && (segmentStart - matchEnd <= 6) && ADJACENT_GAP_PATTERN.test(text.slice(matchEnd, segmentStart));
            const isRightAfterQuote = (matchStart >= segmentEnd) && (matchStart - segmentEnd <= 6) && ADJACENT_GAP_PATTERN.test(text.slice(segmentEnd, matchStart));

            const endsWithPossessive = /['’]s?$/i.test(match[0]);
            // "Alice's voice went flat" is Alice acting; "Alice's coat lay there"
            // is a prop, and its owner may not even be in the room.
            const isSpeakerPossessive = endsWithPossessive && speakerPossessedNouns.has(postWord);
            const isPassivePreposition = passivePrepositions.has(preWord);

            const isPostWordSpeechVerb = speechVerbs.has(postWord);
            const isPreWordSpeechVerb = speechVerbs.has(preWord);

            // A tag glued to the quote ("Bob: ...", 'Bob said "..."', '"...," said Bob')
            // is the only positional evidence strong enough to outrank a
            // speech verb found loose in the probe window.
            const isAdjacentTag = isRightBeforeQuote || hasPostColon || (isRightAfterQuote && isPostWordSpeechVerb);
            const isSpeechVerbTag = isPostWordSpeechVerb || isPreWordSpeechVerb;
            const isWeakMention = isPassivePreposition || (endsWithPossessive && !isSpeakerPossessive);

            // An action beat is the sentence that runs straight into the quote
            // with this name as its subject -- 'Alice folded her arms. "Fine."'
            // and its mirror '"Fine." Alice folded her arms.' Models write far
            // more of these than they write literal speech tags.
            const touchesQuote = side === 'after'
                ? isRightAfterQuote
                : SENTENCE_TOUCHES_QUOTE_PATTERN.test(text.slice(matchEnd, segmentStart));
            const isActionBeat = touchesQuote
                && (side === 'after' || SENTENCE_LEADING_PATTERN.test(sentenceHead) || actionBeatVerbs.has(postWord));

            const followingQuoteStart = contextEnd(matchEnd);
            const tagsFollowingQuote = side === 'after' && !quoteEndsMidSentence && followingQuoteStart < text.length
                && SENTENCE_TOUCHES_QUOTE_PATTERN.test(text.slice(matchEnd, followingQuoteStart));

            let strength = SPEAKER_STRENGTH.MENTION;
            if (isAdjacentTag) {
                strength = SPEAKER_STRENGTH.ADJACENT_TAG;
            } else if (isSpeechVerbTag) {
                strength = SPEAKER_STRENGTH.SPEECH_VERB;
            } else if (isWeakMention) {
                strength = SPEAKER_STRENGTH.WEAK;
            } else if (isActionBeat) {
                strength = SPEAKER_STRENGTH.ACTION_BEAT;
            }
            if (tagsFollowingQuote) strength = Math.min(strength, SPEAKER_STRENGTH.MENTION);

            const candidate = { assignment, distance, side, strength, name: assignment.name || speakerKey };
            if (isBetterSpeakerCandidate(candidate, best)) best = candidate;
        }
    }

    if (best && best.strength <= SPEAKER_STRENGTH.WEAK && defaultSpeaker) {
        return null;
    }

    return best;
}

export function findClosestMentionedSpeakerInContext(maskedText, windowStart, windowEnd, segmentStart, segmentEnd, lookup, sortedLookupKeys, defaultSpeaker = null) {
    const candidate = findSpeakerCandidateInContext(maskedText, windowStart, windowEnd, segmentStart, segmentEnd, lookup, sortedLookupKeys, defaultSpeaker);
    return candidate?.assignment || null;
}

// Models write a paragraph per speaker: the paragraph opens by naming whoever
// is acting, quotes them, and never repeats the name. So the paragraph's
// subject is the first name in it that is neither possessive ("Alice's coat")
// nor the object of a preposition ("handed it to Alice") -- both of those mark
// someone being acted upon rather than acting.
//
// A name that opens a sentence outranks an earlier one buried inside one, so
// "*Where is Carol?* Alice checked the hall." is Alice's paragraph even though
// Carol is named first.
export function findParagraphSubjectSpeaker(maskedText, paragraph, lookup, sortedLookupKeys) {
    const text = String(maskedText ?? '');
    const rangeStart = Math.max(0, Math.min(text.length, paragraph?.start ?? 0));
    const rangeEnd = Math.max(rangeStart, Math.min(text.length, paragraph?.end ?? text.length));
    if (rangeStart >= rangeEnd) return null;

    const cleanRange = makeLengthPreservingSearchText(text.slice(rangeStart, rangeEnd));
    let best = null;

    for (const speakerKey of sortedLookupKeys) {
        const assignment = lookup.get(speakerKey);
        if (!assignment) continue;
        const regex = getSpeakerNameRegex(speakerKey);
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(cleanRange)) !== null) {
            if (best?.leading && match.index >= best.index) break;
            if (/['’]s?$/i.test(match[0])) {
                // "Alice's gaze swept the room" still opens on Alice acting.
                const owned = cleanRange.slice(match.index + match[0].length).match(/^\s*([a-zA-Z]+)/);
                if (!owned || !speakerPossessedNouns.has(owned[1].toLowerCase())) continue;
            }
            const preMatch = cleanRange.slice(Math.max(0, match.index - 30), match.index).match(/\b([a-zA-Z]+)\b\s*$/);
            if (preMatch && passivePrepositions.has(preMatch[1].toLowerCase())) continue;
            const leading = SENTENCE_LEADING_PATTERN.test(cleanRange.slice(0, match.index));
            if (best && !(leading && !best.leading) && !(leading === best.leading && match.index < best.index)) continue;
            best = { assignment, name: assignment.name || speakerKey, index: match.index, offset: rangeStart + match.index, leading };
        }
    }

    return best;
}

// Distance decays confidence gently: a tag right next to the quote is worth
// more than the same evidence 200 characters away, but never enough to drop
// a strong tag below a weak one.
export function scoreSpeakerCandidateConfidence(candidate) {
    const base = candidate?.strength >= SPEAKER_STRENGTH.ADJACENT_TAG ? 0.92
        : candidate?.strength === SPEAKER_STRENGTH.SPEECH_VERB ? 0.86
            : candidate?.strength === SPEAKER_STRENGTH.ACTION_BEAT ? 0.78
                : candidate?.strength === SPEAKER_STRENGTH.MENTION ? 0.62
                    : 0.4;
    const distance = Number.isFinite(candidate?.distance) ? Math.max(0, candidate.distance) : 0;
    const penalty = Math.min(0.12, distance / 600);
    return Math.min(0.95, Math.max(0.35, base - penalty));
}

// True when a subject pronoun stands in for the speaker on this quote, i.e.
// the pronoun is glued to the quote or paired with a speaking verb. Object
// forms never reach here, so "he handed it to her" cannot trigger a bind.
export function findPronounSpeechTag(maskedText, segmentStart, segmentEnd, paragraph) {
    const text = String(maskedText ?? '');
    const rangeStart = Math.max(0, Math.min(text.length, paragraph?.start ?? 0));
    const rangeEnd = Math.max(rangeStart, Math.min(text.length, paragraph?.end ?? text.length));
    const before = makeLengthPreservingSearchText(text.slice(rangeStart, Math.max(rangeStart, Math.min(segmentStart, rangeEnd))));
    const after = makeLengthPreservingSearchText(text.slice(Math.min(rangeEnd, Math.max(segmentEnd, rangeStart)), rangeEnd));

    // "..." she said. / "..." said she
    const afterMatch = after.match(/^[\s:,-]{0,6}([a-zA-Z]+)\b\s*([a-zA-Z]+)?/);
    if (afterMatch) {
        const first = afterMatch[1].toLowerCase();
        const second = (afterMatch[2] || '').toLowerCase();
        if (pronounSubjects.has(first) && speakingVerbs.has(second)) return { pronoun: first, side: 'after', offset: segmentEnd };
        if (speakingVerbs.has(first) && pronounSubjects.has(second)) return { pronoun: second, side: 'after', offset: segmentEnd };
    }

    // She said, "..." / She: "..."
    const beforeMatch = before.match(/\b([a-zA-Z]+)\b(?:\s+([a-zA-Z]+)\b)?[\s:,-]{0,6}$/);
    if (beforeMatch) {
        const last = (beforeMatch[2] || beforeMatch[1]).toLowerCase();
        const previous = beforeMatch[2] ? beforeMatch[1].toLowerCase() : '';
        if (pronounSubjects.has(last)) return { pronoun: last, side: 'before', offset: segmentStart };
        if (speakingVerbs.has(last) && pronounSubjects.has(previous)) return { pronoun: previous, side: 'before', offset: segmentStart };
    }

    return null;
}

// Bind a pronoun speech tag to the nearest preceding name that is not itself a
// prop possessive or an addressee. Gender-free by design: no pronoun-to-
// character mapping is stored or guessed.
//
// The antecedent may sit in an earlier line -- 'Alice stood by the door.' then
// a blank line then '"Are you ready?" she asked.' is one of the most common
// shapes there is -- so options.antecedentStart may widen the search backwards,
// and options.antecedentText may swap in a text where narration is legible.
export function bindPronounSpeakerInParagraph(maskedText, segmentStart, segmentEnd, paragraph, lookup, sortedLookupKeys, options = {}) {
    const tag = findPronounSpeechTag(maskedText, segmentStart, segmentEnd, paragraph);
    if (!tag) return null;
    const paragraphStart = paragraph?.start ?? 0;
    const searchText = options.antecedentText ?? maskedText;
    const searchStart = Math.max(0, Math.min(paragraphStart, options.antecedentStart ?? paragraphStart));
    // The probe ends where the quote starts even for a trailing tag: reaching
    // past it would have to step over the quote to find any name at all.
    const candidate = findSpeakerCandidateInContext(
        searchText, searchStart, segmentStart, segmentStart, segmentStart, lookup, sortedLookupKeys, null,
        { segments: options.segments, paragraphStart: searchStart },
    );
    if (!candidate || candidate.side !== 'before' || candidate.strength < SPEAKER_STRENGTH.MENTION) return null;
    return { ...candidate, pronoun: tag.pronoun };
}

// A name used as direct address inside the quote names the listener: nobody
// calls their own name to get their own attention. It fires on '"Alice, wait."',
// '"Come here, Alice."' and '"Hey Alice, look at this."', but not on a name that
// is simply part of the sentence ('"I saw Alice yesterday."').
export const vocativeRegexCache = new Map();

export function findAddressedSpeakerKeys(segmentText, lookup, sortedLookupKeys) {
    const addressed = new Set();
    const text = makeLengthPreservingSearchText(String(segmentText ?? ''));
    if (!text.trim()) return addressed;
    for (const speakerKey of sortedLookupKeys) {
        const assignment = lookup.get(speakerKey);
        if (!assignment?.key || addressed.has(assignment.key)) continue;
        let regex = vocativeRegexCache.get(speakerKey);
        if (!regex) {
            const trailingBoundary = CJK_SPEAKER_PATTERN.test(speakerKey) ? '' : '(?![\\p{L}\\p{N}])';
            regex = new RegExp(
                `(?:^[\\s"'“”«»‘’(\\[]*|[,;:]\\s*|\\b(?:oh|hey|hi|hello|yo|well|please|thanks|sorry|look|listen|wait|stop|yes|no|goodbye|bye)[,!\\s]+)`
                + `${escapeRegex(speakerKey)}${trailingBoundary}\\s*(?=[,!?.:…—–-]|["'“”«»‘’)\\]\\s]*$)`,
                'iu',
            );
            vocativeRegexCache.set(speakerKey, regex);
        }
        if (regex.test(text)) addressed.add(assignment.key);
    }
    return addressed;
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

// Mirrors SillyTavern's balanceStreamingMarkdown: it closes an odd delimiter
// before formatting, so a half-typed quote is already a complete <q> in the DOM.
// Parsing the unbalanced text instead leaves us one segment short every tick,
// which shifts indices and re-targets matches.
export function balanceStreamingText(text) {
    let balanced = String(text ?? '');
    for (const char of ['*', '"']) {
        let count = 0;
        for (let i = 0; i < balanced.length; i++) {
            if (balanced[i] === char) count++;
        }
        if (count % 2 === 1) balanced = balanced.trimEnd() + char;
    }
    return balanced;
}

export function attributeDialogueSegments(rawText, messageSpeakerName = '', options = {}) {
    const result = { segments: [], hadDialogueMatches: false, hadResolvableSpeaker: false, createdCharacters: false, usedAssignments: [] };
    const dialogueRegex = buildDialogueRegex();
    if (!dialogueRegex) return result;

    const raw = options.streaming === true
        ? balanceStreamingText(rawText)
        : String(rawText ?? '');
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
    // Models very often put the acting character's name inside the action
    // itself ("*Bob shrugs.* \"Fine.\""). maskedText blanks emphasis along with
    // quotes, so the paragraph-subject tier reads a text where only real
    // speech is hidden and narration -- asterisked or not -- is still legible.
    const narrationText = buildMaskedDialogueText(raw, collectedSegments.filter(segment => segment.delimiter !== '*' && segment.delimiter !== '_'));
    // Four deep rather than two: a three-way scene used to evict the third
    // speaker before it could ever be alternated back to. Selection still
    // walks backwards to the most recent distinct key, so two-speaker
    // ping-pong resolves exactly as before.
    const rememberSpeaker = assignment => {
        if (!assignment?.key) return;
        const lastKey = recentSpeakerKeys[recentSpeakerKeys.length - 1];
        if (lastKey !== assignment.key) recentSpeakerKeys.push(assignment.key);
        while (recentSpeakerKeys.length > 4) recentSpeakerKeys.shift();
    };
    const getAlternatingAssignment = (isEligible = () => true) => {
        if (!lastResolvedSpeakerKey) return null;
        for (let i = recentSpeakerKeys.length - 2; i >= 0; i--) {
            const key = recentSpeakerKeys[i];
            if (key && key !== lastResolvedSpeakerKey && isEligible(key)) return lookup.get(key) || null;
        }
        if (defaultSpeaker?.key && defaultSpeaker.key !== lastResolvedSpeakerKey && isEligible(defaultSpeaker.key)) return defaultSpeaker;
        return null;
    };
    let previousParagraph = null;
    let previousConfidence = 0;
    let previouslyAddressedKeys = new Set();

    const isSpeechSegment = segment => segment.delimiter !== '*' && segment.delimiter !== '_';
    const speechSegments = collectedSegments.filter(isSpeechSegment);

    const paragraphSubjects = new Map();
    const getParagraphSubject = paragraph => {
        const key = `${paragraph.start}:${paragraph.end}`;
        if (!paragraphSubjects.has(key)) {
            paragraphSubjects.set(key, findParagraphSubjectSpeaker(narrationText, paragraph, lookup, sortedLookupKeys));
        }
        return paragraphSubjects.get(key);
    };

    // Models break an action beat and its dialogue apart with a newline at least
    // as often as they keep them on one line:
    //
    //     Alice folded her arms.
    //
    //     "I am not doing this."
    //
    // Nothing in the quote's own line names anyone, so every in-paragraph tier
    // misses and the quote used to fall through to alternation or the message
    // default. Walk back to the nearest narration line instead and let its actor
    // speak. The walk stops at a line that already holds speech, because prose
    // hands the next line to somebody else once a character has had their turn.
    const PRECEDING_SUBJECT_HOPS = 3;
    const precedingSubjects = new Map();
    const getPrecedingNarrationSubject = paragraph => {
        const cacheKey = `${paragraph.start}:${paragraph.end}`;
        if (precedingSubjects.has(cacheKey)) return precedingSubjects.get(cacheKey);
        let found = null;
        let cursor = paragraph.start;
        for (let hops = 0; hops < PRECEDING_SUBJECT_HOPS; hops++) {
            const previous = getPrecedingParagraphRange(raw, cursor);
            if (!previous) break;
            if (speechSegments.some(other => other.start < previous.end && other.end > previous.start)) break;
            const subject = findParagraphSubjectSpeaker(narrationText, previous, lookup, sortedLookupKeys);
            if (subject) {
                found = { ...subject, hops, paragraph: previous };
                break;
            }
            cursor = previous.start;
        }
        precedingSubjects.set(cacheKey, found);
        return found;
    };

    // True when the narration names a known character other than the message
    // speaker, which is the classic "an NPC speaks inside someone else's
    // message" shape. Computed once per message, not per segment.
    let competingNamedKeys = null;
    const getCompetingNamedKeys = () => {
        if (competingNamedKeys === null) {
            competingNamedKeys = new Set();
            // narrationText rather than maskedText: a rival named only inside an
            // asterisked action is every bit as present in the scene.
            const searchText = makeLengthPreservingSearchText(narrationText);
            for (const key of sortedLookupKeys) {
                const assignment = lookup.get(key);
                if (!assignment?.key) continue;
                const regex = getSpeakerNameRegex(key);
                regex.lastIndex = 0;
                if (regex.test(searchText)) competingNamedKeys.add(assignment.key);
            }
        }
        return competingNamedKeys;
    };
    const hasCompetingNamedSpeaker = speakerKey => {
        for (const key of getCompetingNamedKeys()) {
            if (key !== speakerKey) return true;
        }
        return false;
    };

    // Only the streaming painter opts in. Keying off a global flag let unrelated
    // callers read and write the same cache with different options, so whichever
    // scheduler won the race decided the speaker.
    const isStreamingMsg = options.streaming === true && options.mesIndex === streamingSession.mesIndex;
    const stickyKeyCounts = isStreamingMsg ? new Map() : null;
    const nextStickyKey = segment => {
        const text = normalizeSegmentText(segment.text);
        const ordinal = stickyKeyCounts.get(text) || 0;
        stickyKeyCounts.set(text, ordinal + 1);
        return `${text}#${ordinal}`;
    };

    for (const segment of collectedSegments) {
        // Offsets shift on every token, so the sticky key is the segment's own
        // text plus how many identical quotes precede it.
        const stickyKey = isStreamingMsg ? nextStickyKey(segment) : '';
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
        const overrideSource = getSegmentMapValue(options.overrideSources, segment.index)
            ?? overrideRecord?.source
            ?? overrideValue?.source;
        const frozenOverride = normalizeAttributionSource(overrideSource) === ATTRIBUTION_SOURCE.FROZEN;
        if (overrideName) {
            assignment = resolveSingleSpeakerAssignment(String(overrideName), lookup);
            if (assignment) {
                const source = overrideSource ?? ATTRIBUTION_SOURCE.OVERRIDE;
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
        const frozenUnresolved = frozenOverride && !assignment;
        if (frozenUnresolved) {
            attributionMetadata = createSegmentProvenance(
                ATTRIBUTION_SOURCE.FROZEN,
                'frozen-unresolved',
                1,
                [{ type: 'frozen-unresolved', segmentIndex: segment.index }],
            );
        }

        if (!assignment && !frozenUnresolved && isStreamingMsg && streamingSession.assignments.has(stickyKey)) {
            assignment = streamingSession.assignments.get(stickyKey);
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.STREAMING_CACHE,
                    'streaming-cache',
                    0.8,
                    [{ type: 'cached-segment-text', key: stickyKey }],
                );
            }
        }

        // A character the quote calls by name is being spoken to, so every tier
        // that is guessing rather than reading a tag has to rule them out.
        let addressedKeys = null;
        const isAddressedInQuote = key => {
            if (addressedKeys === null) addressedKeys = findAddressedSpeakerKeys(segment.text, lookup, sortedLookupKeys);
            return !!key && addressedKeys.has(key);
        };

        // Tier 2: masked, paragraph-scoped proximity near the quote.
        if (!assignment && !frozenUnresolved) {
            const windowStart = Math.max(segment.paragraph.start, segment.start - 240);
            const windowEnd = Math.min(segment.paragraph.end, segment.end + 120);
            const probeOptions = { segments: collectedSegments, paragraphStart: segment.paragraph.start, segmentText: segment.text };
            let candidate = findSpeakerCandidateInContext(maskedText, windowStart, windowEnd, segment.start, segment.end, lookup, sortedLookupKeys, defaultSpeaker, probeOptions);
            // Emphasis is masked alongside speech, so a beat written as
            // '*Carol drops her bag.* "Traffic."' hides the only name there is.
            // Re-probe the narration text for those, and demand a real beat or
            // tag from it so a name merely mentioned inside a thought cannot
            // claim the quote.
            const hasEmphasisNearby = collectedSegments.some(other => !isSpeechSegment(other)
                && other.start < segment.paragraph.end && other.end > segment.paragraph.start);
            if (hasEmphasisNearby && !(candidate?.strength >= SPEAKER_STRENGTH.ACTION_BEAT)) {
                const narrated = findSpeakerCandidateInContext(narrationText, windowStart, windowEnd, segment.start, segment.end, lookup, sortedLookupKeys, defaultSpeaker, { ...probeOptions, segments: speechSegments });
                if (narrated?.strength >= SPEAKER_STRENGTH.ACTION_BEAT) candidate = narrated;
            }
            if (candidate && candidate.strength < SPEAKER_STRENGTH.SPEECH_VERB && isAddressedInQuote(candidate.assignment.key)) candidate = null;
            // A possessive or an addressee ("he glanced at Alice") is weaker
            // evidence than the name the paragraph opened on, so let the
            // subject tier answer instead of colouring the wrong character.
            const outrankedBySubject = candidate?.strength <= SPEAKER_STRENGTH.WEAK && !!getParagraphSubject(segment.paragraph);
            assignment = outrankedBySubject ? null : (candidate?.assignment || null);
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.EXPLICIT_MENTION,
                    'context-proximity',
                    scoreSpeakerCandidateConfidence(candidate),
                    [{
                        type: 'nearby-speaker-mention',
                        speaker: candidate.name,
                        distance: candidate.distance,
                        strength: candidate.strength,
                        method: candidate.side,
                    }],
                );
            }
        }

        // Tier 2.5: a pronoun speech tag bound to the nearest preceding name.
        // Always weaker than a literal mention. The antecedent may sit in an
        // earlier narration line, which is where models usually put it.
        if (!assignment && !frozenUnresolved) {
            const antecedent = getPrecedingNarrationSubject(segment.paragraph);
            const bound = bindPronounSpeakerInParagraph(maskedText, segment.start, segment.end, segment.paragraph, lookup, sortedLookupKeys, {
                antecedentText: narrationText,
                antecedentStart: antecedent?.paragraph?.start ?? segment.paragraph.start,
                segments: speechSegments,
            });
            assignment = bound && !isAddressedInQuote(bound.assignment.key) ? bound.assignment : null;
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.EXPLICIT_MENTION,
                    'pronoun-proximity',
                    Math.max(0.35, 0.58 - Math.min(0.12, Math.max(0, bound.distance) / 600)),
                    [{
                        type: 'pronoun-speech-tag',
                        speaker: bound.name,
                        detail: bound.pronoun,
                        distance: bound.distance,
                        strength: bound.strength,
                    }],
                );
            }
        }

        // Tier 2.75: the character the paragraph is about. Weaker than any
        // speech tag, but stronger than carrying or alternating, because a
        // paragraph that opens on a name is that character's turn even when
        // the quote sits far from it or ahead of it.
        if (!assignment && !frozenUnresolved) {
            const subject = getParagraphSubject(segment.paragraph);
            assignment = subject && !isAddressedInQuote(subject.assignment.key) ? subject.assignment : null;
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.PARAGRAPH_SUBJECT,
                    'paragraph-subject',
                    0.55,
                    [{ type: 'paragraph-subject', speaker: subject.name, start: subject.offset }],
                );
            }
        }

        // Tier 3: carry only within the same paragraph/line. Doubt propagates:
        // a carried speaker can never read as more certain than the segment it
        // was carried from.
        if (!assignment && !frozenUnresolved && sameParagraphAsPrevious && lastResolvedSpeakerKey) {
            const carried = lookup.get(lastResolvedSpeakerKey) || null;
            assignment = carried && !isAddressedInQuote(carried.key) ? carried : null;
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.PARAGRAPH_CARRY,
                    'same-paragraph-carry',
                    Math.min(0.7, previousConfidence),
                    [{ type: 'same-paragraph-speaker', speaker: assignment.name }],
                );
            }
        }

        // Tier 3.5: the actor of the narration line above. This is the shape the
        // in-paragraph tiers structurally cannot see -- a beat, a newline, then
        // a bare quote -- and it is far better evidence than alternating.
        if (!assignment && !frozenUnresolved) {
            const preceding = getPrecedingNarrationSubject(segment.paragraph);
            assignment = preceding && !isAddressedInQuote(preceding.assignment.key) ? preceding.assignment : null;
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.PARAGRAPH_SUBJECT,
                    'preceding-paragraph-subject',
                    Math.max(0.38, 0.55 - preceding.hops * 0.08),
                    [{ type: 'preceding-paragraph-subject', speaker: preceding.name, start: preceding.offset, distance: preceding.hops }],
                );
            }
        }

        // Tier 3.75: the previous quote called somebody by name, so the reply on
        // the next line is theirs. Evidence-backed where plain alternation is a
        // coin flip, which is what a scene with three or more speakers gives.
        if (!assignment && !frozenUnresolved && !sameParagraphAsPrevious && previouslyAddressedKeys.size === 1) {
            const [addressedKey] = previouslyAddressedKeys;
            const replier = addressedKey !== lastResolvedSpeakerKey && !isAddressedInQuote(addressedKey)
                ? lookup.get(addressedKey) || null
                : null;
            assignment = replier;
            if (assignment) {
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.ALTERNATION,
                    'addressed-speaker-reply',
                    0.6,
                    [{ type: 'addressed-speaker-reply', speaker: assignment.name }],
                );
            }
        }

        // Tier 4: alternate speakers across unattributed new paragraphs.
        if (!assignment && !frozenUnresolved && !sameParagraphAsPrevious) {
            assignment = getAlternatingAssignment(key => !isAddressedInQuote(key));
            if (assignment) {
                const distinctRecent = new Set(recentSpeakerKeys.filter(Boolean)).size;
                attributionMetadata = createSegmentProvenance(
                    ATTRIBUTION_SOURCE.ALTERNATION,
                    'recent-speaker-alternation',
                    distinctRecent >= 3 ? 0.3 : Math.min(0.45, previousConfidence),
                    [{ type: 'recent-speaker-alternation', speaker: assignment.name, strength: distinctRecent }],
                );
            }
        }

        // Tier 5: default message speaker. Another known character named in the
        // narration means this is a guess, not a default, and the quote calling
        // the default speaker by name means it is very probably wrong -- but a
        // colourless quote helps nobody, so say so in the confidence instead.
        if (!assignment && !frozenUnresolved) {
            assignment = defaultSpeaker || ensureDefaultSpeaker();
            if (assignment) {
                const fromColorBlock = defaultSpeakerSource === ATTRIBUTION_SOURCE.COLOR_BLOCK;
                const addressed = isAddressedInQuote(assignment.key);
                const contested = !fromColorBlock && hasCompetingNamedSpeaker(assignment.key);
                const confidence = addressed ? 0.3 : (fromColorBlock ? 0.75 : (contested ? 0.45 : 0.6));
                attributionMetadata = createSegmentProvenance(
                    fromColorBlock ? ATTRIBUTION_SOURCE.COLOR_BLOCK : ATTRIBUTION_SOURCE.MESSAGE_SPEAKER,
                    fromColorBlock ? 'sole-color-assignment' : 'message-speaker-default',
                    confidence,
                    addressed
                        ? [{ type: 'addressed-in-quote', speaker: assignment.name }]
                        : [{ type: fromColorBlock ? 'sole-color-assignment' : 'message-speaker', speaker: assignment.name }],
                );
            }
        }

        if (isStreamingMsg && assignment) {
            streamingSession.assignments.set(stickyKey, assignment);
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
        if (isSpeechSegment(segment)) {
            previouslyAddressedKeys = addressedKeys ?? findAddressedSpeakerKeys(segment.text, lookup, sortedLookupKeys);
        }
        if (assignment) previousConfidence = attributionMetadata.confidence;
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
