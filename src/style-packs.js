// style-packs.js - pure style-pack validation, construction, and install planning.

import {
    ImportCodecError,
    analyzeJsonSource,
    canonicalizeJson,
    canonicalizeJsonValue,
    digestCanonicalJson,
    hardenJsonValue,
} from './import-codec.js';
import {
    MAX_GRADIENT_SECONDARY_STOPS,
    normalizeGradient,
    normalizeGradientPreset,
    normalizeGradientPresetName,
} from './gradients.js';

export const STYLE_PACK_FORMAT = 'dialogue-colors-style-pack';
export const STYLE_PACK_FORMAT_VERSION = 1;

export const STYLE_PACK_LIMITS = Object.freeze({
    maxCategories: 4,
    maxPalettes: 64,
    maxColorsPerPalette: 64,
    maxGradientPresets: 128,
    maxAssignmentPresets: 32,
    maxAssignmentsPerPreset: 500,
    maxAssignmentsTotal: 2000,
    maxAliasesPerAssignment: 32,
    maxAliasesTotal: 10000,
    maxUniqueFonts: 64,
    maxNameLength: 80,
    maxCharacterNameLength: 120,
    maxDescriptionLength: 4000,
    maxMetadataTags: 32,
    maxUrlLength: 2048,
});

export const STYLE_PACK_CATEGORIES = Object.freeze([
    'palettes',
    'gradientPresets',
    'assignmentPresets',
    'appearance',
]);

export const AESTHETIC_APPEARANCE_KEYS = Object.freeze([
    'themeMode',
    'colorTheme',
    'brightness',
    'narratorColor',
    'highlightMode',
    'showLegend',
    'driftAllGradientColors',
]);

const RESERVED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const TOP_LEVEL_KEYS = new Set(['format', 'formatVersion', 'metadata', ...STYLE_PACK_CATEGORIES]);
const METADATA_TEXT_LIMITS = Object.freeze({
    id: 120,
    name: 120,
    description: STYLE_PACK_LIMITS.maxDescriptionLength,
    author: 160,
    version: 80,
    license: 160,
});
const METADATA_URL_KEYS = Object.freeze([
    'homepage',
    'repository',
    'sourceUrl',
    'authorUrl',
    'previewUrl',
]);
const VALID_STYLES = new Set(['', 'bold', 'italic', 'bold italic']);
const INSTALLABLE_CATEGORIES = Object.freeze(['palettes', 'gradientPresets', 'assignmentPresets']);

export class StylePackError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = 'StylePackError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function dictionary() {
    return Object.create(null);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedLookupName(value) {
    return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function fail(code, message, details) {
    throw new StylePackError(code, message, details);
}

function assertRecord(value, field) {
    if (!isRecord(value)) fail('invalid_record', `${field} must be a JSON object.`, { field });
}

function normalizeString(value, field, maximum, { required = false, multiline = false } = {}) {
    if (value === undefined || value === null) {
        if (required) fail('missing_field', `${field} is required.`, { field });
        return '';
    }
    if (typeof value !== 'string') fail('invalid_string', `${field} must be a string.`, { field });
    const normalized = value
        .normalize('NFKC')
        .replace(/\r\n?/g, '\n')
        .replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '')
        .replace(multiline ? /[ \t]+$/gm : /\s+/g, ' ')
        .trim();
    if (required && !normalized) fail('missing_field', `${field} is required.`, { field });
    if (normalized.length > maximum) {
        fail('string_too_long', `${field} exceeds ${maximum} characters.`, { field, maximum });
    }
    return normalized;
}

function normalizeDictionaryName(value, field) {
    const name = normalizeString(value, field, STYLE_PACK_LIMITS.maxNameLength, { required: true });
    if (RESERVED_NAMES.has(name)) fail('reserved_key', `Reserved name "${name}" is not allowed.`, { field, name });
    return name;
}

