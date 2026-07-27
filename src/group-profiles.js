import { CHARACTER_STYLE_FIELD_MASKS, applyCharacterStyle, captureCharacterStyle, normalizeCharacterStyle } from './character-style.js';

const DANGEROUS_REGISTRY_IDENTITIES = new Set(['__proto__', 'prototype', 'constructor']);

export const MAX_REGISTRY_IDENTITY_LENGTH = 120;

function dictionary() {
    return Object.create(null);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

export const GROUP_PROFILE_AUTOMATION_KEYS = Object.freeze([
    'applyStyleOnAssign',
    'applyStyleOnCreate',
    'autoLock',
    'randomGradient',
]);

export const DEFAULT_GROUP_PROFILE_STYLE_FIELDS = CHARACTER_STYLE_FIELD_MASKS.GRADIENT
    | CHARACTER_STYLE_FIELD_MASKS.FONT
    | CHARACTER_STYLE_FIELD_MASKS.STYLE;

function normalizeRegistryIdentityText(value, maximum = MAX_REGISTRY_IDENTITY_LENGTH) {
    if (typeof value !== 'string') return '';
    const limit = Number.isInteger(maximum) && maximum > 0
        ? Math.min(maximum, MAX_REGISTRY_IDENTITY_LENGTH)
        : MAX_REGISTRY_IDENTITY_LENGTH;
    const normalized = value
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized || normalized.length > limit || /[\u0000-\u001F\u007F]/.test(normalized)) return '';
    return normalized;
}

function normalizeLegacyRegistryIdentityText(value) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
    return String(value)
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function legacyRegistrySourceName(value, fallback = '') {
    return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : String(fallback);
}

