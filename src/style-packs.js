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
import { isDangerousRegistryIdentity, isReservedCharacterIdentity, normalizeGroupName, normalizeRegistryIdentity, resolveCanonicalAliasOwners } from './group-profiles.js';

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
const BUILT_IN_COLOR_THEMES = new Set([
    'pastel', 'neon', 'earth', 'jewel', 'muted', 'jade', 'forest', 'ocean', 'sunset',
    'aurora', 'warm', 'cool', 'berry', 'monochrome', 'protanopia', 'deuteranopia', 'tritanopia',
]);
const INSTALLABLE_CATEGORIES = Object.freeze(['palettes', 'gradientPresets', 'assignmentPresets']);
const INSTALLED_NAME_LIMITS = Object.freeze({ palettes: 120, gradientPresets: 80, assignmentPresets: 120 });

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

function normalizedLookupName(value, maximum = STYLE_PACK_LIMITS.maxCharacterNameLength) {
    return normalizeRegistryIdentity(value, maximum);
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

function normalizeDictionaryName(value, field, maximum = STYLE_PACK_LIMITS.maxNameLength) {
    const name = normalizeString(value, field, maximum, { required: true });
    if (isDangerousRegistryIdentity(name)) fail('reserved_key', `Reserved name "${name}" is not allowed.`, { field, name });
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
        const lookup = normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength);
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
        const lookup = normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength);
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
    const aliases = [];
    const seen = new Set();
    value.forEach((alias, index) => {
        const aliasField = `${field}[${index}]`;
        const normalized = normalizeString(
            alias,
            aliasField,
            STYLE_PACK_LIMITS.maxCharacterNameLength,
            { required: true },
        );
        if (isDangerousRegistryIdentity(normalized) || isReservedCharacterIdentity(normalized)) {
            fail('reserved_key', `Reserved assignment identity "${normalized}" is not allowed.`, { field: aliasField, name: normalized });
        }
        const lookup = normalizedLookupName(normalized);
        if (!lookup) fail('invalid_string', `${aliasField} is not a valid assignment identity.`, { field: aliasField });
        if (seen.has(lookup)) return;
        seen.add(lookup);
        aliases.push(normalized);
    });
    return aliases.sort(compareText);
}