function normalizeHttpUrl(value, field) {
    const raw = normalizeString(value, field, STYLE_PACK_LIMITS.maxUrlLength);
    if (!raw) return '';
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        fail('invalid_url', `${field} must be an absolute HTTP(S) URL.`, { field });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        fail('unsafe_url', `${field} must use HTTP or HTTPS.`, { field, protocol: parsed.protocol });
    }
    if (parsed.username || parsed.password) {
        fail('unsafe_url', `${field} must not contain embedded credentials.`, { field });
    }
    return parsed.href;
}

function assertNoUnsafeUrlFields(value, path = '$') {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertNoUnsafeUrlFields(entry, `${path}[${index}]`));
        return;
    }
    if (!isRecord(value)) return;
    for (const [key, entry] of Object.entries(value)) {
        const nextPath = `${path}.${key}`;
        if ((/(?:url|uri)$/i.test(key) || METADATA_URL_KEYS.includes(key)) && entry !== '' && entry !== null && entry !== undefined) {
            normalizeHttpUrl(entry, nextPath);
        }
        assertNoUnsafeUrlFields(entry, nextPath);
    }
}

function normalizeTimestamp(value, field) {
    const raw = normalizeString(value, field, 40);
    if (!raw) return '';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
        fail('invalid_timestamp', `${field} must include an ISO date, time, and timezone.`, { field });
    }
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) fail('invalid_timestamp', `${field} must be an ISO-compatible timestamp.`, { field });
    return new Date(timestamp).toISOString();
}

function normalizeMetadata(value) {
    assertRecord(value, 'metadata');
    const metadata = dictionary();
    for (const [field, maximum] of Object.entries(METADATA_TEXT_LIMITS)) {
        const normalized = normalizeString(value[field], `metadata.${field}`, maximum, {
            required: field === 'name',
            multiline: field === 'description',
        });
        if (normalized) metadata[field] = normalized;
    }
    for (const field of METADATA_URL_KEYS) {
        const normalized = normalizeHttpUrl(value[field], `metadata.${field}`);
        if (normalized) metadata[field] = normalized;
    }
    for (const field of ['createdAt', 'updatedAt']) {
        const normalized = normalizeTimestamp(value[field], `metadata.${field}`);
        if (normalized) metadata[field] = normalized;
    }
    if (value.tags !== undefined) {
        if (!Array.isArray(value.tags)) fail('invalid_metadata', 'metadata.tags must be an array.');
        if (value.tags.length > STYLE_PACK_LIMITS.maxMetadataTags) {
            fail('too_many_tags', `metadata.tags exceeds ${STYLE_PACK_LIMITS.maxMetadataTags} entries.`);
        }
        const tags = [...new Set(value.tags.map((tag, index) => normalizeString(
            tag,
            `metadata.tags[${index}]`,
            STYLE_PACK_LIMITS.maxNameLength,
            { required: true },
        )))].sort(compareText);
        if (tags.length) metadata.tags = tags;
    }
    return metadata;
}

function normalizeHex(value, field) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
        fail('invalid_color', `${field} must be a six-digit hex color.`, { field });
    }
    return value.trim().toLowerCase();
}

function normalizePalettes(value) {
    assertRecord(value, 'palettes');
    const entries = Object.entries(value);
    if (entries.length > STYLE_PACK_LIMITS.maxPalettes) {
        fail('too_many_palettes', `A pack may contain at most ${STYLE_PACK_LIMITS.maxPalettes} palettes.`);
    }
    const palettes = dictionary();
    const names = new Set();
    for (const [rawName, rawPalette] of entries.sort(([left], [right]) => compareText(left, right))) {
        const name = normalizeDictionaryName(rawName, 'palette name');
        const lookup = normalizedLookupName(name);
        if (names.has(lookup)) fail('duplicate_name', `Duplicate palette name "${name}".`);
        names.add(lookup);
        const rawColors = Array.isArray(rawPalette) ? rawPalette : rawPalette?.colors;
        if (!Array.isArray(rawColors) || !rawColors.length) {
            fail('invalid_palette', `Palette "${name}" must contain at least one color.`);
        }
        if (rawColors.length > STYLE_PACK_LIMITS.maxColorsPerPalette) {
            fail('too_many_colors', `Palette "${name}" exceeds ${STYLE_PACK_LIMITS.maxColorsPerPalette} colors.`);
        }
        const colors = [...new Set(rawColors.map((color, index) => normalizeHex(color, `palettes.${name}[${index}]`)))];
        palettes[name] = colors;
    }
    return palettes;
}