function hashLegacyRegistryIdentity(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function fitLegacyRegistryIdentity(value, maximum) {
    if (value.length <= maximum) return value;
    const suffix = `~${hashLegacyRegistryIdentity(value)}`;
    return `${value.slice(0, Math.max(1, maximum - suffix.length)).trimEnd()}${suffix}`;
}

function appendLegacyRegistrySuffix(value, index, maximum) {
    const suffix = ` (${index})`;
    return `${value.slice(0, Math.max(1, maximum - suffix.length)).trimEnd()}${suffix}`;
}

export function isDangerousRegistryIdentity(value) {
    const normalized = normalizeRegistryIdentityText(value);
    return !!normalized && DANGEROUS_REGISTRY_IDENTITIES.has(normalized.toLowerCase());
}

export function normalizeRegistryIdentityName(value, maximum = MAX_REGISTRY_IDENTITY_LENGTH) {
    const normalized = normalizeRegistryIdentityText(value, maximum);
    const canonical = normalized.toLowerCase();
    const limit = Number.isInteger(maximum) && maximum > 0
        ? Math.min(maximum, MAX_REGISTRY_IDENTITY_LENGTH)
        : MAX_REGISTRY_IDENTITY_LENGTH;
    return normalized && canonical.length <= limit && !DANGEROUS_REGISTRY_IDENTITIES.has(canonical) ? normalized : '';
}

export function normalizeRegistryIdentity(value, maximum = MAX_REGISTRY_IDENTITY_LENGTH) {
    return normalizeRegistryIdentityName(value, maximum).toLowerCase();
}

/** Convert an already-persisted legacy identity into the current bounded schema. */
export function migrateLegacyRegistryIdentityName(value, maximum = MAX_REGISTRY_IDENTITY_LENGTH, fallback = 'Legacy item') {
    const limit = Number.isInteger(maximum) && maximum > 0
        ? Math.min(maximum, MAX_REGISTRY_IDENTITY_LENGTH)
        : MAX_REGISTRY_IDENTITY_LENGTH;
    const original = normalizeLegacyRegistryIdentityText(value);
    let normalized = original || normalizeLegacyRegistryIdentityText(fallback) || 'Legacy item';
    if (DANGEROUS_REGISTRY_IDENTITIES.has(normalized.toLowerCase())) normalized = `${normalized} (legacy)`;
    normalized = fitLegacyRegistryIdentity(normalized, limit);
    if (normalizeRegistryIdentityName(normalized, limit)) return normalized;
    return fitLegacyRegistryIdentity(`Legacy item ${hashLegacyRegistryIdentity(original || String(value))}`, limit);
}

/**
 * Migrate a legacy name-keyed catalog without dropping NFKC or truncation
 * collisions. Returned dictionaries are null-prototyped and include rename
 * diagnostics suitable for a schema migration report.
 */
export function migrateLegacyRegistryEntries(source, options = {}) {
    const registry = dictionary();
    const mappings = dictionary();
    const renames = [];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return { registry, mappings, renames };
    const maximum = Number.isInteger(options.maximum) && options.maximum > 0
        ? Math.min(options.maximum, MAX_REGISTRY_IDENTITY_LENGTH)
        : MAX_REGISTRY_IDENTITY_LENGTH;
    const fallback = typeof options.fallback === 'string' && options.fallback.trim()
        ? options.fallback
        : 'Legacy item';
    const nameFromValue = options.nameFromValue === true;
    const occupied = new Set();
    const collisionIndices = new Map();
    let entryIndex = 0;

    for (const [rawKey, value] of Object.entries(source)) {
        entryIndex++;
        const explicitName = nameFromValue && value && typeof value === 'object'
            && !Array.isArray(value) && hasOwn(value, 'name')
            ? value.name
            : undefined;
        const rawName = normalizeLegacyRegistryIdentityText(explicitName) ? explicitName : rawKey;
        const sourceName = legacyRegistrySourceName(rawName, rawKey);
        const baseName = migrateLegacyRegistryIdentityName(rawName, maximum, `${fallback} ${entryIndex}`);
        let name = baseName;
        let identity = normalizeRegistryIdentity(name, maximum);
        const baseIdentity = identity;
        let collisionIndex = collisionIndices.get(baseIdentity) || 2;
        while (!identity || occupied.has(identity)) {
            name = appendLegacyRegistrySuffix(baseName, collisionIndex++, maximum);
            identity = normalizeRegistryIdentity(name, maximum);
        }
        collisionIndices.set(baseIdentity, collisionIndex);
        occupied.add(identity);
        mappings[rawKey] = name;
        const nextValue = nameFromValue && value && typeof value === 'object' && !Array.isArray(value)
            ? { ...value, name }
            : value;
        registry[name] = nextValue;
        if (name !== sourceName) {
            renames.push({
                from: sourceName || String(rawKey),
                to: name,
                collision: name !== baseName,
            });
        }
    }
    return { registry, mappings, renames };
}

/** Migrate and canonical-deduplicate a legacy alias list without truncation loss. */
export function migrateLegacyRegistryIdentities(values, options = {}) {
    const migrated = [];
    const renames = [];
    if (!Array.isArray(values)) return { values: migrated, renames };
    const maximum = Number.isInteger(options.maximum) && options.maximum > 0
        ? Math.min(options.maximum, MAX_REGISTRY_IDENTITY_LENGTH)
        : MAX_REGISTRY_IDENTITY_LENGTH;
    const fallback = typeof options.fallback === 'string' && options.fallback.trim()
        ? options.fallback
        : 'Legacy alias';
    const sourceIdentities = new Set();
    const occupied = new Set();
    const collisionIndices = new Map();

    values.forEach((value, index) => {
        const originalName = normalizeLegacyRegistryIdentityText(value);
        const sourceName = legacyRegistrySourceName(value);
        const sourceIdentity = originalName.toLowerCase();
        if (sourceIdentity && sourceIdentities.has(sourceIdentity)) return;
        if (sourceIdentity) sourceIdentities.add(sourceIdentity);
        const baseName = migrateLegacyRegistryIdentityName(value, maximum, `${fallback} ${index + 1}`);
        let name = baseName;
        let identity = normalizeRegistryIdentity(name, maximum);
        const baseIdentity = identity;
        let collisionIndex = collisionIndices.get(baseIdentity) || 2;
        while (!identity || occupied.has(identity)) {
            name = appendLegacyRegistrySuffix(baseName, collisionIndex++, maximum);
            identity = normalizeRegistryIdentity(name, maximum);
        }
        collisionIndices.set(baseIdentity, collisionIndex);
        occupied.add(identity);
        migrated.push(name);
        if (name !== sourceName) {
            renames.push({
                from: sourceName,
                to: name,
                collision: name !== baseName,
            });
        }
    });
    return { values: migrated, renames };
}

export function normalizeGroupName(value) {
    return normalizeRegistryIdentityName(value, 80);
}

export function normalizeGroupKey(value) {
    return normalizeRegistryIdentity(value, 80);
}

function normalizeTriState(value) {
    return typeof value === 'boolean' ? value : null;
}

export function normalizeGroupProfile(value, fallbackName = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const name = normalizeGroupName(hasOwn(value, 'name') ? value.name : fallbackName);
    if (!name) return null;
    const style = hasOwn(value, 'style')
        ? normalizeCharacterStyle(value.style)
        : captureCharacterStyle({}, DEFAULT_GROUP_PROFILE_STYLE_FIELDS);
    if (!style) return null;
    const automation = dictionary();
    for (const key of GROUP_PROFILE_AUTOMATION_KEYS) {
        automation[key] = normalizeTriState(value.automation?.[key]);
    }
    return { name, style, automation };
}

export function normalizeGroupProfiles(value) {
    const profiles = dictionary();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return profiles;
    for (const [rawKey, rawProfile] of Object.entries(value)) {
        const profile = normalizeGroupProfile(rawProfile, rawKey);
        if (!profile) continue;
        const key = normalizeGroupKey(profile.name);
        if (key && !hasOwn(profiles, key)) profiles[key] = profile;
    }
    return profiles;
}

export function getGroupProfile(profiles, group) {
    const normalizedProfiles = normalizeGroupProfiles(profiles);
    const key = normalizeGroupKey(group);
    const profile = key && hasOwn(normalizedProfiles, key) ? normalizedProfiles[key] : null;
    return profile ? structuredCloneProfile(profile) : null;
}

export function setGroupProfile(profiles, group, value) {
    const next = normalizeGroupProfiles(profiles);
    const profile = normalizeGroupProfile(value, group);
    if (!profile) return next;
    const key = normalizeGroupKey(profile.name);
    if (key) next[key] = profile;
    return next;
}

export function renameGroupProfile(profiles, currentName, nextName) {
    const next = normalizeGroupProfiles(profiles);
    const currentKey = normalizeGroupKey(currentName);
    const nextKey = normalizeGroupKey(nextName);
    const normalizedName = normalizeGroupName(nextName);
    if (!currentKey || !nextKey || !normalizedName || !hasOwn(next, currentKey)) return null;
    if (currentKey !== nextKey && hasOwn(next, nextKey)) return null;
    const profile = { ...next[currentKey], name: normalizedName };
    delete next[currentKey];
    next[nextKey] = profile;
    return next;
}

export function deleteGroupProfile(profiles, group) {
    const next = normalizeGroupProfiles(profiles);
    delete next[normalizeGroupKey(group)];
    return next;
}

export function resolveGroupProfile(profiles, group) {
    return getGroupProfile(profiles, group);
}

export function resolveGroupAutomation(profile, key, options = {}) {
    if (!GROUP_PROFILE_AUTOMATION_KEYS.includes(key)) return options.defaultValue;
    if (options.hasExplicit === true) return options.explicit;
    const profileValue = profile?.automation?.[key];
    if (typeof profileValue === 'boolean') return profileValue;
    if (typeof options.globalValue === 'boolean') return options.globalValue;
    return options.defaultValue;
}

export function applyGroupProfile(entry, profile, fieldMask = CHARACTER_STYLE_FIELD_MASKS.ALL) {
    const normalized = normalizeGroupProfile(profile);
    return normalized ? applyCharacterStyle(entry, normalized.style, fieldMask) : [];
}

function structuredCloneProfile(profile) {
    return normalizeGroupProfile(JSON.parse(JSON.stringify(profile)));
}