function normalizeAssignment(value, field, totals) {
    assertRecord(value, field);
    const assignment = dictionary();
    assignment.name = normalizeString(value.name, `${field}.name`, STYLE_PACK_LIMITS.maxCharacterNameLength, { required: true });
    if (isDangerousRegistryIdentity(assignment.name) || isReservedCharacterIdentity(assignment.name)) {
        fail('reserved_key', `Reserved assignment identity "${assignment.name}" is not allowed.`, {
            field: `${field}.name`,
            name: assignment.name,
        });
    }
    assignment.color = normalizeHex(value.color, `${field}.color`);
    assignment.baseColor = value.baseColor === undefined
        ? assignment.color
        : normalizeHex(value.baseColor, `${field}.baseColor`);
    assignment.style = VALID_STYLES.has(value.style) ? value.style : '';
    assignment.font = normalizeFont(value.font, `${field}.font`);
    assignment.aliases = normalizeAliases(value.aliases, `${field}.aliases`, totals);
    const group = normalizeString(value.group, `${field}.group`, STYLE_PACK_LIMITS.maxNameLength);
    if (group && isDangerousRegistryIdentity(group)) {
        fail('reserved_key', `Reserved group identity "${group}" is not allowed.`, { field: `${field}.group`, name: group });
    }
    assignment.group = group ? normalizeGroupName(group) : '';
    if (group && !assignment.group) fail('invalid_string', `${field}.group is not a valid group identity.`, { field: `${field}.group` });
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

export function assertStylePackAssignmentIdentities(assignments, field = 'assignments') {
    if (!Array.isArray(assignments)) fail('invalid_assignment_preset', `${field} must be an array.`);
    assignments.forEach((assignment, assignmentIndex) => {
        assertRecord(assignment, `${field}[${assignmentIndex}]`);
        if (assignment.aliases !== undefined && !Array.isArray(assignment.aliases)) {
            fail('invalid_aliases', `${field}[${assignmentIndex}].aliases must be an array.`);
        }
        const identityValues = [
            { value: assignment?.name, field: `${field}[${assignmentIndex}].name` },
            ...(Array.isArray(assignment?.aliases)
                ? assignment.aliases.map((alias, aliasIndex) => ({
                    value: alias,
                    field: `${field}[${assignmentIndex}].aliases[${aliasIndex}]`,
                }))
                : []),
        ];
        for (const identity of identityValues) {
            if (typeof identity.value !== 'string') {
                fail('invalid_string', `${identity.field} must be a string.`, { field: identity.field });
            }
            if (isDangerousRegistryIdentity(identity.value) || isReservedCharacterIdentity(identity.value)) {
                fail('reserved_key', `Reserved assignment identity "${identity.value}" is not allowed.`, {
                    field: identity.field,
                    name: identity.value,
                });
            }
            const lookup = normalizedLookupName(identity.value);
            if (!lookup) fail('missing_field', `${identity.field} is required.`, { field: identity.field });
        }
    });
    const ownership = resolveCanonicalAliasOwners(assignments);
    const conflict = ownership.conflicts[0];
    if (conflict) {
        const identity = conflict.identity || assignments[conflict.ownerIndex]?.name || '';
        fail('duplicate_assignment_identity', `Assignment identity "${identity}" is ambiguous.`, {
            identity,
            assignmentIndex: conflict.ownerIndex,
            existingAssignmentIndex: conflict.otherOwnerIndex,
        });
    }
    return true;
}

function appendAssignmentNameSuffix(name, field, occupied) {
    for (let index = 2; index <= 10000; index++) {
        const ending = ` (${index})`;
        const candidate = `${name.slice(0, STYLE_PACK_LIMITS.maxCharacterNameLength - ending.length).trimEnd()}${ending}`;
        const lookup = normalizedLookupName(candidate);
        if (lookup && !occupied.has(lookup)) return candidate;
    }
    fail('rename_exhausted', `Could not disambiguate assignment name "${name}".`, { field });
}

/**
 * Version 1 packs predate globally unique assignment identities. Keep parsing
 * them safely: primary names are retained (with a suffix when necessary),
 * primary names beat aliases. Ambiguous aliases are rejected instead of being
 * assigned according to source order.
 */
function resolveV1AssignmentIdentities(assignments, field) {
    const resolved = assignments.map(assignment => {
        const copy = Object.assign(dictionary(), assignment);
        copy.aliases = [...assignment.aliases];
        return copy;
    });
    const primaryIdentities = new Set();
    resolved.forEach((assignment, assignmentIndex) => {
        const lookup = normalizedLookupName(assignment.name);
        if (!primaryIdentities.has(lookup)) {
            primaryIdentities.add(lookup);
            return;
        }
        assignment.name = appendAssignmentNameSuffix(
            assignment.name,
            `${field}[${assignmentIndex}].name`,
            primaryIdentities,
        );
        primaryIdentities.add(normalizedLookupName(assignment.name));
    });

    const ownership = resolveCanonicalAliasOwners(resolved);
    const conflict = ownership.conflicts[0];
    if (conflict) {
        fail('duplicate_assignment_identity', `Assignment identity "${conflict.identity}" is ambiguous.`, {
            field,
            assignmentIndex: conflict.ownerIndex,
            existingAssignmentIndex: conflict.otherOwnerIndex,
        });
    }
    resolved.forEach((assignment, index) => { assignment.aliases = ownership.aliases[index]; });
    return resolved;
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
        const lookup = normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength);
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
        const assignments = resolveV1AssignmentIdentities(
            rawAssignments.map((assignment, index) => normalizeAssignment(
                assignment,
                `assignmentPresets.${name}[${index}]`,
                totals,
            )),
            `assignmentPresets.${name}`,
        );
        assertStylePackAssignmentIdentities(assignments, `assignmentPresets.${name}`);
        presets[name] = assignments
            .sort((left, right) => compareText(normalizedLookupName(left.name), normalizedLookupName(right.name)));
    }
    return presets;
}

function createAssignmentOverrideDiagnostic(kind, identity, previous, current, resolution) {
    const diagnostic = dictionary();
    diagnostic.kind = kind;
    diagnostic.resolution = resolution;
    diagnostic.identities = [identity];
    diagnostic.previousPreset = previous.presetName;
    diagnostic.previousAssignment = previous.assignment.name;
    diagnostic.previousAssignmentIndex = previous.assignmentIndex;
    diagnostic.overridingPreset = current.presetName;
    diagnostic.overridingAssignment = current.assignment.name;
    diagnostic.overridingAssignmentIndex = current.assignmentIndex;
    return diagnostic;
}

function removeActiveAssignment(item, active, primaryOwners, aliasOwners) {
    active.delete(item.token);
    if (primaryOwners.get(item.primary) === item) primaryOwners.delete(item.primary);
    for (const alias of item.aliases) {
        if (aliasOwners.get(alias) === item) aliasOwners.delete(alias);
    }
}

function removeAssignmentAlias(item, identity, aliasOwners) {
    item.aliases.delete(identity);
    item.assignment.aliases = item.assignment.aliases.filter(alias => normalizedLookupName(alias) !== identity);
    if (aliasOwners.get(identity) === item) aliasOwners.delete(identity);
}