function assertGradientStopCount(rawGradient, field) {
    if (rawGradient?.stops !== undefined && !Array.isArray(rawGradient.stops)) {
        fail('invalid_gradient', `${field}.stops must be an array.`);
    }
    if (rawGradient?.stops?.length > MAX_GRADIENT_SECONDARY_STOPS) {
        fail('too_many_gradient_stops', `${field} exceeds the supported gradient stop count.`);
    }
}

function normalizeGradientPresets(value) {
    assertRecord(value, 'gradientPresets');
    const entries = Object.entries(value);
    if (entries.length > STYLE_PACK_LIMITS.maxGradientPresets) {
        fail('too_many_gradient_presets', `A pack may contain at most ${STYLE_PACK_LIMITS.maxGradientPresets} gradient presets.`);
    }
    const presets = dictionary();
    const names = new Set();
    for (const [rawName, rawPreset] of entries.sort(([left], [right]) => compareText(left, right))) {
        const name = normalizeDictionaryName(normalizeGradientPresetName(rawName), 'gradient preset name');
        const lookup = normalizedLookupName(name);
        if (names.has(lookup)) fail('duplicate_name', `Duplicate gradient preset name "${name}".`);
        names.add(lookup);
        assertGradientStopCount(rawPreset?.gradient, `gradientPresets.${name}.gradient`);
        const preset = normalizeGradientPreset(rawPreset);
        if (!preset) fail('invalid_gradient_preset', `Gradient preset "${name}" is invalid.`);
        presets[name] = hardenJsonValue(preset);
    }
    return presets;
}

