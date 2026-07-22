import { CHARACTER_STYLE_FIELD_MASKS, applyCharacterStyle, captureCharacterStyle, normalizeCharacterStyle } from './character-style.js';

export const GROUP_PROFILE_AUTOMATION_KEYS = Object.freeze([
    'applyStyleOnAssign',
    'applyStyleOnCreate',
    'autoLock',
    'randomGradient',
]);

export const DEFAULT_GROUP_PROFILE_STYLE_FIELDS = CHARACTER_STYLE_FIELD_MASKS.GRADIENT
    | CHARACTER_STYLE_FIELD_MASKS.FONT
    | CHARACTER_STYLE_FIELD_MASKS.STYLE;

export function normalizeGroupName(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

export function normalizeGroupKey(value) {
    return normalizeGroupName(value).toLowerCase();
}

function normalizeTriState(value) {
    return typeof value === 'boolean' ? value : null;
}

export function normalizeGroupProfile(value, fallbackName = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const name = normalizeGroupName(value.name || fallbackName);
    if (!name) return null;
    const style = normalizeCharacterStyle(value.style)
        || captureCharacterStyle({}, DEFAULT_GROUP_PROFILE_STYLE_FIELDS);
    const automation = {};
    for (const key of GROUP_PROFILE_AUTOMATION_KEYS) {
        automation[key] = normalizeTriState(value.automation?.[key]);
    }
    return { name, style, automation };
}

export function normalizeGroupProfiles(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const profiles = {};
    for (const [rawKey, rawProfile] of Object.entries(value)) {
        const profile = normalizeGroupProfile(rawProfile, rawKey);
        if (!profile) continue;
        const key = normalizeGroupKey(profile.name);
        if (!profiles[key]) profiles[key] = profile;
    }
    return profiles;
}

export function getGroupProfile(profiles, group) {
    const profile = normalizeGroupProfiles(profiles)[normalizeGroupKey(group)];
    return profile ? structuredCloneProfile(profile) : null;
}

export function setGroupProfile(profiles, group, value) {
    const next = normalizeGroupProfiles(profiles);
    const profile = normalizeGroupProfile(value, group);
    if (!profile) return next;
    next[normalizeGroupKey(profile.name)] = profile;
    return next;
}

export function renameGroupProfile(profiles, currentName, nextName) {
    const next = normalizeGroupProfiles(profiles);
    const currentKey = normalizeGroupKey(currentName);
    const nextKey = normalizeGroupKey(nextName);
    const normalizedName = normalizeGroupName(nextName);
    if (!currentKey || !nextKey || !normalizedName || !next[currentKey]) return null;
    if (currentKey !== nextKey && next[nextKey]) return null;
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
    return JSON.parse(JSON.stringify(profile));
}