/** Flatten presets with later canonical assignments winning and ambiguous aliases dropped. */
export function flattenStylePackAssignmentPresets(presets, selectedPresetNames = undefined) {
    assertRecord(presets, 'assignmentPresets');
    const presetNames = selectionNames(selectedPresetNames, Object.keys(presets), 'assignmentPresets');
    const active = new Map();
    const primaryOwners = new Map();
    const aliasOwners = new Map();
    const ambiguousAliases = new Set();
    const overrides = [];
    let token = 0;

    for (const presetName of presetNames) {
        const assignments = presets[presetName];
        assertStylePackAssignmentIdentities(assignments, `assignmentPresets.${presetName}`);
        assignments.forEach((assignment, assignmentIndex) => {
            const assignmentCopy = Object.assign(dictionary(), assignment);
            assignmentCopy.aliases = [];
            const current = {
                token: token++,
                presetName,
                assignment: assignmentCopy,
                assignmentIndex,
                primary: normalizedLookupName(assignment.name),
                aliases: new Set(),
            };
            const previousPrimary = primaryOwners.get(current.primary);
            if (previousPrimary) {
                overrides.push(createAssignmentOverrideDiagnostic(
                    'primary-replacement',
                    current.primary,
                    previousPrimary,
                    current,
                    'replace-assignment',
                ));
                removeActiveAssignment(previousPrimary, active, primaryOwners, aliasOwners);
            }
            const previousAlias = aliasOwners.get(current.primary);
            if (previousAlias) {
                overrides.push(createAssignmentOverrideDiagnostic(
                    'primary-over-alias',
                    current.primary,
                    previousAlias,
                    current,
                    'remove-previous-alias',
                ));
                removeAssignmentAlias(previousAlias, current.primary, aliasOwners);
            }

            active.set(current.token, current);
            primaryOwners.set(current.primary, current);
            for (const alias of assignment.aliases || []) {
                const identity = normalizedLookupName(alias);
                if (identity === current.primary || current.aliases.has(identity) || ambiguousAliases.has(identity)) continue;
                const primaryOwner = primaryOwners.get(identity);
                if (primaryOwner) {
                    overrides.push(createAssignmentOverrideDiagnostic(
                        'alias-versus-primary',
                        identity,
                        primaryOwner,
                        current,
                        'drop-overriding-alias',
                    ));
                    continue;
                }
                const previousOwner = aliasOwners.get(identity);
                if (previousOwner) {
                    overrides.push(createAssignmentOverrideDiagnostic(
                        'alias-ambiguity',
                        identity,
                        previousOwner,
                        current,
                        'drop-ambiguous-alias',
                    ));
                    removeAssignmentAlias(previousOwner, identity, aliasOwners);
                    ambiguousAliases.add(identity);
                    continue;
                }
                current.assignment.aliases.push(alias);
                current.aliases.add(identity);
                aliasOwners.set(identity, current);
            }
        });
    }

    const primaryOverrides = overrides.filter(diagnostic => diagnostic.kind === 'primary-replacement');
    const aliasResolutions = overrides.filter(diagnostic => diagnostic.kind !== 'primary-replacement');
    return {
        presetNames,
        assignments: [...active.values()].map(item => item.assignment),
        overrides: primaryOverrides,
        aliasResolutions,
        diagnostics: overrides,
    };
}

function normalizeAppearance(value) {
    assertRecord(value, 'appearance');
    const appearance = dictionary();
    if (value.themeMode !== undefined) {
        if (!['auto', 'dark', 'light'].includes(value.themeMode)) fail('invalid_appearance', 'appearance.themeMode is invalid.');
        appearance.themeMode = value.themeMode;
    }
    if (value.colorTheme !== undefined) {
        const theme = normalizeString(value.colorTheme, 'appearance.colorTheme', STYLE_PACK_LIMITS.maxNameLength + 7, { required: true });
        if (theme.slice(0, 7).toLowerCase() === 'custom:') {
            appearance.colorTheme = `custom:${normalizeDictionaryName(theme.slice(7), 'appearance.colorTheme')}`;
        } else {
            const builtIn = theme.toLowerCase();
            if (!BUILT_IN_COLOR_THEMES.has(builtIn)) {
                fail('unresolved_appearance_reference', `appearance.colorTheme references unknown palette "${theme}".`);
            }
            appearance.colorTheme = builtIn;
        }
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
    if (pack.appearance?.colorTheme?.startsWith('custom:')) {
        const requested = pack.appearance.colorTheme.slice(7);
        const actual = Object.keys(pack.palettes || {}).find(name => normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength)
            === normalizedLookupName(requested, STYLE_PACK_LIMITS.maxNameLength));
        if (!actual) {
            fail('unresolved_appearance_reference', `appearance.colorTheme references palette "${requested}" that is not included in the pack.`);
        }
        pack.appearance.colorTheme = `custom:${actual}`;
    }
    if (!STYLE_PACK_CATEGORIES.some(category => hasOwn(pack, category))) {
        fail('empty_pack', 'The style pack contains no selected style data.');
    }
    return pack;
}