function normalizeFont(value, field) {
    const raw = normalizeString(value, field, 80);
    if (!raw) return '';
    return raw
        .replace(/[^A-Za-z0-9 .,'&+-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function normalizeAliases(value, field, totals) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) fail('invalid_aliases', `${field} must be an array.`);
    if (value.length > STYLE_PACK_LIMITS.maxAliasesPerAssignment) {
        fail('too_many_aliases', `${field} exceeds ${STYLE_PACK_LIMITS.maxAliasesPerAssignment} aliases.`);
    }
    totals.aliases += value.length;
    if (totals.aliases > STYLE_PACK_LIMITS.maxAliasesTotal) {
        fail('too_many_aliases', `A pack may contain at most ${STYLE_PACK_LIMITS.maxAliasesTotal} aliases.`);
    }
    return [...new Set(value.map((alias, index) => normalizeString(
        alias,
        `${field}[${index}]`,
        STYLE_PACK_LIMITS.maxCharacterNameLength,
        { required: true },
    )))].sort(compareText);
}

function normalizeAssignment(value, field, totals) {
    assertRecord(value, field);
    const assignment = dictionary();
    assignment.name = normalizeString(value.name, `${field}.name`, STYLE_PACK_LIMITS.maxCharacterNameLength, { required: true });
    assignment.color = normalizeHex(value.color, `${field}.color`);
    assignment.baseColor = value.baseColor === undefined
        ? assignment.color
        : normalizeHex(value.baseColor, `${field}.baseColor`);
    assignment.style = VALID_STYLES.has(value.style) ? value.style : '';
    assignment.font = normalizeFont(value.font, `${field}.font`);
    assignment.aliases = normalizeAliases(value.aliases, `${field}.aliases`, totals);
    assignment.group = normalizeString(value.group, `${field}.group`, STYLE_PACK_LIMITS.maxCharacterNameLength);
    assignment.locked = value.locked === true;
    assignment.keep = value.keep === true;
    if (value.gradient !== undefined && value.gradient !== null) {
        assertGradientStopCount(value.gradient, `${field}.gradient`);
        const gradient = normalizeGradient(value.gradient);
        if (!gradient) fail('invalid_gradient', `${field}.gradient is invalid.`);
        assignment.gradient = hardenJsonValue(gradient);
    } else {
        assignment.gradient = null;
    }
    if (assignment.font) totals.fonts.add(assignment.font.toLowerCase());
    if (totals.fonts.size > STYLE_PACK_LIMITS.maxUniqueFonts) {
        fail('too_many_fonts', `A pack may reference at most ${STYLE_PACK_LIMITS.maxUniqueFonts} fonts.`);
    }
    return assignment;
}

function normalizeAssignmentPresets(value) {
    assertRecord(value, 'assignmentPresets');
    const entries = Object.entries(value);
    if (entries.length > STYLE_PACK_LIMITS.maxAssignmentPresets) {
        fail('too_many_assignment_presets', `A pack may contain at most ${STYLE_PACK_LIMITS.maxAssignmentPresets} assignment presets.`);
    }
    const totals = { assignments: 0, aliases: 0, fonts: new Set() };
    const presets = dictionary();
    const names = new Set();
    for (const [rawName, rawAssignments] of entries.sort(([left], [right]) => compareText(left, right))) {
        const name = normalizeDictionaryName(rawName, 'assignment preset name');
        const lookup = normalizedLookupName(name);
        if (names.has(lookup)) fail('duplicate_name', `Duplicate assignment preset name "${name}".`);
        names.add(lookup);
        if (!Array.isArray(rawAssignments)) fail('invalid_assignment_preset', `Assignment preset "${name}" must be an array.`);
        if (rawAssignments.length > STYLE_PACK_LIMITS.maxAssignmentsPerPreset) {
            fail('too_many_assignments', `Assignment preset "${name}" exceeds ${STYLE_PACK_LIMITS.maxAssignmentsPerPreset} entries.`);
        }
        totals.assignments += rawAssignments.length;
        if (totals.assignments > STYLE_PACK_LIMITS.maxAssignmentsTotal) {
            fail('too_many_assignments', `A pack may contain at most ${STYLE_PACK_LIMITS.maxAssignmentsTotal} assignments.`);
        }
        presets[name] = rawAssignments
            .map((assignment, index) => normalizeAssignment(assignment, `assignmentPresets.${name}[${index}]`, totals))
            .sort((left, right) => compareText(normalizedLookupName(left.name), normalizedLookupName(right.name)));
    }
    return presets;
}

function normalizeAppearance(value) {
    assertRecord(value, 'appearance');
    const appearance = dictionary();
    if (value.themeMode !== undefined) {
        if (!['auto', 'dark', 'light'].includes(value.themeMode)) fail('invalid_appearance', 'appearance.themeMode is invalid.');
        appearance.themeMode = value.themeMode;
    }
    if (value.colorTheme !== undefined) {
        appearance.colorTheme = normalizeString(value.colorTheme, 'appearance.colorTheme', STYLE_PACK_LIMITS.maxNameLength, { required: true });
    }
    if (value.brightness !== undefined) {
        const brightness = Number(value.brightness);
        if (!Number.isFinite(brightness)) fail('invalid_appearance', 'appearance.brightness must be a finite number.');
        appearance.brightness = Math.max(-100, Math.min(100, brightness));
    }
    if (value.narratorColor !== undefined && value.narratorColor !== '') {
        appearance.narratorColor = normalizeHex(value.narratorColor, 'appearance.narratorColor');
    }
    for (const field of ['highlightMode', 'showLegend', 'driftAllGradientColors']) {
        if (value[field] === undefined) continue;
        if (typeof value[field] !== 'boolean') fail('invalid_appearance', `appearance.${field} must be boolean.`);
        appearance[field] = value[field];
    }
    return appearance;
}

function stripAssignments(pack) {
    if (!hasOwn(pack, 'assignmentPresets')) return pack;
    const stripped = dictionary();
    for (const key of Object.keys(pack)) {
        if (key !== 'assignmentPresets') stripped[key] = pack[key];
    }
    return stripped;
}

/**
 * Normalize a version-1 style pack. Assignment presets are validated but are
 * only returned after the caller explicitly opts in.
 */
export function normalizeStylePack(input, options = {}) {
    let source;
    try {
        source = hardenJsonValue(input);
    } catch (error) {
        if (error instanceof ImportCodecError) throw error;
        fail('invalid_pack', 'Style pack data is not valid bounded JSON.');
    }
    assertRecord(source, 'style pack');
    assertNoUnsafeUrlFields(source);
    for (const key of Object.keys(source)) {
        if (!TOP_LEVEL_KEYS.has(key)) fail('unknown_category', `Unknown style-pack field "${key}".`, { key });
    }
    const categoryCount = STYLE_PACK_CATEGORIES.filter(category => hasOwn(source, category)).length;
    if (categoryCount > STYLE_PACK_LIMITS.maxCategories) fail('too_many_categories', 'The style pack contains too many categories.');
    if (source.format !== STYLE_PACK_FORMAT) fail('invalid_format', `Expected format "${STYLE_PACK_FORMAT}".`);
    if (source.formatVersion !== STYLE_PACK_FORMAT_VERSION) {
        fail('unsupported_format_version', `Unsupported style-pack version: ${String(source.formatVersion)}.`);
    }

    const pack = dictionary();
    pack.format = STYLE_PACK_FORMAT;
    pack.formatVersion = STYLE_PACK_FORMAT_VERSION;
    pack.metadata = normalizeMetadata(source.metadata);
    if (hasOwn(source, 'palettes')) pack.palettes = normalizePalettes(source.palettes);
    if (hasOwn(source, 'gradientPresets')) pack.gradientPresets = normalizeGradientPresets(source.gradientPresets);
    if (hasOwn(source, 'assignmentPresets')) {
        const assignments = normalizeAssignmentPresets(source.assignmentPresets);
        if (options.includeAssignmentPresets === true) pack.assignmentPresets = assignments;
    }
    if (hasOwn(source, 'appearance')) pack.appearance = normalizeAppearance(source.appearance);
    if (!STYLE_PACK_CATEGORIES.some(category => hasOwn(pack, category))) {
        fail('empty_pack', 'The style pack contains no selected style data.');
    }
    return pack;
}

function selectionNames(selection, available, field) {
    if (selection === undefined || selection === null) return available.slice().sort(compareText);
    const values = selection instanceof Set ? [...selection] : selection;
    if (!Array.isArray(values)) fail('invalid_selection', `${field} selection must be an array or Set.`);
    const requested = [...new Set(values.map((name, index) => normalizeDictionaryName(name, `${field}[${index}]`)))];
    const byLookup = new Map(available.map(name => [normalizedLookupName(name), name]));
    return requested.map(name => {
        const actual = byLookup.get(normalizedLookupName(name));
        if (!actual) fail('missing_selection', `${field} selection "${name}" does not exist.`);
        return actual;
    }).sort(compareText);
}

function pickDictionary(source, selection, field) {
    if (source === undefined || source === null) return undefined;
    const hardened = hardenJsonValue(source);
    assertRecord(hardened, field);
    const selected = dictionary();
    for (const name of selectionNames(selection, Object.keys(hardened), field)) selected[name] = hardened[name];
    return selected;
}

function sourceCategory(source, primary, legacy) {
    if (source?.[primary] !== undefined) return source[primary];
    return legacy && source?.[legacy] !== undefined ? source[legacy] : undefined;
}

/** Build a pack from selected current catalogs without reading or writing storage. */
export function buildStylePack(source, options = {}) {
    const safeSource = hardenJsonValue(source);
    assertRecord(safeSource, 'style-pack source');
    const selection = isRecord(options.selection) ? options.selection : dictionary();
    const candidate = dictionary();
    candidate.format = STYLE_PACK_FORMAT;
    candidate.formatVersion = STYLE_PACK_FORMAT_VERSION;
    candidate.metadata = hardenJsonValue(options.metadata ?? safeSource.metadata);

    const paletteSource = sourceCategory(safeSource, 'palettes', 'customPalettes')
        ?? (isRecord(safeSource.selectedPalettes) ? safeSource.selectedPalettes : undefined);
    const paletteSelection = options.selectedPalettes ?? options.paletteNames ?? selection.palettes
        ?? (Array.isArray(safeSource.selectedPalettes) ? safeSource.selectedPalettes : undefined);
    const palettes = pickDictionary(paletteSource, paletteSelection, 'palettes');
    if (palettes && Object.keys(palettes).length) candidate.palettes = palettes;

    const gradientSource = sourceCategory(safeSource, 'gradientPresets', 'customGradientPresets');
    const gradients = pickDictionary(
        gradientSource,
        options.selectedGradientPresets ?? options.gradientPresetNames ?? selection.gradientPresets,
        'gradientPresets',
    );
    if (gradients && Object.keys(gradients).length) candidate.gradientPresets = gradients;

    if (options.includeAssignmentPresets === true) {
        const assignmentSource = sourceCategory(safeSource, 'assignmentPresets', 'presets');
        const assignments = pickDictionary(
            assignmentSource,
            options.selectedAssignmentPresets ?? options.assignmentPresetNames ?? selection.assignmentPresets,
            'assignmentPresets',
        );
        if (assignments && Object.keys(assignments).length) candidate.assignmentPresets = assignments;
    }

    const appearanceSource = safeSource.appearance ?? safeSource.settings;
    if (appearanceSource !== undefined && options.includeAppearance !== false) {
        candidate.appearance = hardenJsonValue(appearanceSource);
    }
    return normalizeStylePack(candidate, { includeAssignmentPresets: options.includeAssignmentPresets === true });
}

function catalogFromPack(pack) {
    const catalog = dictionary();
    catalog.palettes = Object.entries(pack.palettes || {}).map(([name, colors]) => {
        const entry = dictionary();
        entry.name = name;
        entry.colorCount = colors.length;
        return entry;
    });
    catalog.gradientPresets = Object.entries(pack.gradientPresets || {}).map(([name, preset]) => {
        const entry = dictionary();
        entry.name = name;
        entry.type = preset.gradient.type;
        entry.stopCount = 1 + preset.gradient.stops.length;
        entry.animated = preset.gradient.animation.enabled;
        return entry;
    });
    catalog.assignmentPresets = Object.entries(pack.assignmentPresets || {}).map(([name, assignments]) => {
        const entry = dictionary();
        entry.name = name;
        entry.assignmentCount = assignments.length;
        entry.aliasCount = assignments.reduce((total, assignment) => total + assignment.aliases.length, 0);
        entry.fontCount = new Set(assignments.map(assignment => assignment.font).filter(Boolean)).size;
        return entry;
    });
    catalog.appearance = Object.keys(pack.appearance || {}).sort(compareText);
    catalog.totals = dictionary();
    catalog.totals.palettes = catalog.palettes.length;
    catalog.totals.gradientPresets = catalog.gradientPresets.length;
    catalog.totals.assignmentPresets = catalog.assignmentPresets.length;
    catalog.totals.assignments = catalog.assignmentPresets.reduce((total, preset) => total + preset.assignmentCount, 0);
    catalog.totals.appearanceSettings = catalog.appearance.length;
    return catalog;
}

export function buildStylePackCatalog(input, options = {}) {
    return catalogFromPack(normalizeStylePack(input, options));
}

export const getStylePackCatalog = buildStylePackCatalog;

export function analyzeStylePack(input, options = {}) {
    try {
        const completePack = normalizeStylePack(input, { includeAssignmentPresets: true });
        const assignmentCount = Object.keys(completePack.assignmentPresets || {}).length;
        const includeAssignments = options.includeAssignmentPresets === true;
        const pack = includeAssignments ? completePack : stripAssignments(completePack);
        return {
            ok: true,
            pack,
            catalog: catalogFromPack(includeAssignments ? completePack : stripAssignments(completePack)),
            assignmentPresetsAvailable: assignmentCount,
            assignmentPresetsIncluded: includeAssignments && assignmentCount > 0,
            assignmentPresetsRequireOptIn: !includeAssignments && assignmentCount > 0,
        };
    } catch (error) {
        const normalized = error instanceof StylePackError || error instanceof ImportCodecError
            ? error
            : new StylePackError('invalid_pack', 'The style pack could not be analyzed.');
        return {
            ok: false,
            error: normalized.code,
            message: normalized.message,
            ...(normalized.details === undefined ? {} : { details: normalized.details }),
        };
    }
}

export async function analyzeStylePackSource(source, options = {}) {
    const decoded = await analyzeJsonSource(source, options);
    if (!decoded.ok) return decoded;
    const analyzed = analyzeStylePack(decoded.value, options);
    if (!analyzed.ok) return analyzed;
    return {
        ...analyzed,
        source: {
            byteLength: decoded.byteLength,
            nodeCount: decoded.nodeCount,
            maxDepth: decoded.maxDepth,
        },
    };
}

export async function parseStylePackSource(source, options = {}) {
    const analyzed = await analyzeStylePackSource(source, options);
    if (!analyzed.ok) throw new StylePackError(analyzed.error, analyzed.message, analyzed.details);
    return analyzed.pack;
}

export function canonicalizeStylePackValue(input, options = {}) {
    return canonicalizeJsonValue(normalizeStylePack(input, options));
}

export function canonicalizeStylePack(input, options = {}) {
    return canonicalizeJson(normalizeStylePack(input, options));
}

export async function digestStylePack(input, options = {}) {
    return digestCanonicalJson(normalizeStylePack(input, options));
}

function installedNames(installed, category) {
    const aliases = {
        palettes: 'customPalettes',
        gradientPresets: 'customGradientPresets',
        assignmentPresets: 'presets',
    };
    const raw = installed?.[category] ?? installed?.[aliases[category]];
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) {
        return raw.map((entry, index) => normalizeDictionaryName(
            typeof entry === 'string' ? entry : entry?.name,
            `installed.${category}[${index}]`,
        ));
    }
    const hardened = hardenJsonValue(raw);
    assertRecord(hardened, `installed.${category}`);
    return Object.keys(hardened).map(name => normalizeDictionaryName(name, `installed.${category}`));
}

function normalizeIncomingForPlanning(input, options) {
    return normalizeStylePack(input, { includeAssignmentPresets: options.includeAssignmentPresets === true });
}

export function analyzeStylePackConflicts(input, installed = {}, options = {}) {
    const pack = normalizeIncomingForPlanning(input, options);
    const safeInstalled = hardenJsonValue(installed);
    assertRecord(safeInstalled, 'installed catalog');
    const result = dictionary();
    result.categories = dictionary();
    result.totalConflicts = 0;
    result.totalAdditions = 0;
    for (const category of INSTALLABLE_CATEGORIES) {
        const incoming = Object.keys(pack[category] || {}).sort(compareText);
        const existing = installedNames(safeInstalled, category).sort(compareText);
        const occupied = new Map(existing.map(name => [normalizedLookupName(name), name]));
        const conflicts = [];
        const additions = [];
        for (const name of incoming) {
            const existingName = occupied.get(normalizedLookupName(name));
            if (existingName === undefined) additions.push(name);
            else {
                const conflict = dictionary();
                conflict.name = name;
                conflict.existingName = existingName;
                conflicts.push(conflict);
            }
        }
        const categoryResult = dictionary();
        categoryResult.incoming = incoming;
        categoryResult.existing = existing;
        categoryResult.additions = additions;
        categoryResult.conflicts = conflicts;
        result.categories[category] = categoryResult;
        result.totalConflicts += conflicts.length;
        result.totalAdditions += additions.length;
    }
    return result;
}

function getDecision(options, category, name, conflict) {
    const decisions = options.decisions ?? options.resolutions;
    const categoryDecisions = decisions?.[category];
    const specified = categoryDecisions?.[name];
    const fallback = options.conflictStrategy ?? options.strategy ?? 'keep';
    const decision = specified ?? fallback;
    if (typeof decision === 'string') return { action: decision, targetName: '' };
    if (isRecord(decision)) return {
        action: decision.action ?? decision.strategy ?? fallback,
        targetName: decision.targetName ?? decision.name ?? '',
    };
    fail('invalid_decision', `Invalid installation decision for ${category}.${name}.`);
}

function nextAvailableName(name, occupied) {
    for (let suffix = 2; suffix <= 10000; suffix++) {
        const candidate = `${name} (${suffix})`;
        if (!occupied.has(normalizedLookupName(candidate))) return candidate;
    }
    fail('rename_exhausted', `Could not generate an available name for "${name}".`);
}

/**
 * Return deterministic operations and payload dictionaries. The helper never
 * mutates either catalog and performs no persistence or UI work.
 */
export function buildStylePackInstallationPlan(input, installed = {}, options = {}) {
    const pack = normalizeIncomingForPlanning(input, options);
    const safeInstalled = hardenJsonValue(installed);
    assertRecord(safeInstalled, 'installed catalog');
    const decisions = options.decisions ?? options.resolutions;
    const safeDecisions = decisions === undefined ? undefined : hardenJsonValue(decisions);
    const planningOptions = safeDecisions === undefined
        ? options
        : { ...options, decisions: safeDecisions, resolutions: undefined };
    const plan = dictionary();
    plan.operations = [];
    plan.install = dictionary();
    plan.summary = dictionary();
    for (const action of ['install', 'keep', 'rename', 'replace']) plan.summary[action] = 0;

    const selections = isRecord(options.selected) ? options.selected : dictionary();
    for (const category of INSTALLABLE_CATEGORIES) {
        const incomingDictionary = pack[category] || dictionary();
        const incomingNames = selectionNames(selections[category], Object.keys(incomingDictionary), `selected.${category}`);
        const existing = installedNames(safeInstalled, category);
        const occupied = new Map(existing.map(name => [normalizedLookupName(name), name]));
        plan.install[category] = dictionary();

        for (const name of incomingNames) {
            const lookup = normalizedLookupName(name);
            const existingName = occupied.get(lookup);
            const operation = dictionary();
            operation.category = category;
            operation.sourceName = name;
            if (existingName === undefined) {
                operation.action = 'install';
                operation.targetName = name;
                plan.install[category][name] = incomingDictionary[name];
                occupied.set(lookup, name);
                plan.summary.install++;
                plan.operations.push(operation);
                continue;
            }

            const decision = getDecision(planningOptions, category, name, true);
            if (!['keep', 'rename', 'replace'].includes(decision.action)) {
                fail('invalid_decision', `Conflict action for ${category}.${name} must be keep, rename, or replace.`);
            }
            operation.action = decision.action;
            operation.existingName = existingName;
            if (decision.action === 'keep') {
                operation.targetName = existingName;
            } else if (decision.action === 'replace') {
                operation.targetName = existingName;
                plan.install[category][existingName] = incomingDictionary[name];
            } else {
                const requestedName = decision.targetName
                    ? normalizeDictionaryName(decision.targetName, `rename target for ${category}.${name}`)
                    : nextAvailableName(name, occupied);
                const targetLookup = normalizedLookupName(requestedName);
                if (occupied.has(targetLookup)) {
                    fail('rename_conflict', `Rename target "${requestedName}" already exists in ${category}.`);
                }
                operation.targetName = requestedName;
                plan.install[category][requestedName] = incomingDictionary[name];
                occupied.set(targetLookup, requestedName);
            }
            plan.summary[decision.action]++;
            plan.operations.push(operation);
        }
    }

    if (options.includeAppearance !== false && Object.keys(pack.appearance || {}).length) {
        plan.install.appearance = pack.appearance;
        const operation = dictionary();
        operation.category = 'appearance';
        operation.action = 'replace';
        operation.targetName = 'appearance';
        plan.operations.push(operation);
        plan.summary.replace++;
    }
    plan.conflicts = analyzeStylePackConflicts(pack, safeInstalled, {
        includeAssignmentPresets: options.includeAssignmentPresets === true,
    });
    return plan;
}

export const createStylePackInstallationPlan = buildStylePackInstallationPlan;