function selectionNames(selection, available, field) {
    if (selection === undefined || selection === null) return available.slice().sort(compareText);
    const values = selection instanceof Set ? [...selection] : selection;
    if (!Array.isArray(values)) fail('invalid_selection', `${field} selection must be an array or Set.`);
    const requested = [];
    const requestedLookups = new Set();
    values.forEach((value, index) => {
        const name = normalizeDictionaryName(value, `${field}[${index}]`);
        const lookup = normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength);
        if (requestedLookups.has(lookup)) return;
        requestedLookups.add(lookup);
        requested.push(name);
    });
    const byLookup = new Map(available.map(name => [normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength), name]));
    return requested.map(name => {
        const actual = byLookup.get(normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength));
        if (!actual) fail('missing_selection', `${field} selection "${name}" does not exist.`);
        return actual;
    });
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
    const maximum = INSTALLED_NAME_LIMITS[category] || STYLE_PACK_LIMITS.maxNameLength;
    const raw = installed?.[category] ?? installed?.[aliases[category]];
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) {
        return raw.map((entry, index) => normalizeDictionaryName(
            typeof entry === 'string' ? entry : entry?.name,
            `installed.${category}[${index}]`,
            maximum,
        ));
    }
    const hardened = hardenJsonValue(raw);
    assertRecord(hardened, `installed.${category}`);
    return Object.keys(hardened).map(name => normalizeDictionaryName(name, `installed.${category}`, maximum));
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
    result.totalOverrides = 0;
    result.totalAliasResolutions = 0;
    for (const category of INSTALLABLE_CATEGORIES) {
        const incoming = Object.keys(pack[category] || {}).sort(compareText);
        const existing = installedNames(safeInstalled, category).sort(compareText);
        const occupied = new Map(existing.map(name => [normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength), name]));
        const conflicts = [];
        const additions = [];
        for (const name of incoming) {
            const existingName = occupied.get(normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength));
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
        if (category === 'assignmentPresets') {
            const flattened = flattenStylePackAssignmentPresets(
                pack.assignmentPresets || dictionary(),
                options.selected?.assignmentPresets,
            );
            categoryResult.overrides = flattened.overrides;
            categoryResult.aliasResolutions = flattened.aliasResolutions;
            categoryResult.identityResolutions = flattened.diagnostics;
            categoryResult.presetOrder = flattened.presetNames;
            result.totalOverrides = flattened.overrides.length;
            result.totalAliasResolutions = flattened.aliasResolutions.length;
        }
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
        const ending = ` (${suffix})`;
        const candidate = `${name.slice(0, STYLE_PACK_LIMITS.maxNameLength - ending.length).trimEnd()}${ending}`;
        if (!occupied.has(normalizedLookupName(candidate, STYLE_PACK_LIMITS.maxNameLength))) return candidate;
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
        const occupied = new Map(existing.map(name => [normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength), name]));
        plan.install[category] = dictionary();

        for (const name of incomingNames) {
            const lookup = normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength);
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
                const targetLookup = normalizedLookupName(requestedName, STYLE_PACK_LIMITS.maxNameLength);
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
        const appearance = hardenJsonValue(pack.appearance);
        if (appearance.colorTheme?.startsWith('custom:')) {
            const sourceName = appearance.colorTheme.slice(7);
            const sourceIdentity = normalizedLookupName(sourceName, STYLE_PACK_LIMITS.maxNameLength);
            const operation = plan.operations.find(item => item.category === 'palettes'
                && normalizedLookupName(item.sourceName, STYLE_PACK_LIMITS.maxNameLength) === sourceIdentity);
            const existing = installedNames(safeInstalled, 'palettes')
                .find(name => normalizedLookupName(name, STYLE_PACK_LIMITS.maxNameLength) === sourceIdentity);
            const targetName = operation?.targetName || existing;
            if (!targetName) {
                fail('unresolved_appearance_reference', `appearance.colorTheme palette "${sourceName}" is not selected or installed.`);
            }
            appearance.colorTheme = `custom:${targetName}`;
        }
        plan.install.appearance = appearance;
        const operation = dictionary();
        operation.category = 'appearance';
        operation.action = 'replace';
        operation.targetName = 'appearance';
        plan.operations.push(operation);
        plan.summary.replace++;
    }
    plan.conflicts = analyzeStylePackConflicts(pack, safeInstalled, {
        includeAssignmentPresets: options.includeAssignmentPresets === true,
        selected: selections,
    });
    return plan;
}

export const createStylePackInstallationPlan = buildStylePackInstallationPlan;
