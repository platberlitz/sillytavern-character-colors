// storage.js - extracted from index.js (mechanical split)
import { clearSpeakerRegexCache } from './attribution.js';
import { GRADIENT_ANIMATION_MODES } from './animation-controller.js';
import { COLOR_VISION_MODES } from './color-vision.js';
import { createGradientPresetFromEntry, normalizeGradient, normalizeGradientPreset, normalizeGradientPresets, serializeGradient } from './gradients.js';
import { isDangerousRegistryIdentity, isReservedCharacterIdentity, migrateLegacyRegistryEntries, migrateLegacyRegistryIdentities, migrateLegacyRegistryIdentityName, normalizeGroupProfile, normalizeGroupProfiles, normalizeRegistryIdentity, normalizeRegistryIdentityName, resolveCanonicalAliasOwners } from './group-profiles.js';
import { createHistorySnapshot, parseHistorySnapshot, saveHistory, showUndoToast } from './history.js';
import { analyzeJsonSource, inspectJsonValue } from './import-codec.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit, flushColorStateSave } from './live-colors.js';
import { normalizeNarratorStyle, setNarratorStyle } from './narrator-style.js';
import { COLOR_THEMES, CUSTOM_PALETTE_KEY, CUSTOM_PALETTE_META_KEY, applyThemeReadabilityAndBrightness, buildCharacterEntry, deriveBaseColorFromEffectiveColor, getBaseColor, getCardCharacterNames, getPersonaName, getRepairedBaseLightnessWindow, invalidateThemeCache, normalizeCustomPalettes, syncAllEffectiveColors } from './palettes.js';
import { injectPrompt } from './prompts.js';
import { extension_settings, getCharacters, getContext, getRequestHeaders, saveMetadata, saveSettings, saveSettingsDebounced } from './st-api.js';
import { ACTIVE_SETTING_KEYS, AUTO_SYNC_SAVE_TIMEOUT_MS, COLOR_SCHEMA_VERSION, COLOR_STORAGE_SCOPES, DEFAULT_COLOR_STORAGE_SCOPE, GLOBAL_SETTINGS_V2_KEY, GLOBAL_VISUAL_KEYS, LEGACY_AUTO_SYNC_ENABLED_KEY, LEGACY_GLOBAL_SETTINGS_KEY, LEGEND_POSITION_KEY, MODULE_NAME, PORTABLE_SETTING_KEYS, PRESETS_KEY, TOGGLE_SETTING_DEFAULTS, autoSyncEnabled, autoSyncInterval, autoSyncLastTimestamp, autoSyncLastWriterId, autoSyncPendingRecord, autoSyncSaveTimeout, autoSyncSequence, autoSyncStatusError, characterColors, colorHistory, colorStateSaveTimer, createLatestRequestGate, expandedCharacterRows, getAutoSyncRecordDisposition, groupProfiles, historyIndex, lastCharKey, lastProcessedMessageSignature, pendingColorStateHistory, pendingColorStateInjectPrompt, pendingColorStateSaveData, pendingColorStateUpdateList, preserveLocalRemoteFontConsent, selectedCharacterKeys, setAutoSyncEnabled, setAutoSyncInterval, setAutoSyncLastTimestamp, setAutoSyncLastWriterId, setAutoSyncPendingRecord, setAutoSyncSaveTimeout, setAutoSyncSequence, setAutoSyncStatusError, setCharacterColors, setColorHistory, setExpandedCharacterRows, setGroupProfiles, setHistoryIndex, setLastCharKey, setLastProcessedMessageSignature, setSwapMode, settings, swapMode, synchronizeEnabledLifecycle } from './state.js';
import { AESTHETIC_APPEARANCE_KEYS, StylePackError, analyzeStylePackConflicts, buildStylePackInstallationPlan, flattenStylePackAssignmentPresets } from './style-packs.js';
import { analyzeStylePackEnvelopeSource, digestStylePackEnvelope, normalizeStylePackEnvelope } from './style-pack-adapter.js';
import { refreshGradientPresetControls, syncUIWithSettings, updateCharList } from './ui.js';
import { hexToHsl, hslToHex, normalizeBoolean, normalizeCharacterColors, normalizeCharacterEntry, normalizeEntryGradientGenerator, normalizeHexColor, toast } from './utils.js';
import { normalizeAttributionVerifyPasses } from './verify-consensus.js';

const ORDINARY_IMPORT_LIMITS = Object.freeze({
    maxBytes: 1024 * 1024,
    maxDepth: 20,
    maxNodes: 20000,
});

const ORDINARY_IMPORT_OUTPUT_LIMITS = Object.freeze({
    maxCharacters: 5000,
    maxAliasesPerCharacter: 128,
    maxAliasesTotal: 10000,
    maxGroupProfiles: 2000,
    maxGradientPresets: 512,
    maxCustomPalettes: 512,
});

const AUTO_SYNC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const AUTO_SYNC_WRITER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const LOCAL_REMOTE_FONT_CONSENT_KEY = 'dc_allow_remote_fonts_local_consent_v1';
const LOCAL_CONNECTION_PROFILES_KEY = 'dc_connection_profiles_local_v1';
export const LEGACY_LOCAL_STORAGE_MIGRATION_KEY = 'dc_legacy_local_storage_migrated_v1';
const CONNECTION_PROFILE_SETTING_KEYS = Object.freeze(['llmConnectionProfile', 'attributionConnectionProfile']);
let localRemoteFontConsent = null;
let volatileLocalConnectionProfiles = null;

function getLocalRemoteFontConsent() {
    if (typeof localRemoteFontConsent === 'boolean') return localRemoteFontConsent;
    try {
        localRemoteFontConsent = localStorage.getItem(LOCAL_REMOTE_FONT_CONSENT_KEY) === 'true';
    } catch {
        localRemoteFontConsent = false;
    }
    return localRemoteFontConsent;
}

function persistLocalRemoteFontConsent(value) {
    localRemoteFontConsent = value === true;
    try {
        localStorage.setItem(LOCAL_REMOTE_FONT_CONSENT_KEY, localRemoteFontConsent ? 'true' : 'false');
    } catch {
        // The runtime setting remains effective for this session when storage is unavailable.
    }
}

function normalizeConnectionProfileId(value) {
    return value === null ? null : normalizeSettingString(value, 256) || null;
}

function normalizeLocalConnectionProfiles(source) {
    return Object.fromEntries(CONNECTION_PROFILE_SETTING_KEYS.map(key => [
        key,
        normalizeConnectionProfileId(source?.[key]),
    ]));
}

function getLocalConnectionProfiles() {
    try {
        const raw = localStorage.getItem(LOCAL_CONNECTION_PROFILES_KEY);
        if (raw === null) return volatileLocalConnectionProfiles;
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? normalizeLocalConnectionProfiles(parsed) : volatileLocalConnectionProfiles;
    } catch {
        return volatileLocalConnectionProfiles;
    }
}

function persistLocalConnectionProfiles(source) {
    const normalized = normalizeLocalConnectionProfiles(source);
    try {
        localStorage.setItem(LOCAL_CONNECTION_PROFILES_KEY, JSON.stringify(normalized));
        volatileLocalConnectionProfiles = null;
    } catch {
        volatileLocalConnectionProfiles = normalized;
    }
}

function migrateLegacyLocalConnectionProfiles(source) {
    if (getLocalConnectionProfiles() || !isPlainObject(source)
        || !CONNECTION_PROFILE_SETTING_KEYS.some(key => hasOwn(source, key))) return;
    persistLocalConnectionProfiles(source);
}

function applyLocalConnectionProfiles() {
    const local = getLocalConnectionProfiles();
    if (!local) return;
    Object.assign(settings, local);
}

function createAutoSyncWriterId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return `dc:${globalThis.crypto.randomUUID()}`;
    return `dc:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export const AUTO_SYNC_WRITER_ID = createAutoSyncWriterId();

const FONT_TRIM_RULE = Object.freeze({
    id: 'dialogue-colors:trim-font-tags:v1',
    scriptName: '[Dialogue Colors] Trim Exact Font Tags',
    findRegex: '/<font(?:\\s+[^<>]*?)?\\s*\\/?>|<\\/font\\s*>/gi',
    replaceString: '',
    trimStrings: Object.freeze([]),
    placement: Object.freeze([2]),
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
});

const LEGACY_FONT_TRIM_RULE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const COLOR_BLOCK_TRIM_RULE = Object.freeze({
    id: 'dialogue-colors:trim-color-blocks:v1',
    scriptName: '[Dialogue Colors] Trim Color Blocks',
    findRegex: '/\\[COLORS?:[^\\]]*\\]/gi',
    replaceString: '',
    trimStrings: Object.freeze([]),
    placement: Object.freeze([2]),
    disabled: false,
    markdownOnly: true,
    promptOnly: true,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
});

const CSS_EFFECTS_TRIM_RULE = Object.freeze({
    id: 'dialogue-colors:trim-css-effects:v1',
    scriptName: '[Dialogue Colors] Trim CSS Effects (Prompt)',
    findRegex: '/<span[^>]*style=["\'][^"\']*(?:transform|skew|rotate|scale|opacity|filter|text-shadow|translate)[^"\']*["\'][^>]*>(.*?)<\\/span>/gi',
    replaceString: '$1',
    trimStrings: Object.freeze([]),
    placement: Object.freeze([2]),
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
});

export function normalizeToggleSettings() {
    normalizeCurrentColorStorageScope();
    pruneInactiveSettings();
    Object.assign(settings, normalizeStoredSettings(settings));
    for (const [key, fallback] of Object.entries(TOGGLE_SETTING_DEFAULTS)) {
        settings[key] = normalizeBoolean(settings[key], fallback);
    }
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
    settings.coloringEngine = settings.coloringEngine === 'dom' ? 'dom' : 'llm';
    const attributionReviewPolicy = String(settings.attributionReviewPolicy ?? '').trim().toLowerCase();
    settings.attributionReviewPolicy = ['review', 'auto-high', 'legacy-auto'].includes(attributionReviewPolicy)
        ? attributionReviewPolicy
        : 'review';
    settings.attributionVerifyPasses = normalizeAttributionVerifyPasses(settings.attributionVerifyPasses);
    // Matches the control's declared range, and repairs values an older build
    // stored before the input handler clamped them.
    const promptDepth = Number(settings.promptDepth);
    settings.promptDepth = Number.isFinite(promptDepth) ? Math.max(0, Math.min(99, Math.round(promptDepth))) : 1;
    settings.gradientRandomMasterSeed = String(settings.gradientRandomMasterSeed ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .slice(0, 128);
    settings.colorVisionPreviewMode = COLOR_VISION_MODES.includes(settings.colorVisionPreviewMode)
        ? settings.colorVisionPreviewMode
        : 'none';
    const previewSeverity = Number(settings.colorVisionPreviewSeverity);
    settings.colorVisionPreviewSeverity = Number.isFinite(previewSeverity)
        ? Math.max(0, Math.min(100, Math.round(previewSeverity)))
        : 100;
    settings.colorVisionPreviewTarget = ['ui', 'chat', 'all'].includes(settings.colorVisionPreviewTarget)
        ? settings.colorVisionPreviewTarget
        : 'all';
    settings.gradientAnimationMode = GRADIENT_ANIMATION_MODES.includes(settings.gradientAnimationMode)
        ? settings.gradientAnimationMode
        : 'auto';
}

export function normalizeColorStorageScope(value, legacyShareColorsGlobally = false) {
    return COLOR_STORAGE_SCOPES.includes(value)
        ? value
        : legacyShareColorsGlobally === true ? 'global' : DEFAULT_COLOR_STORAGE_SCOPE;
}

export function normalizeCurrentColorStorageScope() {
    const scope = normalizeColorStorageScope(settings.colorStorageScope, settings.shareColorsGlobally);
    settings.colorStorageScope = scope;
    delete settings.shareColorsGlobally;
    return scope;
}

export function getCurrentStorageScope() {
    return normalizeCurrentColorStorageScope();
}

export function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    } catch {
        return false;
    }
}

function parseSchemaVersion(value) {
    if (typeof value === 'string' && !value.trim()) return null;
    const version = Number(value);
    return Number.isFinite(version) ? version : null;
}

function getFutureSchemaVersion(source, { moduleRecord = false } = {}) {
    if (!isPlainObject(source)) return null;
    const versions = [source.version, source.settings?.colorSchemaVersion];
    if (moduleRecord) {
        versions.push(source.globalSettings?.colorSchemaVersion);
        for (const entry of Object.values(isPlainObject(source.colorData) ? source.colorData : {})) {
            versions.push(entry?.settings?.colorSchemaVersion);
        }
        for (const entry of Object.values(isPlainObject(source.ui?.storageTrash?.entries) ? source.ui.storageTrash.entries : {})) {
            versions.push(entry?.settings?.colorSchemaVersion);
        }
    }
    const future = versions.map(parseSchemaVersion).filter(version => version !== null && version > COLOR_SCHEMA_VERSION);
    return future.length ? Math.max(...future) : null;
}

function unsupportedSchemaVersionResult(source, options) {
    const version = getFutureSchemaVersion(source, options);
    return version === null ? null : {
        ok: false,
        error: 'unsupported_schema_version',
        version,
        supportedVersion: COLOR_SCHEMA_VERSION,
        message: `Schema version ${version} is newer than the supported version ${COLOR_SCHEMA_VERSION}.`,
    };
}

function assertSupportedSchemaVersion(source, options) {
    const unsupported = unsupportedSchemaVersionResult(source, options);
    if (!unsupported) return;
    const error = new Error(unsupported.message);
    Object.assign(error, unsupported);
    error.code = unsupported.error;
    throw error;
}

function normalizeNameDictionary(source, maximum = 120) {
    const normalized = Object.create(null);
    if (!isPlainObject(source)) return normalized;
    const limit = Number.isInteger(maximum) && maximum > 0 ? Math.min(maximum, 120) : 120;
    const occupied = new Set();
    for (const [rawName, value] of Object.entries(source)) {
        const baseName = normalizeRegistryIdentityName(rawName, limit);
        let name = baseName;
        let identity = normalizeRegistryIdentity(name, limit);
        if (!name || !identity) continue;
        let collisionIndex = 2;
        while (occupied.has(identity)) {
            const suffix = ` (${collisionIndex++})`;
            const stem = baseName.slice(0, Math.max(1, limit - suffix.length)).trimEnd();
            name = normalizeRegistryIdentityName(`${stem}${suffix}`, limit);
            identity = normalizeRegistryIdentity(name, limit);
        }
        occupied.add(identity);
        normalized[name] = value;
    }
    return normalized;
}

function normalizeGradientPresetRegistry(source) {
    return normalizeNameDictionary(normalizeGradientPresets(normalizeNameDictionary(source, 80)), 80);
}

function normalizeCustomPaletteRegistry(source) {
    return normalizeNameDictionary(normalizeCustomPalettes(normalizeNameDictionary(source)), 120);
}

const STORAGE_IDENTITY_MIGRATION_REPORT_LIMIT = 500;

function createStorageIdentityMigration() {
    return { renamed: 0, collisions: 0, changes: [] };
}

function recordStorageIdentityMigration(migration, path, renames) {
    for (const rename of renames || []) {
        migration.renamed++;
        if (rename.collision) migration.collisions++;
        if (migration.changes.length < STORAGE_IDENTITY_MIGRATION_REPORT_LIMIT) {
            migration.changes.push({ path, ...rename });
        }
    }
}

function recordStorageIdentityRename(migration, path, from, to) {
    if (from === to) return;
    recordStorageIdentityMigration(migration, path, [{ from, to, collision: false }]);
}

function legacyIdentityLookup(value) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
    return String(value)
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function legacyIdentityExact(value) {
    return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
}

function migrateLegacyGroupProfileRegistry(source, migration, path) {
    const migrated = migrateLegacyRegistryEntries(source, {
        maximum: 80,
        fallback: 'Legacy group',
        nameFromValue: true,
    });
    recordStorageIdentityMigration(migration, path, migrated.renames);
    const nameMappings = new Map();
    for (const [rawKey, value] of Object.entries(source || {})) {
        const names = [rawKey];
        const explicitName = isPlainObject(value) && hasOwn(value, 'name') ? value.name : undefined;
        if (legacyIdentityLookup(explicitName)) names.push(explicitName);
        for (const rawName of names) {
            const lookup = legacyIdentityLookup(rawName);
            const exact = legacyIdentityExact(rawName);
            if (exact) nameMappings.set(`exact:${exact}`, migrated.mappings[rawKey]);
            if (lookup && !nameMappings.has(`canonical:${lookup}`)) {
                nameMappings.set(`canonical:${lookup}`, migrated.mappings[rawKey]);
            }
        }
    }
    return { profiles: normalizeGroupProfiles(migrated.registry), nameMappings };
}

function migrateLegacyCharacterRegistry(source, groupNames, migration, path) {
    const migrated = migrateLegacyRegistryEntries(source, {
        maximum: 120,
        fallback: 'Legacy character',
        nameFromValue: true,
        reserveCharacterIdentities: true,
    });
    recordStorageIdentityMigration(migration, path, migrated.renames);
    const registry = Object.create(null);
    for (const [name, value] of Object.entries(migrated.registry)) {
        if (!isPlainObject(value)) {
            registry[name] = value;
            continue;
        }
        const entry = { ...value, name };
        if (Array.isArray(entry.aliases)) {
            const aliases = migrateLegacyRegistryIdentities(entry.aliases, {
                maximum: 120,
                fallback: `${name} alias`,
                reserveCharacterIdentities: true,
            });
            entry.aliases = aliases.values;
            recordStorageIdentityMigration(migration, `${path}.${name}.aliases`, aliases.renames);
        }
        if (hasOwn(entry, 'group')) {
            const oldGroup = ['string', 'number', 'boolean'].includes(typeof entry.group) ? String(entry.group) : '';
            const groupLookup = legacyIdentityLookup(entry.group);
            if (!groupLookup) {
                entry.group = '';
            } else {
                const mappedGroup = groupNames.get(`exact:${legacyIdentityExact(entry.group)}`)
                    || groupNames.get(`canonical:${groupLookup}`);
                entry.group = mappedGroup || migrateLegacyRegistryIdentityName(entry.group, 80, 'Legacy group');
            }
            recordStorageIdentityRename(migration, `${path}.${name}.group`, oldGroup, entry.group);
        }
        registry[name] = entry;
    }
    return registry;
}

function migrateLegacyColorDataEntry(source, migration, path) {
    if (!isPlainObject(source)) return source;
    const groups = migrateLegacyGroupProfileRegistry(source.groupProfiles, migration, `${path}.groupProfiles`);
    return {
        ...source,
        colors: normalizeCharacterColors(migrateLegacyCharacterRegistry(
            source.colors,
            groups.nameMappings,
            migration,
            `${path}.colors`,
        )),
        groupProfiles: groups.profiles,
    };
}

function migrateLegacyStoredColorData(source, migration) {
    const colorData = Object.create(null);
    if (!isPlainObject(source)) return colorData;
    for (const [key, value] of Object.entries(source)) {
        colorData[key] = migrateLegacyColorDataEntry(value, migration, `colorData.${key}`);
    }
    return colorData;
}

function migrateLegacyPresetEntries(entries, groups, migration, path) {
    if (!Array.isArray(entries)) return entries;
    const indexed = Object.create(null);
    entries.forEach((entry, index) => { indexed[index] = entry; });
    return Object.values(migrateLegacyCharacterRegistry(indexed, groups, migration, path));
}

function migrateLegacyStoredColorPresets(source, migration) {
    const migrated = migrateLegacyRegistryEntries(source, {
        maximum: 120,
        fallback: 'Legacy preset',
    });
    recordStorageIdentityMigration(migration, 'presets', migrated.renames);
    for (const [name, value] of Object.entries(migrated.registry)) {
        if (Array.isArray(value)) {
            migrated.registry[name] = migrateLegacyPresetEntries(
                value,
                new Map(),
                migration,
                `presets.${name}`,
            );
            continue;
        }
        if (!isPlainObject(value) || !Array.isArray(value.entries)) continue;
        const groups = migrateLegacyGroupProfileRegistry(
            value.groupProfiles,
            migration,
            `presets.${name}.groupProfiles`,
        );
        migrated.registry[name] = {
            ...value,
            entries: migrateLegacyPresetEntries(value.entries, groups.nameMappings, migration, `presets.${name}.entries`),
            groupProfiles: groups.profiles,
        };
    }
    return migrated.registry;
}

function migrateLegacyNamedCatalog(source, maximum, fallback, migration, path) {
    const migrated = migrateLegacyRegistryEntries(source, { maximum, fallback });
    recordStorageIdentityMigration(migration, path, migrated.renames);
    return migrated;
}

function migrateLegacyMappedCatalog(source, mappings, maximum, fallback, migration, path) {
    const registry = Object.create(null);
    const occupied = new Set();
    if (!isPlainObject(source)) return registry;
    for (const [rawName, value] of Object.entries(source)) {
        const mappedName = mappings?.[rawName];
        const baseName = normalizeRegistryIdentityName(mappedName, maximum)
            || migrateLegacyRegistryIdentityName(rawName, maximum, fallback);
        let name = baseName;
        let identity = normalizeRegistryIdentity(name, maximum);
        let collisionIndex = 2;
        while (!identity || occupied.has(identity)) {
            name = migrateLegacyRegistryIdentityName(`${baseName} (${collisionIndex++})`, maximum, fallback);
            identity = normalizeRegistryIdentity(name, maximum);
        }
        occupied.add(identity);
        registry[name] = value;
        const from = legacyIdentityExact(rawName);
        if (name !== from) {
            recordStorageIdentityMigration(migration, path, [{
                from,
                to: name,
                collision: name !== baseName,
            }]);
        }
    }
    return registry;
}

function attachStorageIdentityMigration(ui, migration) {
    const normalizedUi = isPlainObject(ui) ? { ...ui } : {};
    if (!migration.renamed) return normalizedUi;
    const previous = isPlainObject(normalizedUi.identitySchemaMigration)
        && normalizedUi.identitySchemaMigration.version === COLOR_SCHEMA_VERSION
        ? normalizedUi.identitySchemaMigration
        : null;
    const previousChanges = Array.isArray(previous?.changes) ? previous.changes : [];
    const changes = [...previousChanges, ...migration.changes].slice(0, STORAGE_IDENTITY_MIGRATION_REPORT_LIMIT);
    const renamed = (Number.isSafeInteger(previous?.renamed) ? previous.renamed : 0) + migration.renamed;
    normalizedUi.identitySchemaMigration = {
        version: COLOR_SCHEMA_VERSION,
        renamed,
        collisions: (Number.isSafeInteger(previous?.collisions) ? previous.collisions : 0) + migration.collisions,
        truncated: previous?.truncated === true || renamed > changes.length,
        changes,
    };
    return normalizedUi;
}

function migrateLegacyUiState(ui, migration) {
    const migrated = isPlainObject(ui) ? { ...ui } : {};
    if (isPlainObject(ui?.storageTrash) && isPlainObject(ui.storageTrash.entries)) {
        const entries = Object.create(null);
        for (const [key, value] of Object.entries(ui.storageTrash.entries)) {
            entries[key] = migrateLegacyColorDataEntry(value, migration, `ui.storageTrash.entries.${key}`);
        }
        migrated.storageTrash = { ...ui.storageTrash, entries };
    }
    return attachStorageIdentityMigration(migrated, migration);
}

function migrateLegacyAutoSyncRecord(source) {
    const migration = createStorageIdentityMigration();
    const palettes = migrateLegacyNamedCatalog(source?.customPalettes, 120, 'Legacy palette', migration, 'customPalettes');
    const gradients = migrateLegacyNamedCatalog(source?.customGradientPresets, 80, 'Legacy gradient', migration, 'customGradientPresets');
    return {
        ...source,
        version: COLOR_SCHEMA_VERSION,
        colorData: migrateLegacyStoredColorData(source?.colorData, migration),
        presets: migrateLegacyStoredColorPresets(source?.presets, migration),
        customPalettes: palettes.registry,
        customPaletteMeta: migrateLegacyMappedCatalog(
            source?.customPaletteMeta,
            palettes.mappings,
            120,
            'Legacy palette metadata',
            migration,
            'customPaletteMeta',
        ),
        customGradientPresets: gradients.registry,
        ui: migrateLegacyUiState(source?.ui, migration),
    };
}

function prepareAutoSyncRecordSource(source) {
    assertSupportedSchemaVersion(source, { moduleRecord: true });
    const version = Number(source?.version);
    return !Number.isFinite(version) || version < COLOR_SCHEMA_VERSION
        ? migrateLegacyAutoSyncRecord(source)
        : source;
}

function normalizeStylePackRegistry(source) {
    const registry = Object.create(null);
    if (!isPlainObject(source)) return registry;
    const entries = Object.entries(source).slice(0, 256);
    for (const [key, value] of entries) {
        const registryKey = String(key).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 512);
        if (!registryKey || isDangerousRegistryIdentity(registryKey) || !isPlainObject(value)) continue;
        const installedAt = typeof value.installedAt === 'string' && Number.isFinite(Date.parse(value.installedAt))
            ? new Date(value.installedAt).toISOString()
            : '';
        const itemMappings = Object.create(null);
        for (const category of ['palettes', 'gradientPresets', 'assignmentPresets']) {
            const mappings = value.itemMappings?.[category];
            if (!isPlainObject(mappings)) continue;
            const cleanMappings = Object.create(null);
            for (const [sourceName, targetName] of Object.entries(mappings).slice(0, 128)) {
                const sourceKey = String(sourceName).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 160);
                const target = String(targetName).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 160);
                if (sourceKey && target && !isDangerousRegistryIdentity(sourceKey)) cleanMappings[sourceKey] = target;
            }
            if (Object.keys(cleanMappings).length) itemMappings[category] = cleanMappings;
        }
        registry[registryKey] = { installedAt, itemMappings };
    }
    return registry;
}

function cloneJsonValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function sortJsonForComparison(value) {
    if (Array.isArray(value)) return value.map(sortJsonForComparison);
    if (!value || typeof value !== 'object') return value;
    const sorted = Object.create(null);
    for (const key of Object.keys(value).sort()) sorted[key] = sortJsonForComparison(value[key]);
    return sorted;
}

function recordsEqual(left, right) {
    return JSON.stringify(sortJsonForComparison(buildAutoSyncRecord(left)))
        === JSON.stringify(sortJsonForComparison(buildAutoSyncRecord(right)));
}

export function parseStorageObject(key) {
    try {
        const parsed = JSON.parse(getLegacyLocalStorageValue(key));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function getLegacyLocalStorageValue(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function applySettingsSubset(source, keys) {
    if (!source || typeof source !== 'object') return;
    const normalized = normalizeStoredSettings(source);
    for (const key of keys) {
        if (normalized[key] !== undefined) settings[key] = normalized[key];
    }
    delete settings.shareColorsGlobally;
}

export function buildSettingsSubset(keys) {
    normalizeCurrentColorStorageScope();
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
    const normalized = normalizeStoredSettings(settings);
    const subset = {};
    for (const key of keys) subset[key] = cloneJsonValue(normalized[key]);
    return subset;
}

export function pruneInactiveSettings() {
    if (!settings || typeof settings !== 'object') return;
    for (const key of Object.keys(settings)) {
        if (!ACTIVE_SETTING_KEYS.includes(key)) delete settings[key];
    }
}

export function buildFullSettingsSnapshot() {
    normalizeCurrentColorStorageScope();
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
    const normalized = normalizeStoredSettings(settings);
    const snapshot = {};
    for (const key of ACTIVE_SETTING_KEYS) {
        if (normalized[key] !== undefined) snapshot[key] = cloneJsonValue(normalized[key]);
    }
    snapshot.colorSchemaVersion = COLOR_SCHEMA_VERSION;
    return snapshot;
}

export function buildPortableSettingsSnapshot() {
    const snapshot = buildSettingsSubset(PORTABLE_SETTING_KEYS);
    snapshot.colorSchemaVersion = COLOR_SCHEMA_VERSION;
    return snapshot;
}

function normalizeSettingString(value, maximum, fallback = '') {
    if (typeof value !== 'string') return fallback;
    return value
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum);
}

function parseSettingNumber(value) {
    if (typeof value === 'number') return value;
    return typeof value === 'string' && value.trim() ? Number(value) : NaN;
}

export function normalizeStoredSettings(source) {
    if (!isPlainObject(source)) return {};
    const normalized = {};
    for (const [key, fallback] of Object.entries(TOGGLE_SETTING_DEFAULTS)) {
        if (hasOwn(source, key)) normalized[key] = normalizeBoolean(source[key], fallback);
    }

    if (hasOwn(source, 'themeMode')) normalized.themeMode = ['auto', 'dark', 'light'].includes(source.themeMode) ? source.themeMode : 'auto';
    if (hasOwn(source, 'colorTheme')) {
        const theme = normalizeSettingString(source.colorTheme, 127, 'pastel');
        const customName = theme.slice(0, 7).toLowerCase() === 'custom:'
            ? normalizeRegistryIdentityName(theme.slice(7))
            : '';
        normalized.colorTheme = hasOwn(COLOR_THEMES, theme)
            ? theme
            : customName ? `custom:${customName}` : 'pastel';
    }
    if (hasOwn(source, 'brightness')) {
        const value = parseSettingNumber(source.brightness);
        normalized.brightness = Number.isFinite(value) ? Math.max(-100, Math.min(100, Math.round(value))) : 0;
    }
    if (hasOwn(source, 'thoughtSymbols')) {
        normalized.thoughtSymbols = typeof source.thoughtSymbols === 'string'
            ? source.thoughtSymbols.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 64)
            : '*';
    }
    if (hasOwn(source, 'promptDepth')) {
        const value = parseSettingNumber(source.promptDepth);
        normalized.promptDepth = Number.isFinite(value) ? Math.max(0, Math.min(99, Math.round(value))) : 1;
    }
    if (hasOwn(source, 'promptRole')) normalized.promptRole = ['system', 'user'].includes(source.promptRole) ? source.promptRole : 'system';
    if (hasOwn(source, 'promptMode')) normalized.promptMode = ['inject', 'macro', 'profile'].includes(source.promptMode) ? source.promptMode : 'inject';
    if (hasOwn(source, 'coloringEngine')) normalized.coloringEngine = source.coloringEngine === 'dom' ? 'dom' : 'llm';
    if (hasOwn(source, 'gradientRandomMasterSeed')) {
        normalized.gradientRandomMasterSeed = typeof source.gradientRandomMasterSeed === 'string'
            ? source.gradientRandomMasterSeed.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128)
            : '';
    }
    if (hasOwn(source, 'colorVisionPreviewMode')) normalized.colorVisionPreviewMode = COLOR_VISION_MODES.includes(source.colorVisionPreviewMode) ? source.colorVisionPreviewMode : 'none';
    if (hasOwn(source, 'colorVisionPreviewSeverity')) {
        const value = parseSettingNumber(source.colorVisionPreviewSeverity);
        normalized.colorVisionPreviewSeverity = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 100;
    }
    if (hasOwn(source, 'colorVisionPreviewTarget')) normalized.colorVisionPreviewTarget = ['ui', 'chat', 'all'].includes(source.colorVisionPreviewTarget) ? source.colorVisionPreviewTarget : 'all';
    if (hasOwn(source, 'gradientAnimationMode')) normalized.gradientAnimationMode = GRADIENT_ANIMATION_MODES.includes(source.gradientAnimationMode) ? source.gradientAnimationMode : 'auto';
    if (hasOwn(source, 'sortMode')) normalized.sortMode = ['name', 'count', 'group'].includes(source.sortMode) ? source.sortMode : 'name';
    if (hasOwn(source, 'attributionReviewPolicy')) {
        const policy = typeof source.attributionReviewPolicy === 'string'
            ? source.attributionReviewPolicy.trim().toLowerCase()
            : '';
        normalized.attributionReviewPolicy = ['review', 'auto-high', 'legacy-auto'].includes(policy)
            ? policy
            : 'review';
    }
    if (hasOwn(source, 'attributionMaxTokens')) {
        const value = parseSettingNumber(source.attributionMaxTokens);
        normalized.attributionMaxTokens = Number.isFinite(value)
            ? Math.max(256, Math.min(32768, Math.round(value)))
            : 4096;
    }
    if (hasOwn(source, 'attributionVerifyPasses')) normalized.attributionVerifyPasses = normalizeAttributionVerifyPasses(parseSettingNumber(source.attributionVerifyPasses));
    if (hasOwn(source, 'colorSchemaVersion')) {
        const value = parseSettingNumber(source.colorSchemaVersion);
        normalized.colorSchemaVersion = Number.isFinite(value)
            ? Math.max(0, Math.min(COLOR_SCHEMA_VERSION, Math.trunc(value)))
            : 0;
    }
    for (const key of CONNECTION_PROFILE_SETTING_KEYS) {
        if (!hasOwn(source, key)) continue;
        normalized[key] = normalizeConnectionProfileId(source[key]);
    }
    // Guarded like every other key in this function. Unguarded, a snapshot that never mentions
    // the scope still came back carrying the default, so applyStoredSettingsSnapshot reset the
    // user's Per chat / Per card / Global choice to Per card, and buildSettingsSubsetFromSource
    // stamped that default permanently onto any stored record that predated the setting.
    // shareColorsGlobally is the pre-scope spelling of the same choice and still migrates.
    if (hasOwn(source, 'colorStorageScope') || hasOwn(source, 'shareColorsGlobally')) {
        normalized.colorStorageScope = normalizeColorStorageScope(source.colorStorageScope, source.shareColorsGlobally);
    }
    if (source.narratorStyle !== undefined || source.disableNarration !== undefined || source.narratorColor !== undefined) {
        normalized.narratorStyle = normalizeNarratorStyle(source.narratorStyle, { legacy: source });
        if (normalized.narratorStyle.gradientGenerator) {
            const seed = typeof source.narratorStyle?.gradientGenerator?.seed === 'string'
                ? source.narratorStyle.gradientGenerator.seed.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128)
                : '';
            normalized.narratorStyle.gradientGenerator = seed
                ? { ...normalized.narratorStyle.gradientGenerator, seed }
                : null;
        }
        normalized.disableNarration = !normalized.narratorStyle.enabled;
        normalized.narratorColor = normalized.narratorStyle.baseColor;
    }
    return normalized;
}

export function applyStoredSettingsSnapshot(source, { includeColorSchemaVersion = true } = {}) {
    const normalized = normalizeStoredSettings(source);
    if (!includeColorSchemaVersion) delete normalized.colorSchemaVersion;
    if (!Object.keys(normalized).length) {
        settings.allowRemoteFonts = getLocalRemoteFontConsent();
        return false;
    }
    normalized.allowRemoteFonts = getLocalRemoteFontConsent();
    Object.assign(settings, normalized);
    normalizeToggleSettings();
    return true;
}

export function buildSettingsSubsetFromSource(source, keys) {
    const subset = {};
    if (!isPlainObject(source)) return subset;
    const normalizedSource = normalizeStoredSettings(source);
    for (const key of keys) {
        if (normalizedSource[key] !== undefined) subset[key] = normalizedSource[key];
    }
    return subset;
}

export function getLegacyAutoSyncEnabledPreference() {
    const legacy = getLegacyLocalStorageValue(LEGACY_AUTO_SYNC_ENABLED_KEY);
    if (legacy === 'true') return true;
    if (legacy === 'false') return false;
    // Fresh installs default to off — auto-sync must be an explicit opt-in.
    return false;
}

export function normalizeStoredColorPresets(source) {
    const presets = Object.create(null);
    if (!isPlainObject(source)) return presets;
    const normalizeEntries = entries => entries.map(entry => isPlainObject(entry)
        ? { ...entry, gradient: serializeGradient(entry.gradient) }
        : entry);
    for (const [rawName, value] of Object.entries(normalizeNameDictionary(source))) {
        const name = normalizeRegistryIdentityName(rawName);
        if (!name) continue;
        if (Array.isArray(value)) {
            presets[name] = normalizeEntries(value);
        } else if (isPlainObject(value) && Array.isArray(value.entries)) {
            presets[name] = {
                version: 2,
                entries: normalizeEntries(value.entries),
                groupProfiles: normalizeGroupProfiles(value.groupProfiles),
            };
        } else {
            presets[name] = value;
        }
    }
    return presets;
}

export function normalizeStoredColorData(source) {
    const colorData = Object.create(null);
    if (!isPlainObject(source)) return colorData;
    for (const [key, value] of Object.entries(source)) {
        const normalized = normalizeColorDataEntry(value);
        colorData[key] = normalized || value;
    }
    return colorData;
}

export function cleanupLegacyAutoSyncPreference() {
    // Legacy settings remain read-only; only the separate device-consent key is written.
}

function normalizeAutoSyncSequence(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeAutoSyncWriterId(value) {
    if (typeof value !== 'string') return '';
    const writerId = value.trim();
    return AUTO_SYNC_WRITER_ID_PATTERN.test(writerId) ? writerId : '';
}

function normalizeAutoSyncTimestamp(value) {
    if (typeof value !== 'string') return '';
    const timestamp = value.trim();
    const match = timestamp.match(AUTO_SYNC_TIMESTAMP_PATTERN);
    if (!match) return '';
    const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, rawOffsetHour, rawOffsetMinute] = match;
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
        || Number(rawHour) > 23 || Number(rawMinute) > 59 || Number(rawSecond) > 59
        || (rawOffsetHour !== undefined && (Number(rawOffsetHour) > 23 || Number(rawOffsetMinute) > 59))) return '';
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

export function compareAutoSyncMarkers(left, right) {
    const leftWriterId = normalizeAutoSyncWriterId(left?.writerId);
    const rightWriterId = normalizeAutoSyncWriterId(right?.writerId);
    const leftTimestamp = normalizeAutoSyncTimestamp(left?.timestamp);
    const rightTimestamp = normalizeAutoSyncTimestamp(right?.timestamp);
    const leftSequence = normalizeAutoSyncSequence(left?.sequence);
    const rightSequence = normalizeAutoSyncSequence(right?.sequence);

    if (leftWriterId && leftWriterId === rightWriterId && leftSequence !== rightSequence) {
        return leftSequence < rightSequence ? -1 : 1;
    }
    // Legacy records had no writer identity. Preserve their timestamp ordering,
    // but never compare client-local sequences from different writers.
    if (leftWriterId !== rightWriterId && (leftWriterId || rightWriterId)) return 0;
    if (!leftTimestamp || !rightTimestamp) {
        if (leftTimestamp) return 1;
        if (rightTimestamp) return -1;
    } else {
        const leftTime = Date.parse(leftTimestamp);
        const rightTime = Date.parse(rightTimestamp);
        if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    }
    if (!leftWriterId && !rightWriterId && leftSequence !== rightSequence) {
        return leftSequence < rightSequence ? -1 : 1;
    }
    return 0;
}

export function buildAutoSyncRecord(source = {}) {
    source = prepareAutoSyncRecordSource(source);
    const settingsSource = isPlainObject(source?.settings) ? source.settings : null;
    const normalizedSettings = settingsSource && Object.keys(settingsSource).length
        ? buildSettingsSubsetFromSource(settingsSource, PORTABLE_SETTING_KEYS)
        : {};
    const globalSettingsSource = isPlainObject(source?.globalSettings) ? source.globalSettings : null;
    const parsedVersion = Number(source?.version);
    const record = {
        version: Number.isFinite(parsedVersion) ? parsedVersion : COLOR_SCHEMA_VERSION,
        timestamp: normalizeAutoSyncTimestamp(source?.timestamp),
        writerId: normalizeAutoSyncWriterId(source?.writerId),
        sequence: normalizeAutoSyncSequence(source?.sequence),
        autoSyncEnabled: typeof source?.autoSyncEnabled === 'boolean' ? source.autoSyncEnabled : getLegacyAutoSyncEnabledPreference(),
        settings: normalizedSettings,
        globalSettings: globalSettingsSource && Object.keys(globalSettingsSource).length
            ? buildSettingsSubsetFromSource(globalSettingsSource, PORTABLE_SETTING_KEYS)
            : {},
        colorData: normalizeStoredColorData(source?.colorData),
        presets: normalizeStoredColorPresets(source?.presets),
        customPalettes: normalizeCustomPaletteRegistry(source?.customPalettes),
        customPaletteMeta: normalizeNameDictionary(source?.customPaletteMeta),
        customGradientPresets: normalizeGradientPresetRegistry(source?.customGradientPresets),
        ui: isPlainObject(source?.ui) ? source.ui : {},
    };
    if (hasOwn(source, 'legacyLocalStorageMigrated')) {
        record.legacyLocalStorageMigrated = !!source.legacyLocalStorageMigrated;
    }
    if (hasOwn(source, 'stylePackRegistry')) record.stylePackRegistry = normalizeStylePackRegistry(source.stylePackRegistry);
    return record;
}

export function mergeIncomingAutoSyncRecord(source) {
    assertSupportedSchemaVersion(source, { moduleRecord: true });
    const current = getAutoSyncRecord(true);
    const incoming = buildAutoSyncRecord(source);
    return buildAutoSyncRecord({
        ...current,
        ...incoming,
        timestamp: hasOwn(source, 'timestamp') ? incoming.timestamp : current.timestamp,
        writerId: hasOwn(source, 'writerId') ? incoming.writerId : current.writerId,
        sequence: hasOwn(source, 'sequence') ? incoming.sequence : current.sequence,
        autoSyncEnabled: hasOwn(source, 'autoSyncEnabled') ? incoming.autoSyncEnabled : current.autoSyncEnabled,
        settings: hasOwn(source, 'settings') ? incoming.settings : current.settings,
        globalSettings: hasOwn(source, 'globalSettings') ? incoming.globalSettings : current.globalSettings,
        colorData: hasOwn(source, 'colorData') ? incoming.colorData : current.colorData,
        presets: hasOwn(source, 'presets') ? incoming.presets : current.presets,
        customPalettes: hasOwn(source, 'customPalettes') ? incoming.customPalettes : current.customPalettes,
        customPaletteMeta: hasOwn(source, 'customPaletteMeta') ? incoming.customPaletteMeta : current.customPaletteMeta,
        customGradientPresets: Object.prototype.hasOwnProperty.call(source || {}, 'customGradientPresets')
            ? incoming.customGradientPresets
            : current.customGradientPresets,
        ...(hasOwn(source, 'stylePackRegistry')
            ? { stylePackRegistry: incoming.stylePackRegistry }
            : hasOwn(current, 'stylePackRegistry') ? { stylePackRegistry: current.stylePackRegistry } : {}),
        ui: hasOwn(source, 'ui') ? incoming.ui : current.ui,
    });
}

let moduleSettingsPersistenceBarrier = Promise.resolve();
let moduleSettingsPersistenceActive = false;
let moduleSettingsPersistenceQueued = 0;
let ordinaryModuleSaveQueued = false;
let ordinaryModuleSaveExpected = null;
let ordinaryModuleSaveExpectedRegex = null;
let ordinaryModuleSaveRetryCount = 0;
let moduleSettingsDebounceTimer = null;
let storageOperationBarrier = Promise.resolve();
let storageOperationActive = false;
let deferredAutoSyncApplication = null;
let moduleSettingsActivityEpoch = 0;
let metadataPersistenceSuppression = 0;
let autoSyncPendingExpectedRecord = null;
const autoSyncRequestGate = createLatestRequestGate();
let autoSyncPollPromise = null;

function hasPendingColorStateActivity() {
    return !!(colorStateSaveTimer || pendingColorStateSaveData || pendingColorStateHistory
        || pendingColorStateUpdateList || pendingColorStateInjectPrompt);
}

function flushPendingColorStateActivity() {
    if (!hasPendingColorStateActivity()) return false;
    moduleSettingsActivityEpoch++;
    flushColorStateSave();
    return true;
}

function enqueueModuleSettingsPersistence(task) {
    moduleSettingsPersistenceQueued++;
    const result = moduleSettingsPersistenceBarrier
        .catch(() => undefined)
        .then(async () => {
            moduleSettingsPersistenceActive = true;
            try {
                return await task();
            } finally {
                moduleSettingsPersistenceActive = false;
                moduleSettingsPersistenceQueued = Math.max(0, moduleSettingsPersistenceQueued - 1);
                moduleSettingsActivityEpoch++;
                if (moduleSettingsPersistenceQueued === 0) applyDeferredAutoSyncRecord();
            }
        });
    moduleSettingsPersistenceBarrier = result.catch(() => undefined);
    return result;
}

function applyDeferredAutoSyncRecord() {
    flushPendingColorStateActivity();
    if (storageOperationActive || moduleSettingsPersistenceActive || moduleSettingsPersistenceQueued > 0
        || moduleSettingsDebounceTimer || hasPendingColorStateActivity() || !deferredAutoSyncApplication) return;
    const deferred = deferredAutoSyncApplication;
    deferredAutoSyncApplication = null;
    if ((deferred.options.request !== undefined && !autoSyncRequestGate.isCurrent(deferred.options.request))
        || (deferred.options.activityEpoch !== undefined
            && deferred.options.activityEpoch !== moduleSettingsActivityEpoch)) return;
    applyAutoSyncRecord(deferred.record, deferred.options);
}

function shouldReplaceDeferredAutoSync(record, options = {}) {
    if (!deferredAutoSyncApplication) return true;
    if (options.serverVerified === true) return true;
    if (deferredAutoSyncApplication.options?.serverVerified === true) return false;
    const candidate = buildAutoSyncRecord(record);
    const current = buildAutoSyncRecord(deferredAutoSyncApplication.record);
    const markerOrder = compareAutoSyncMarkers(candidate, current);
    if (markerOrder !== 0) return markerOrder > 0;
    if (options.force && !deferredAutoSyncApplication.options?.force) return true;
    return false;
}

function clearModuleSettingsDebounce() {
    if (!moduleSettingsDebounceTimer) return;
    clearTimeout(moduleSettingsDebounceTimer);
    moduleSettingsDebounceTimer = null;
}

// The last module record the server confirmed it holds, used to skip writes that
// would change nothing. Null means "unknown", which always writes.
let lastServerVerifiedModuleRecord = null;

function getModuleRecordSnapshot(source = getAutoSyncRecord(true)) {
    return buildAutoSyncRecord(cloneJsonValue(source));
}

function moduleRecordMatchesSnapshot(expected) {
    return recordsEqual(extension_settings[MODULE_NAME], expected);
}

function queueDebouncedModuleSettingsSave(expectedSource = getAutoSyncRecord(true), options = {}) {
    clearModuleSettingsDebounce();
    moduleSettingsActivityEpoch++;
    const expected = getModuleRecordSnapshot(expectedSource);
    const expectedRegex = cloneJsonValue(extension_settings.regex);
    const delay = Number.isFinite(options.delay) ? options.delay : 250;
    moduleSettingsDebounceTimer = setTimeout(() => {
        moduleSettingsDebounceTimer = null;
        queueImmediateSettingsSave(expected, { retry: options.retry === true, expectedRegex });
    }, delay);
}

export function queueImmediateSettingsSave(expectedSource = getAutoSyncRecord(true), options = {}) {
    clearModuleSettingsDebounce();
    moduleSettingsActivityEpoch++;
    if (!options.retry) ordinaryModuleSaveRetryCount = 0;
    ordinaryModuleSaveExpected = getModuleRecordSnapshot(expectedSource);
    ordinaryModuleSaveExpectedRegex = cloneJsonValue(options.expectedRegex ?? extension_settings.regex);
    if (ordinaryModuleSaveQueued) return;
    ordinaryModuleSaveQueued = true;
    void enqueueModuleSettingsPersistence(async () => {
        ordinaryModuleSaveQueued = false;
        const expected = ordinaryModuleSaveExpected;
        const expectedRegex = ordinaryModuleSaveExpectedRegex;
        ordinaryModuleSaveExpected = null;
        ordinaryModuleSaveExpectedRegex = null;
        if (!expected || !moduleRecordMatchesSnapshot(expected)) return false;
        if (typeof saveSettings !== 'function') {
            saveSettingsDebounced?.();
            return false;
        }
        try {
            await saveSettings();
            const storedSettings = await fetchExtensionSettingsFromServer();
            const stored = storedSettings?.[MODULE_NAME];
            const moduleMatches = !!stored && recordsEqual(buildAutoSyncRecord(stored), expected);
            const regexMatches = JSON.stringify(storedSettings?.regex ?? null) === JSON.stringify(expectedRegex ?? null);
            const matches = moduleMatches && regexMatches;
            if (matches) {
                ordinaryModuleSaveRetryCount = 0;
                lastServerVerifiedModuleRecord = getModuleRecordSnapshot(stored);
                confirmAutoSyncRecord(stored, { serverVerified: true });
            } else if (ordinaryModuleSaveRetryCount < 3 && moduleRecordMatchesSnapshot(expected)) {
                lastServerVerifiedModuleRecord = null;
                ordinaryModuleSaveRetryCount++;
                queueDebouncedModuleSettingsSave(expected, {
                    retry: true,
                    expectedRegex,
                    delay: 250 * (2 ** (ordinaryModuleSaveRetryCount - 1)),
                });
            } else {
                lastServerVerifiedModuleRecord = null;
                setAutoSyncError('Save could not be verified');
                saveSettingsDebounced?.();
            }
            return matches;
        } catch (error) {
            lastServerVerifiedModuleRecord = null;
            console.warn('[Dialogue Colors] Immediate settings save failed; falling back to a later save:', error);
            if (ordinaryModuleSaveRetryCount < 3 && moduleRecordMatchesSnapshot(expected)) {
                ordinaryModuleSaveRetryCount++;
                queueDebouncedModuleSettingsSave(expected, {
                    retry: true,
                    expectedRegex,
                    delay: 250 * (2 ** (ordinaryModuleSaveRetryCount - 1)),
                });
            } else {
                setAutoSyncError('Save could not be verified');
                saveSettingsDebounced?.();
            }
            return false;
        }
    });
}

function runStorageOperation(operation) {
    const result = storageOperationBarrier
        .catch(() => undefined)
        .then(async () => {
            storageOperationActive = true;
            try {
                return await operation();
            } finally {
                storageOperationActive = false;
                applyDeferredAutoSyncRecord();
            }
        });
    storageOperationBarrier = result.catch(() => undefined);
    return result;
}

export function persistModuleStore(record, { debounce = true, immediate = false } = {}) {
    const normalized = buildAutoSyncRecord(record || getAutoSyncRecord(true));
    extension_settings[MODULE_NAME] = normalized;
    // Writing data the server has already confirmed it holds is pure I/O, and
    // an immediate save costs a settings write plus a verification round-trip.
    // Any real change makes this comparison fail, so a needed write still runs.
    if (lastServerVerifiedModuleRecord !== null && recordsEqual(normalized, lastServerVerifiedModuleRecord)) {
        return normalized;
    }
    if (immediate) queueImmediateSettingsSave(normalized);
    else if (debounce) queueDebouncedModuleSettingsSave(normalized);
    return normalized;
}

export function getAutoSyncRecord(create = false) {
    const existing = extension_settings[MODULE_NAME];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        assertSupportedSchemaVersion(existing, { moduleRecord: true });
        migrateLegacyLocalConnectionProfiles(existing.globalSettings);
        const normalized = buildAutoSyncRecord(existing);
        extension_settings[MODULE_NAME] = normalized;
        return normalized;
    }
    if (!create) return null;
    const created = buildAutoSyncRecord({});
    extension_settings[MODULE_NAME] = created;
    return created;
}

export function getCustomGradientPresets() {
    return normalizeGradientPresetRegistry(getAutoSyncRecord(true).customGradientPresets);
}

function persistCustomGradientPresetRecord(record, options = {}) {
    if (!autoSyncEnabled) {
        persistModuleStore(record, options);
        return;
    }
    persistModuleStore(record, { debounce: false });
    if (autoSyncEnabled) saveSettingsToStore({ force: true });
    queueImmediateSettingsSave();
}

export function saveCustomGradientPreset(name, source, options = {}) {
    const normalizedName = normalizeRegistryIdentityName(name, 80);
    const preset = createGradientPresetFromEntry(source) || normalizeGradientPreset(source);
    if (!normalizedName || !preset) return null;
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.customGradientPresets = normalizeGradientPresetRegistry(record.customGradientPresets);
    if (Object.prototype.hasOwnProperty.call(record.customGradientPresets, normalizedName) && options.overwrite !== true) return null;
    record.customGradientPresets[normalizedName] = preset;
    persistCustomGradientPresetRecord(record, options);
    return normalizeGradientPreset(preset);
}

export function renameCustomGradientPreset(currentName, nextName, options = {}) {
    const current = normalizeRegistryIdentityName(currentName, 80);
    const next = normalizeRegistryIdentityName(nextName, 80);
    const presets = getCustomGradientPresets();
    if (!current || !next || !hasOwn(presets, current) || (current !== next && hasOwn(presets, next))) return false;
    if (current !== next) {
        presets[next] = presets[current];
        delete presets[current];
    }
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.customGradientPresets = presets;
    persistCustomGradientPresetRecord(record, options);
    return true;
}

export function deleteCustomGradientPreset(name, options = {}) {
    const normalizedName = normalizeRegistryIdentityName(name, 80);
    const presets = getCustomGradientPresets();
    if (!normalizedName || !Object.prototype.hasOwnProperty.call(presets, normalizedName)) return false;
    delete presets[normalizedName];
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.customGradientPresets = presets;
    persistCustomGradientPresetRecord(record, options);
    return true;
}

export function hasAutoSyncSettingsPayload(record) {
    return !!record && Object.keys(record.settings || {}).length > 0;
}

export function areSettingsSubsetsEqual(left, right) {
    for (const key of PORTABLE_SETTING_KEYS) {
        if (!jsonValuesEqual(left?.[key], right?.[key])) return false;
    }
    return true;
}

export function doAutoSyncMarkersMatch(left, right) {
    if (!left || !right) return false;
    const leftWriterId = normalizeAutoSyncWriterId(left.writerId);
    const rightWriterId = normalizeAutoSyncWriterId(right.writerId);
    if (leftWriterId || rightWriterId) {
        return !!leftWriterId
            && leftWriterId === rightWriterId
            && normalizeAutoSyncSequence(left.sequence) === normalizeAutoSyncSequence(right.sequence);
    }
    return normalizeAutoSyncTimestamp(left.timestamp) === normalizeAutoSyncTimestamp(right.timestamp)
        && normalizeAutoSyncSequence(left.sequence) === normalizeAutoSyncSequence(right.sequence);
}

export function getLatestKnownAutoSyncMarker() {
    return autoSyncPendingRecord || {
        timestamp: autoSyncLastTimestamp || '',
        writerId: autoSyncLastWriterId || '',
        sequence: autoSyncSequence || 0,
    };
}

export function isIncomingAutoSyncRecordNewer(record) {
    if (unsupportedSchemaVersionResult(record, { moduleRecord: true })) return false;
    const normalized = buildAutoSyncRecord(record);
    const known = getLatestKnownAutoSyncMarker();
    return compareAutoSyncMarkers(normalized, known) > 0;
}

export function clearAutoSyncSaveTimeout() {
    if (autoSyncSaveTimeout) {
        clearTimeout(autoSyncSaveTimeout);
        setAutoSyncSaveTimeout(null);
    }
}

export function setAutoSyncError(message = '') {
    setAutoSyncStatusError(message);
    updateAutoSyncUI();
}

export function clearAutoSyncError() {
    if (!autoSyncStatusError) return;
    setAutoSyncStatusError('');
    updateAutoSyncUI();
}

export function clearAutoSyncPending({ timedOut = false } = {}) {
    clearAutoSyncSaveTimeout();
    setAutoSyncPendingRecord(null);
    autoSyncPendingExpectedRecord = null;
    if (timedOut) setAutoSyncStatusError('Save failed');
    updateAutoSyncUI();
}

export function markAutoSyncPending(record) {
    setAutoSyncStatusError('');
    autoSyncPendingExpectedRecord = getModuleRecordSnapshot(record);
    setAutoSyncPendingRecord({
        timestamp: record?.timestamp || '',
        writerId: normalizeAutoSyncWriterId(record?.writerId),
        sequence: record?.sequence || 0,
    });
    clearAutoSyncSaveTimeout();
    setAutoSyncSaveTimeout(setTimeout(() => {
        console.warn('[Dialogue Colors] Auto-sync settings save timed out before confirmation.');
        clearAutoSyncPending({ timedOut: true });
    }, AUTO_SYNC_SAVE_TIMEOUT_MS));
    updateAutoSyncUI();
}

export function confirmAutoSyncRecord(record, { serverVerified = false } = {}) {
    const normalized = buildAutoSyncRecord(cloneJsonValue(record));
    if (!serverVerified) {
        updateAutoSyncUI();
        return normalized;
    }
    if (autoSyncPendingRecord && (!autoSyncPendingExpectedRecord
        || !recordsEqual(normalized, autoSyncPendingExpectedRecord))) {
        setAutoSyncStatusError('Remote state changed while saving');
        updateAutoSyncUI();
        return normalized;
    }
    setAutoSyncLastTimestamp(normalized.timestamp || null);
    setAutoSyncLastWriterId(normalized.writerId);
    setAutoSyncSequence(normalizeAutoSyncSequence(normalized.sequence));
    setAutoSyncEnabled(normalized.autoSyncEnabled);
    setAutoSyncPendingRecord(null);
    autoSyncPendingExpectedRecord = null;
    setAutoSyncStatusError('');
    clearAutoSyncSaveTimeout();
    updateAutoSyncUI();
    return normalized;
}

export function syncAutoSyncPolling() {
    if (autoSyncEnabled) {
        startAutoSyncPolling();
    } else {
        stopAutoSyncPolling();
    }
}

function preserveRemoteFontConsentInRecord(record) {
    const localConsent = getLocalRemoteFontConsent();
    const preserveSnapshot = snapshot => isPlainObject(snapshot) && hasOwn(snapshot, 'allowRemoteFonts')
        ? preserveLocalRemoteFontConsent(snapshot, localConsent)
        : snapshot;
    return {
        ...record,
        settings: preserveSnapshot(record.settings),
        globalSettings: preserveSnapshot(record.globalSettings),
    };
}

export function applyAutoSyncRecord(record, {
    force = false,
    serverVerified = false,
    request = undefined,
    activityEpoch = undefined,
} = {}) {
    if (unsupportedSchemaVersionResult(record, { moduleRecord: true })) {
        setAutoSyncError('Remote schema is newer than this extension');
        return 'unsupported_schema_version';
    }
    flushPendingColorStateActivity();
    if ((request !== undefined && !autoSyncRequestGate.isCurrent(request))
        || (activityEpoch !== undefined && activityEpoch !== moduleSettingsActivityEpoch)) {
        return 'superseded';
    }
    if (storageOperationActive || moduleSettingsPersistenceActive || moduleSettingsPersistenceQueued > 0
        || moduleSettingsDebounceTimer || ordinaryModuleSaveQueued || hasPendingColorStateActivity()) {
        const options = { force, serverVerified, request, activityEpoch };
        if (shouldReplaceDeferredAutoSync(record, options)) {
            deferredAutoSyncApplication = { record: cloneJsonValue(record), options };
        }
        return 'deferred';
    }
    if (serverVerified && autoSyncPendingRecord) {
        const serverRecord = buildAutoSyncRecord(cloneJsonValue(record));
        if (!autoSyncPendingExpectedRecord || !recordsEqual(serverRecord, autoSyncPendingExpectedRecord)) {
            setAutoSyncError('Remote state changed while saving');
            cleanupLegacyAutoSyncPreference();
            return 'conflict';
        }
    }
    const hasIncomingColorData = hasOwn(record, 'colorData');
    const incoming = buildAutoSyncRecord(cloneJsonValue(record));
    const normalized = preserveRemoteFontConsentInRecord(serverVerified
        ? incoming
        : mergeIncomingAutoSyncRecord(cloneJsonValue(record)));
    const matchesPending = !!autoSyncPendingRecord
        && !!autoSyncPendingExpectedRecord
        && recordsEqual(incoming, autoSyncPendingExpectedRecord);
    const disposition = getAutoSyncRecordDisposition({
        force,
        serverVerified,
        hasPending: !!autoSyncPendingRecord,
        matchesPending,
        matchesCurrent: serverVerified && recordsEqual(normalized, getModuleRecordSnapshot()),
        isNewer: !serverVerified && isIncomingAutoSyncRecordNewer(incoming),
    });
    if (disposition === 'conflict') {
        setAutoSyncError('Remote state changed while saving');
        cleanupLegacyAutoSyncPreference();
        return disposition;
    }
    if (disposition === 'confirm') {
        confirmAutoSyncRecord(normalized, { serverVerified: true });
        cleanupLegacyAutoSyncPreference();
        return disposition;
    }
    const previousAutoSyncEnabled = autoSyncEnabled;
    const previousEnabled = settings.enabled;
    const previousScope = activeStorageScope || getCurrentStorageScope();

    if (disposition !== 'apply') {
        updateAutoSyncUI();
        cleanupLegacyAutoSyncPreference();
        return disposition;
    }

    metadataPersistenceSuppression++;
    try {
        const colorSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        extension_settings[MODULE_NAME] = normalized;
        setAutoSyncEnabled(normalized.autoSyncEnabled);
        refreshGradientPresetControls();

        if (force) applyStoredSettingsSnapshot(readStoredGlobalSettings(normalized));

        const hasSettingsPayload = hasAutoSyncSettingsPayload(normalized);
        const applyIncomingSettings = () => {
            let settingsChanged = false;
            for (const key of PORTABLE_SETTING_KEYS) {
                if (key === 'allowRemoteFonts') continue;
                if (normalized.settings[key] !== undefined && !jsonValuesEqual(settings[key], normalized.settings[key])) {
                    settings[key] = cloneJsonValue(normalized.settings[key]);
                    settingsChanged = true;
                }
            }
            normalizeToggleSettings();
            return settingsChanged;
        };
        let changed = hasSettingsPayload ? applyIncomingSettings() : false;
        const scopeChanged = getCurrentStorageScope() !== previousScope;
        const tableReloaded = scopeChanged || hasIncomingColorData;
        if (tableReloaded) {
            loadData({
                persistPrevious: false,
                allowLegacyFallback: !hasIncomingColorData,
                persistMigrations: false,
                allowMetadataPersistence: false,
            });
            changed = true;
            if (hasSettingsPayload) applyIncomingSettings();
        }
        if (hasSettingsPayload || tableReloaded) {
            if (changed) {
                invalidateThemeCache();
                syncAllEffectiveColors();
                applyLiveColorChangesFromSnapshot(
                    colorSnapshot,
                    [...new Set([...Object.keys(colorSnapshot), ...Object.keys(characterColors)])],
                    { saveImmediately: true },
                );
            }
            syncUIWithSettings();
            updateCharList();
            injectPrompt();
        }

        confirmAutoSyncRecord(normalized, { serverVerified });

        if (autoSyncEnabled !== previousAutoSyncEnabled) {
            syncAutoSyncPolling();
        }
        cleanupLegacyAutoSyncPreference();
    } finally {
        metadataPersistenceSuppression--;
    }
    if (serverVerified && settings.enabled !== previousEnabled) synchronizeEnabledLifecycle();
    return disposition;
}

async function fetchExtensionSettingsFromServer() {
    const response = await fetch('/api/settings/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
        cache: 'no-cache',
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.result === 'file not find' || !data.settings) return null;

    let parsedSettings = null;
    try {
        parsedSettings = JSON.parse(data.settings);
    } catch {
        throw new Error('Invalid settings payload');
    }

    return parsedSettings?.extension_settings || null;
}

async function fetchModuleRecordFromServer() {
    const extensionSettings = await fetchExtensionSettingsFromServer();
    const record = extensionSettings?.[MODULE_NAME];
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    return record;
}

export async function fetchAutoSyncRecordFromServer() {
    return fetchModuleRecordFromServer();
}

// globalSettings is what a reload restores settings from; settings is the auto-sync transport
// payload. Both are PORTABLE_SETTING_KEYS subsets of the same live settings and are meant to
// agree, but saveSettingsToStore writes only the payload, so a record whose last write came
// from auto-sync carries an empty or stale globalSettings. Reading just globalSettings then
// dropped values the payload was holding correctly -- the storage scope most visibly, because
// it silently fell back to Per card on the next load.
//
// Gap filling only: a value globalSettings actually recorded still wins, so this recovers a
// lopsided record without letting the payload override a deliberate snapshot.
function readStoredGlobalSettings(record) {
    const globalSettings = isPlainObject(record?.globalSettings) ? record.globalSettings : {};
    const payload = isPlainObject(record?.settings) ? record.settings : {};
    if (!Object.keys(payload).length) return globalSettings;
    return { ...payload, ...globalSettings };
}

export function saveGlobalSettingsSnapshot(options = {}) {
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.globalSettings = buildPortableSettingsSnapshot();
    record.settings = buildSettingsSubset(PORTABLE_SETTING_KEYS);
    persistModuleStore(record, options);
}

export const CHAT_SCOPE_METADATA_KEY = 'dialogue_colors_chat_scope_id';

let activeStorageKey = null;
let activeStorageScope = null;
const pendingChatScopeFallbacks = new WeakMap();
const chatScopeMetadataPersistence = new WeakMap();
const transientChatScopes = new WeakMap();
const runtimeContextTokens = new WeakMap();
let nextRuntimeContextToken = 1;

function rememberChatScopeFallback(metadataId, hostStorageKey) {
    if (!metadataId || !hostStorageKey) return;
    const record = getAutoSyncRecord(true);
    record.ui = isPlainObject(record.ui) ? record.ui : {};
    record.ui.chatScopeFallbacks = isPlainObject(record.ui.chatScopeFallbacks) ? record.ui.chatScopeFallbacks : {};
    record.ui.chatScopeFallbacks[metadataId] = hostStorageKey;
    persistModuleStore(record);
}

function getCardIdentity(context = getContext()) {
    try {
        const groupId = getStringOrNumberId(context?.groupId) ?? getStringOrNumberId(context?.group_id);
        if (groupId !== null) return `group_${groupId}`;
        const char = context?.characters?.[context?.characterId];
        return char?.characterId ?? char?.avatar ?? context?.characterId ?? null;
    } catch { return null; }
}

export function getCharKey() {
    if (getCurrentStorageScope() === 'chat') return getStorageKeyForScope('chat');
    return getCardIdentity();
}

export function getLegacyCharKey() {
    try {
        const ctx = getContext();
        return ctx?.characters?.[ctx?.characterId]?.avatar || ctx?.characterId || null;
    } catch { return null; }
}

function hashStorageKeyComponent(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function sanitizeStorageKeyComponent(value, fallback = 'default') {
    const safeFallback = String(fallback || 'default').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '') || 'default';
    const raw = String(value ?? '').trim();
    if (!raw) return safeFallback;
    let sanitized = raw.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '');
    if (!sanitized) sanitized = safeFallback;
    if (sanitized === raw && sanitized.length <= 96) return sanitized;
    return `${sanitized.slice(0, 80)}_${hashStorageKeyComponent(raw)}`;
}

function getStringOrNumberId(value) {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

export function getHostProvidedChatId(context = getContext()) {
    return getStringOrNumberId(context?.chatId) ?? getStringOrNumberId(context?.chat_id);
}

function createChatScopeId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const randomPart = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${randomPart}`;
}

function persistGeneratedChatScopeId(metadata) {
    try {
        const result = saveMetadata?.();
        if (result && typeof result.catch === 'function') {
            const promise = Promise.resolve(result)
                .then(() => {
                    chatScopeMetadataPersistence.set(metadata, { status: 'completed', promise: null });
                    return true;
                })
                .catch(error => {
                    chatScopeMetadataPersistence.set(metadata, { status: 'failed', promise: null });
                    console.warn('[Dialogue Colors] Failed to persist chat scope metadata:', error);
                    return false;
                });
            chatScopeMetadataPersistence.set(metadata, { status: 'pending', promise });
        } else {
            // A void host API may save synchronously or may only queue a save. Treat it as unverified.
            chatScopeMetadataPersistence.set(metadata, { status: 'unverified', promise: null });
        }
    } catch (error) {
        chatScopeMetadataPersistence.set(metadata, { status: 'failed', promise: null });
        console.warn('[Dialogue Colors] Failed to persist chat scope metadata:', error);
    }
}

async function ensureChatScopeMetadataSafety(context = getContext()) {
    const metadata = context?.chatMetadata || context?.chat_metadata;
    if (!metadata || typeof metadata !== 'object') {
        return { safe: getHostProvidedChatId(context) !== null, status: 'unavailable' };
    }
    const pendingPersistence = chatScopeMetadataPersistence.get(metadata);
    if (pendingPersistence?.promise) await pendingPersistence.promise;
    const persistence = chatScopeMetadataPersistence.get(metadata);
    const finalStatus = persistence?.status || 'existing';
    const hasFallback = getHostProvidedChatId(context) !== null;
    const hasStoredId = getStringOrNumberId(metadata[CHAT_SCOPE_METADATA_KEY]) !== null;
    const completed = finalStatus === 'completed';
    if (completed && hasStoredId) chatScopeMetadataPersistence.delete(metadata);
    return {
        safe: hasFallback || (hasStoredId && (!persistence || completed)),
        status: finalStatus,
    };
}

export function getCurrentChatScopeId(context = getContext(), { persist = true } = {}) {
    const metadata = context?.chatMetadata || context?.chat_metadata;
    const storedId = metadata && typeof metadata === 'object'
        ? getStringOrNumberId(metadata[CHAT_SCOPE_METADATA_KEY])
        : null;
    if (storedId !== null) {
        const pendingFallback = metadata && pendingChatScopeFallbacks.get(metadata);
        if (pendingFallback) return pendingFallback;
        return `meta_${sanitizeStorageKeyComponent(storedId)}`;
    }

    const hostId = getHostProvidedChatId(context);
    if (!metadata || typeof metadata !== 'object') {
        if (hostId !== null) return `host_${sanitizeStorageKeyComponent(hostId)}`;
    }

    const transientOwner = metadata && typeof metadata === 'object'
        ? metadata
        : context?.chat && typeof context.chat === 'object' ? context.chat : null;
    const existingTransient = transientOwner ? transientChatScopes.get(transientOwner) : null;
    const generatedId = existingTransient?.id || createChatScopeId();
    const fallbackComponent = hostId !== null
        ? `host_${sanitizeStorageKeyComponent(hostId)}`
        : `meta_${sanitizeStorageKeyComponent(generatedId)}`;
    if (transientOwner && !existingTransient) {
        transientChatScopes.set(transientOwner, { id: generatedId, component: fallbackComponent });
    }
    if (!persist) return existingTransient?.component || fallbackComponent;

    if (metadata && typeof metadata === 'object') {
        try {
            metadata[CHAT_SCOPE_METADATA_KEY] = generatedId;
            pendingChatScopeFallbacks.set(metadata, fallbackComponent);
            if (hostId !== null) {
                const metadataComponent = `meta_${sanitizeStorageKeyComponent(generatedId)}`;
                const hostStorageKey = `dc_chat_${getChatOwnerStorageComponent(context)}_${fallbackComponent}`;
                rememberChatScopeFallback(metadataComponent, hostStorageKey);
            }
            persistGeneratedChatScopeId(metadata);
        } catch (error) {
            chatScopeMetadataPersistence.set(metadata, { status: 'failed', promise: null });
            console.warn('[Dialogue Colors] Could not write the chat scope ID to chat metadata:', error);
            return fallbackComponent;
        }
    }
    return metadata && pendingChatScopeFallbacks.get(metadata)
        ? pendingChatScopeFallbacks.get(metadata)
        : `meta_${sanitizeStorageKeyComponent(generatedId)}`;
}

function getChatOwnerStorageComponent(context = getContext()) {
    const groupId = getStringOrNumberId(context?.groupId) ?? getStringOrNumberId(context?.group_id);
    if (groupId !== null) return `group_${sanitizeStorageKeyComponent(groupId)}`;
    return `card_${sanitizeStorageKeyComponent(getCardIdentity(context))}`;
}

export function getStorageKeyForScope(scope, options = {}) {
    const normalizedScope = normalizeColorStorageScope(scope);
    if (normalizedScope === 'global') return 'dc_global';
    if (normalizedScope === 'chat') {
        const context = getContext();
        const persistMetadata = options.persistMetadata !== false && metadataPersistenceSuppression === 0;
        return `dc_chat_${getChatOwnerStorageComponent(context)}_${getCurrentChatScopeId(context, { persist: persistMetadata })}`;
    }
    return `dc_char_${sanitizeStorageKeyComponent(getCardIdentity())}`;
}

export function getStorageKey() {
    return getStorageKeyForScope(getCurrentStorageScope());
}

function getRuntimeContextToken(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return '';
    if (!runtimeContextTokens.has(value)) runtimeContextTokens.set(value, nextRuntimeContextToken++);
    return runtimeContextTokens.get(value);
}

function captureRuntimeContext() {
    const context = getContext();
    return {
        cardIdentity: getCardIdentity(context),
        characterId: context?.characterId ?? null,
        groupId: getStringOrNumberId(context?.groupId) ?? getStringOrNumberId(context?.group_id),
        hostChatId: getHostProvidedChatId(context),
        chatToken: getRuntimeContextToken(context?.chat),
        metadataToken: getRuntimeContextToken(context?.chatMetadata || context?.chat_metadata),
    };
}

function isRuntimeContextCurrent(captured) {
    if (!captured) return false;
    const current = captureRuntimeContext();
    return current.cardIdentity === captured.cardIdentity
        && current.characterId === captured.characterId
        && current.groupId === captured.groupId
        && current.hostChatId === captured.hostChatId
        && current.chatToken === captured.chatToken
        && current.metadataToken === captured.metadataToken;
}

function captureActiveStorageBinding() {
    const scope = activeStorageScope || getCurrentStorageScope();
    const contextKey = getStorageKeyForScope(scope);
    return {
        scope,
        key: activeStorageKey || contextKey,
        contextKey,
        aligned: !activeStorageKey || activeStorageKey === contextKey,
        context: captureRuntimeContext(),
    };
}

function isActiveStorageBindingCurrent(binding) {
    if (!binding) return false;
    const currentScope = activeStorageScope || getCurrentStorageScope();
    const currentKey = activeStorageKey || getStorageKeyForScope(currentScope);
    const freshContextKey = getStorageKeyForScope(currentScope);
    return binding.aligned === true
        && binding.key === binding.contextKey
        && currentScope === binding.scope
        && currentKey === binding.key
        && currentKey === freshContextKey
        && freshContextKey === binding.contextKey
        && isRuntimeContextCurrent(binding.context);
}

function areScopeStorageKeysCurrent(bindings) {
    return Object.entries(bindings || {}).every(([scope, key]) => getStorageKeyForScope(scope) === key);
}

function contextChangedError(message = 'The active chat or card changed before the operation completed.') {
    return { ok: false, error: 'context_changed', message };
}

function getLegacyCardStorageKeys() {
    const context = getContext();
    const isGroup = getStringOrNumberId(context?.groupId) !== null || getStringOrNumberId(context?.group_id) !== null;
    return [...new Set([getCardIdentity(), getLegacyCharKey(), ...(isGroup ? ['default'] : [])]
        .filter(value => value !== null && value !== undefined && String(value).length)
        .map(value => `dc_char_${String(value)}`))];
}

function getLegacyChatStorageKeys() {
    const hostId = getHostProvidedChatId();
    const metadata = getContext()?.chatMetadata || getContext()?.chat_metadata;
    const storedId = metadata && typeof metadata === 'object'
        ? getStringOrNumberId(metadata[CHAT_SCOPE_METADATA_KEY])
        : null;
    const metadataComponent = storedId !== null ? `meta_${sanitizeStorageKeyComponent(storedId)}` : '';
    const mappedFallback = metadataComponent
        ? getAutoSyncRecord(true).ui?.chatScopeFallbacks?.[metadataComponent]
        : null;
    return [...new Set([
        mappedFallback,
        hostId !== null ? `dc_chat_${getChatOwnerStorageComponent()}_host_${sanitizeStorageKeyComponent(hostId)}` : null,
    ].filter(Boolean))];
}

export function getLegacyStorageKey() {
    if (getCurrentStorageScope() !== 'card') return null;
    return getLegacyCardStorageKeys().find(key => key !== getStorageKeyForScope('card')) || null;
}

export function getStorageLabelForKey(key) {
    const value = String(key || '');
    if (value === 'dc_global') return 'Global shared colors';
    if (value.startsWith('dc_chat_')) return `Chat colors (${value.slice('dc_chat_'.length)})`;
    if (value.startsWith('dc_char_')) return `Card colors (${value.slice('dc_char_'.length)})`;
    return `Stored colors (${value || 'unknown'})`;
}

export function normalizeColorDataEntry(source) {
    if (!isPlainObject(source)) return null;
    const colors = normalizeCharacterColors(source.colors || {});
    const storedSettings = buildSettingsSubsetFromSource(source.settings, PORTABLE_SETTING_KEYS);
    return {
        colors,
        groupProfiles: normalizeGroupProfiles(source.groupProfiles),
        settings: storedSettings,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
    };
}

export function getUserColorDataStore() {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.colorData)) record.colorData = Object.create(null);
    return record.colorData;
}

export function getStoredColorData(key) {
    return normalizeColorDataEntry(getUserColorDataStore()[key]);
}

function findColorDataForScope(scope, primaryKey = getStorageKeyForScope(scope), options = {}) {
    const store = getUserColorDataStore();
    const primaryExists = Object.prototype.hasOwnProperty.call(store, primaryKey);
    const primaryEntry = normalizeColorDataEntry(store[primaryKey]);
    if (primaryEntry) return { entry: primaryEntry, exists: true, sourceKey: primaryKey, legacy: false };
    if (primaryExists) return { entry: null, exists: true, sourceKey: primaryKey, legacy: false };

    if (options.allowLegacyFallback === false || (scope !== 'card' && scope !== 'chat')) {
        return { entry: null, exists: primaryExists, sourceKey: primaryKey, legacy: false };
    }

    const candidates = [...new Set([
        primaryKey,
        ...(scope === 'card' ? getLegacyCardStorageKeys() : getLegacyChatStorageKeys()),
    ])];
    for (const key of candidates) {
        if (key === primaryKey) continue;
        const entry = normalizeColorDataEntry(store[key]);
        if (entry) return { entry, exists: true, sourceKey: key, legacy: true };
    }
    for (const key of candidates) {
        const legacyValue = parseStorageObject(key);
        const identityMigration = createStorageIdentityMigration();
        const entry = normalizeColorDataEntry(migrateLegacyColorDataEntry(
            legacyValue,
            identityMigration,
            `colorData.${key}`,
        ));
        if (entry) return { entry, exists: true, sourceKey: key, legacy: true, identityMigration };
    }
    return { entry: null, exists: primaryExists, sourceKey: primaryKey, legacy: false };
}

export function getStorageScopeDescriptor(scope = getCurrentStorageScope()) {
    const normalizedScope = normalizeColorStorageScope(scope);
    const key = getStorageKeyForScope(normalizedScope, { persistMetadata: false });
    const located = findColorDataForScope(normalizedScope, key);
    const colors = located.entry?.colors || {};
    return {
        scope: normalizedScope,
        key,
        exists: located.exists,
        characterCount: Object.keys(colors).length,
        groupProfileCount: Object.keys(located.entry?.groupProfiles || {}).length,
        updatedAt: located.entry?.updatedAt || '',
        label: getStorageLabelForKey(key),
        sourceKey: located.sourceKey,
        usesLegacyFallback: located.legacy,
    };
}

export function inspectStorageScopes() {
    return COLOR_STORAGE_SCOPES.map(scope => getStorageScopeDescriptor(scope));
}

function collectRenamedCharacterIds(value) {
    if (typeof value === 'string' || typeof value === 'number') return [String(value)];
    if (!isPlainObject(value)) return [];
    return [value.oldAvatar, value.old_avatar, value.avatar, value.characterId, value.character_id]
        .map(getStringOrNumberId)
        .filter(Boolean);
}

export function migrateRenamedCharacterStorage(oldValue, newValue) {
    const oldIds = [...new Set(collectRenamedCharacterIds(oldValue))];
    const newIds = [...new Set(collectRenamedCharacterIds(newValue))];
    if (!oldIds.length || !newIds.length) return Promise.resolve({ ok: true, migrated: 0 });
    return runStorageOperation(async () => {
        const baseRecord = getModuleRecordSnapshot();
        const record = getAutoSyncRecord(true);
        record.colorData = isPlainObject(record.colorData) ? record.colorData : {};
        const newCardKey = `dc_char_${sanitizeStorageKeyComponent(newIds[0])}`;
        const oldCardKeys = [...new Set(oldIds.flatMap(id => [
            `dc_char_${sanitizeStorageKeyComponent(id)}`,
            `dc_char_${id}`,
        ]))];
        const activeWasOld = oldCardKeys.includes(activeStorageKey)
            || oldIds.some(id => String(activeStorageKey || '').startsWith(`dc_chat_card_${sanitizeStorageKeyComponent(id)}_`));
        let migrated = 0;
        let fallbackChanged = false;
        if (!hasOwn(record.colorData, newCardKey)) {
            const sourceKey = oldCardKeys.find(key => hasOwn(record.colorData, key));
            if (sourceKey && sourceKey !== newCardKey) {
                record.colorData[newCardKey] = cloneJsonValue(record.colorData[sourceKey]);
                migrated++;
            }
        }

        const newChatPrefix = `dc_chat_card_${sanitizeStorageKeyComponent(newIds[0])}_`;
        const oldChatPrefixes = oldIds.map(id => `dc_chat_card_${sanitizeStorageKeyComponent(id)}_`);
        for (const [key, value] of Object.entries(record.colorData)) {
            const oldPrefix = oldChatPrefixes.find(prefix => key.startsWith(prefix));
            if (!oldPrefix) continue;
            const destinationKey = `${newChatPrefix}${key.slice(oldPrefix.length)}`;
            if (destinationKey === key || hasOwn(record.colorData, destinationKey)) continue;
            record.colorData[destinationKey] = cloneJsonValue(value);
            migrated++;
        }

        const fallbacks = record.ui?.chatScopeFallbacks;
        if (isPlainObject(fallbacks)) {
            for (const [metadataId, key] of Object.entries(fallbacks)) {
                const oldPrefix = oldChatPrefixes.find(prefix => String(key).startsWith(prefix));
                if (oldPrefix) {
                    fallbacks[metadataId] = `${newChatPrefix}${String(key).slice(oldPrefix.length)}`;
                    fallbackChanged = true;
                }
            }
        }
        // Pin buckets are keyed by the same card component the chat keys are built from, so a
        // rename orphans them exactly the way it orphans the tables above.
        const pins = record.ui?.pinnedCharacters;
        let pinsChanged = false;
        if (isPlainObject(pins)) {
            const newOwner = `card_${sanitizeStorageKeyComponent(newIds[0])}`;
            const oldOwner = oldIds
                .map(id => `card_${sanitizeStorageKeyComponent(id)}`)
                .find(owner => owner !== newOwner && isPlainObject(pins[owner]));
            if (oldOwner && !isPlainObject(pins[newOwner])) {
                pins[newOwner] = pins[oldOwner];
                delete pins[oldOwner];
                pinsChanged = true;
            }
        }

        if (!migrated && !fallbackChanged && !pinsChanged) {
            if (activeWasOld) {
                activeStorageKey = null;
                activeStorageScope = null;
                reloadCurrentStorageWithoutPersistence();
            }
            return { ok: true, migrated: 0 };
        }

        persistModuleStore(record, { debounce: false });
        const expected = prepareExpectedModuleRecord();
        const persisted = await persistSettingsImmediately(expected);
        if (!persisted) {
            const rollbackPersisted = await rollbackModuleRecord(baseRecord, expected);
            return { ok: false, error: 'rename_migration_persist_failed', migrated: 0, rollbackPersisted };
        }

        if (activeWasOld) {
            activeStorageKey = null;
            activeStorageScope = null;
            reloadCurrentStorageWithoutPersistence();
        }
        return { ok: true, migrated };
    });
}

export function setStoredColorData(key, colors, storedSettings = settings, options = {}) {
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    if (!isPlainObject(record.colorData)) record.colorData = Object.create(null);
    const previous = record.colorData[key];
    const entry = {
        colors: normalizeCharacterColors(colors || {}),
        groupProfiles: normalizeGroupProfiles(options.groupProfiles === undefined ? groupProfiles : options.groupProfiles),
        settings: buildSettingsSubsetFromSource(storedSettings, PORTABLE_SETTING_KEYS),
    };
    // A fresh timestamp on every write made an unchanged table look changed, so
    // nothing downstream could recognise a no-op save - and it left the dates in
    // the Storage Manager meaningless. Keep the old stamp for an identical payload.
    const unchanged = isPlainObject(previous)
        && typeof previous.updatedAt === 'string'
        && jsonValuesEqual(previous.colors, entry.colors)
        && jsonValuesEqual(previous.groupProfiles, entry.groupProfiles)
        && jsonValuesEqual(previous.settings, entry.settings);
    entry.updatedAt = unchanged ? previous.updatedAt : new Date().toISOString();
    record.colorData[key] = entry;
    persistModuleStore(record, options);
}

export function removeStoredColorData(key) {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.colorData) || !Object.prototype.hasOwnProperty.call(record.colorData, key)) return false;
    delete record.colorData[key];
    persistModuleStore(record);
    return true;
}

function getNextLocalAutoSyncSequence(record) {
    return normalizeAutoSyncWriterId(record?.writerId) === AUTO_SYNC_WRITER_ID
        ? normalizeAutoSyncSequence(record?.sequence) + 1
        : 1;
}

function prepareExpectedModuleRecord({ refreshAutoSyncSettings = true } = {}) {
    if (autoSyncEnabled) {
        if (refreshAutoSyncSettings) {
            saveSettingsToStore({ force: true, schedule: false });
        } else {
            const current = getAutoSyncRecord(true);
            const next = buildAutoSyncRecord({
                ...current,
                timestamp: new Date().toISOString(),
                writerId: AUTO_SYNC_WRITER_ID,
                sequence: getNextLocalAutoSyncSequence(current),
                autoSyncEnabled,
            });
            persistModuleStore(next, { debounce: false });
            markAutoSyncPending(next);
        }
    }
    return getModuleRecordSnapshot();
}

function reloadCurrentStorageWithoutPersistence() {
    loadData({
        persistPrevious: false,
        persistMigrations: false,
        allowMetadataPersistence: false,
    });
    invalidateThemeCache();
    syncAllEffectiveColors();
    syncUIWithSettings();
    updateCharList();
    injectPrompt();
}

function jsonValuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function restoreAppliedObjectChanges(base, applied, current) {
    const baseObject = isPlainObject(base) ? base : {};
    const appliedObject = isPlainObject(applied) ? applied : {};
    const currentObject = isPlainObject(current) ? current : {};
    const restored = cloneJsonValue(currentObject);
    const keys = new Set([...Object.keys(baseObject), ...Object.keys(appliedObject)]);

    for (const key of keys) {
        const baseHas = hasOwn(baseObject, key);
        const appliedHas = hasOwn(appliedObject, key);
        const currentHas = hasOwn(currentObject, key);
        const baseValue = baseObject[key];
        const appliedValue = appliedObject[key];
        const currentValue = currentObject[key];
        const baseMatchesApplied = baseHas === appliedHas
            && (!baseHas || jsonValuesEqual(baseValue, appliedValue));
        if (baseMatchesApplied) continue;

        const currentMatchesApplied = currentHas === appliedHas
            && (!currentHas || jsonValuesEqual(currentValue, appliedValue));
        if (currentMatchesApplied) {
            if (baseHas) restored[key] = cloneJsonValue(baseValue);
            else delete restored[key];
            continue;
        }

        if (appliedHas && currentHas && isPlainObject(appliedValue) && isPlainObject(currentValue)
            && (!baseHas || isPlainObject(baseValue))) {
            restored[key] = restoreAppliedObjectChanges(baseValue, appliedValue, currentValue);
        }
    }
    return restored;
}

function restoreModuleRecord(baseRecord, appliedRecord) {
    const currentRecord = getModuleRecordSnapshot();
    const restoredRecord = restoreAppliedObjectChanges(baseRecord, appliedRecord, currentRecord);
    if (normalizeAutoSyncWriterId(restoredRecord.writerId)
        && restoredRecord.writerId === normalizeAutoSyncWriterId(currentRecord.writerId)) {
        restoredRecord.sequence = Math.max(
            normalizeAutoSyncSequence(restoredRecord.sequence),
            normalizeAutoSyncSequence(currentRecord.sequence),
        );
    }
    persistModuleStore(restoredRecord, { debounce: false });
    return restoredRecord;
}

async function rollbackModuleRecord(baseRecord, appliedRecord) {
    try {
        restoreModuleRecord(baseRecord, appliedRecord);
        const rollbackExpected = prepareExpectedModuleRecord({ refreshAutoSyncSettings: false });
        return await persistSettingsImmediately(rollbackExpected);
    } catch (error) {
        console.error('[Dialogue Colors] Failed to roll back module settings:', error);
        return false;
    }
}

export function getStoredColorDataFingerprint(key) {
    const store = getUserColorDataStore();
    if (!hasOwn(store, key)) return null;
    return JSON.stringify(sortJsonForComparison(normalizeColorDataEntry(store[key]) || store[key]));
}

export function archiveStoredColorData(keys, reviewedFingerprints = null) {
    const binding = captureActiveStorageBinding();
    const reviewed = isPlainObject(reviewedFingerprints) ? cloneJsonValue(reviewedFingerprints) : null;
    return runStorageOperation(() => archiveStoredColorDataInternal(keys, binding, reviewed));
}

async function archiveStoredColorDataInternal(keys, binding, reviewedFingerprints) {
    if (!isActiveStorageBindingCurrent(binding)) {
        return { ...contextChangedError(), count: 0 };
    }
    const selectedKeys = [...new Set(Array.isArray(keys) ? keys : [])];
    if (reviewedFingerprints && selectedKeys.some(key => !hasOwn(reviewedFingerprints, key)
        || reviewedFingerprints[key] !== getStoredColorDataFingerprint(key))) {
        return { ...contextChangedError('The selected stored color data changed after review.'), count: 0 };
    }
    const baseRecord = getModuleRecordSnapshot();
    let appliedRecord = baseRecord;
    try {
        const record = getAutoSyncRecord(true);
        if (!isPlainObject(record.colorData)) record.colorData = Object.create(null);
        const entries = {};
        const currentKey = binding.key;
        for (const key of selectedKeys) {
            if (key === currentKey) continue;
            if (!Object.prototype.hasOwnProperty.call(record.colorData, key)) continue;
            entries[key] = cloneJsonValue(record.colorData[key]);
            delete record.colorData[key];
        }
        const archivedKeys = Object.keys(entries);
        if (!archivedKeys.length) return { ok: false, count: 0 };
        const deletedAt = new Date().toISOString();
        record.ui = {
            ...(isPlainObject(record.ui) ? record.ui : {}),
            storageTrash: { entries, deletedAt },
        };
        persistModuleStore(record, { debounce: false });
        const expected = prepareExpectedModuleRecord();
        appliedRecord = expected;
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = isActiveStorageBindingCurrent(binding);
        if (!persisted || !contextCurrent) {
            const rollbackPersisted = await rollbackModuleRecord(baseRecord, expected);
            const currentBinding = captureActiveStorageBinding();
            if (!contextCurrent && archivedKeys.includes(currentBinding.key)) {
                reloadCurrentStorageWithoutPersistence();
            }
            return {
                ...(contextCurrent
                    ? { ok: false, error: 'archive_persist_failed' }
                    : contextChangedError()),
                count: 0,
                rollbackPersisted,
            };
        }
        return { ok: true, count: archivedKeys.length, keys: archivedKeys };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to archive stored color data:', error);
        const contextCurrent = isActiveStorageBindingCurrent(binding);
        const rollbackPersisted = await rollbackModuleRecord(baseRecord, appliedRecord);
        if (!contextCurrent) reloadCurrentStorageWithoutPersistence();
        return {
            ...(contextCurrent
                ? { ok: false, error: 'archive_failed' }
                : contextChangedError()),
            count: 0,
            rollbackPersisted,
        };
    }
}

export function getArchivedColorData() {
    const trash = getUiState().storageTrash;
    if (!isPlainObject(trash) || !isPlainObject(trash.entries)) return null;
    const keys = Object.keys(trash.entries);
    return keys.length ? { keys, count: keys.length, deletedAt: trash.deletedAt || '' } : null;
}

export function restoreArchivedColorData() {
    const binding = captureActiveStorageBinding();
    return runStorageOperation(() => restoreArchivedColorDataInternal(binding));
}

async function restoreArchivedColorDataInternal(binding) {
    if (!isActiveStorageBindingCurrent(binding)) {
        return { ...contextChangedError(), count: 0, skipped: 0 };
    }
    const baseRecord = getModuleRecordSnapshot();
    let appliedRecord = baseRecord;
    try {
        const record = getAutoSyncRecord(true);
        const trash = cloneJsonValue(record.ui?.storageTrash);
        if (!isPlainObject(trash) || !isPlainObject(trash.entries)) return { ok: false, count: 0 };
        if (!isPlainObject(record.colorData)) record.colorData = Object.create(null);
        let restored = 0;
        let skipped = 0;
        const restoredKeys = [];
        const remainingEntries = {};
        for (const [key, value] of Object.entries(trash.entries)) {
            if (key === binding.key || Object.prototype.hasOwnProperty.call(record.colorData, key)) {
                remainingEntries[key] = value;
                skipped++;
                continue;
            }
            record.colorData[key] = value;
            restoredKeys.push(key);
            restored++;
        }
        if (!restored) return { ok: false, count: 0, skipped };
        if (Object.keys(remainingEntries).length) record.ui.storageTrash = { ...trash, entries: remainingEntries };
        else delete record.ui.storageTrash;
        persistModuleStore(record, { debounce: false });
        const expected = prepareExpectedModuleRecord();
        appliedRecord = expected;
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = isActiveStorageBindingCurrent(binding);
        if (!persisted || !contextCurrent) {
            const rollbackPersisted = await rollbackModuleRecord(baseRecord, expected);
            const currentBinding = captureActiveStorageBinding();
            if (!contextCurrent && restoredKeys.includes(currentBinding.key)) {
                reloadCurrentStorageWithoutPersistence();
            }
            return {
                ...(contextCurrent
                    ? { ok: false, error: 'restore_persist_failed' }
                    : contextChangedError()),
                count: 0,
                skipped,
                rollbackPersisted,
            };
        }
        return { ok: restored > 0, count: restored, skipped };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to restore archived color data:', error);
        const contextCurrent = isActiveStorageBindingCurrent(binding);
        const rollbackPersisted = await rollbackModuleRecord(baseRecord, appliedRecord);
        if (!contextCurrent) reloadCurrentStorageWithoutPersistence();
        return {
            ...(contextCurrent
                ? { ok: false, error: 'restore_failed' }
                : contextChangedError()),
            count: 0,
            skipped: 0,
            rollbackPersisted,
        };
    }
}

export function getUiState() {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.ui)) record.ui = {};
    return record.ui;
}

export function getLegendPosition() {
    const position = getUiState().legendPosition;
    return isPlainObject(position) ? position : {};
}

// Persona pins live outside colorData on purpose: colorData is keyed per chat, per
// card or globally, and the whole point of this option is to survive that key
// changing. Keyed by persona identity so switching personas restores the right one.
export function getPinnedPersonaColors() {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.ui)) record.ui = {};
    if (!isPlainObject(record.ui.personaColors)) record.ui.personaColors = {};
    return record.ui.personaColors;
}

function getPersonaPinKeys(personaName = getPersonaName()) {
    const legacyKey = normalizeRegistryIdentity(personaName);
    const context = getContext();
    const personaId = getStringOrNumberId(context?.personaId) ?? getStringOrNumberId(context?.persona_id);
    const avatar = getStringOrNumberId(context?.userAvatar) ?? getStringOrNumberId(context?.user_avatar);
    const personaKey = personaId === null ? '' : `persona:${sanitizeStorageKeyComponent(personaId, 'persona')}`;
    const avatarKey = avatar === null ? '' : `avatar:${sanitizeStorageKeyComponent(avatar, 'persona')}`;
    const key = personaKey || avatarKey || legacyKey;
    return { key, fallbackKeys: [...new Set([avatarKey, legacyKey].filter(candidate => candidate && candidate !== key))] };
}

function resolvePinnedPersonaColor(store, personaName = getPersonaName()) {
    const { key, fallbackKeys } = getPersonaPinKeys(personaName);
    let migrated = false;
    if (key && !hasOwn(store, key)) {
        const fallbackKey = fallbackKeys.find(candidate => hasOwn(store, candidate));
        if (fallbackKey) {
            store[key] = store[fallbackKey];
            delete store[fallbackKey];
            migrated = true;
        }
    }
    return { key, pinned: key ? store[key] : null, migrated };
}

function findRegistryKeyByIdentity(identity) {
    if (!identity) return '';
    for (const [key, entry] of Object.entries(characterColors)) {
        if (!entry) continue;
        if (normalizeRegistryIdentity(entry.name) === identity) return key;
        if ((entry.aliases || []).some(alias => normalizeRegistryIdentity(alias) === identity)) return key;
    }
    return '';
}

// The card's own character (every member, in a group) is Kept whenever it is in the list.
// Creation already does this through buildCharacterEntry; this catches tables that existed
// before the option did, and entries the user un-kept, on the next load.
export function markCardCharactersKept() {
    if (settings.keepCardCharacter === false) return false;
    let changed = false;
    for (const name of getCardCharacterNames()) {
        const key = findRegistryKeyByIdentity(normalizeRegistryIdentity(name));
        const entry = key ? characterColors[key] : null;
        if (!entry || entry.keep === true) continue;
        entry.keep = true;
        changed = true;
    }
    return changed;
}

export function markCurrentPersonaKept() {
    if (settings.keepPersonaCharacter !== true) return false;
    const personaIdentity = normalizeRegistryIdentity(getPersonaName());
    const key = findRegistryKeyByIdentity(personaIdentity);
    const entry = key ? characterColors[key] : null;
    if (!entry || entry.keep === true) return false;
    entry.keep = true;
    return true;
}

// Only the look is pinned. Aliases, dialogue counts and group membership stay
// per-scope, because those describe the chat rather than the user.
function buildPinnedPersonaColor(entry) {
    const normalized = normalizeCharacterEntry(entry);
    if (!normalized) return null;
    return {
        name: normalized.name,
        baseColor: normalized.baseColor,
        color: normalized.color,
        style: normalized.style,
        font: normalized.font,
        gradient: normalized.gradient,
        gradientGenerator: normalized.gradientGenerator,
    };
}

export function pinCurrentPersonaColor() {
    if (settings.persistPersonaColor !== true) return false;
    const personaIdentity = normalizeRegistryIdentity(getPersonaName());
    if (!personaIdentity) return false;
    const entry = characterColors[findRegistryKeyByIdentity(personaIdentity)];
    const pinned = buildPinnedPersonaColor(entry);
    if (!pinned) return false;
    const store = getPinnedPersonaColors();
    const resolved = resolvePinnedPersonaColor(store);
    if (!resolved.key || jsonValuesEqual(resolved.pinned, pinned)) return resolved.migrated;
    store[resolved.key] = pinned;
    return true;
}

// The personas this chat was played under, by the name each user message carries. A pinned
// persona that is not active can only be joined to the table by name, and a name is only
// trusted as that persona here when the chat itself shows it speaking as the user; an NPC
// who merely shares a name with one of the user's personas is left alone.
// ponytail: walks the whole chat on every save once two or more personas are pinned; cache
// by chat identity and length if that ever shows up in a profile.
function getChatUserPersonaIdentities() {
    const identities = new Set();
    let chat = [];
    try {
        chat = getContext()?.chat || [];
    } catch {
        chat = [];
    }
    if (!Array.isArray(chat)) return identities;
    for (const message of chat) {
        if (!message?.is_user) continue;
        const identity = normalizeRegistryIdentity(String(message.name ?? ''));
        if (identity) identities.add(identity);
    }
    return identities;
}

// Every pinned persona other than the active one that this chat was played under, paired
// with the pin's own key. resolvePinnedPersonaColor owns the active persona's key, so a
// record whose name is the active persona's is skipped rather than joined by name. The
// chat is only walked when there is a candidate to check it against.
function collectPresentPinnedPersonas(store, activeIdentity) {
    const candidates = [];
    for (const [pinKey, stored] of Object.entries(store)) {
        const identity = normalizeRegistryIdentity(String(stored?.name ?? ''));
        if (identity && identity !== activeIdentity) candidates.push({ pinKey, identity, stored });
    }
    if (!candidates.length) return candidates;
    const chatIdentities = getChatUserPersonaIdentities();
    return candidates.filter(candidate => chatIdentities.has(candidate.identity));
}

// Writes every persona present in this chat back to its pin, so a color edited while some
// other persona is active is not reverted the next time that persona is restored.
export function syncPinnedPersonaColors() {
    let changed = pinCurrentPersonaColor();
    if (settings.persistPersonaColor !== true) return changed;
    const store = getPinnedPersonaColors();
    const activeIdentity = normalizeRegistryIdentity(getPersonaName());
    for (const { pinKey, identity, stored } of collectPresentPinnedPersonas(store, activeIdentity)) {
        const pinned = buildPinnedPersonaColor(characterColors[findRegistryKeyByIdentity(identity)]);
        if (!pinned || jsonValuesEqual(buildPinnedPersonaColor(stored), pinned)) continue;
        store[pinKey] = pinned;
        changed = true;
    }
    return changed;
}

export function renamePinnedPersonaColor(oldName, newName) {
    const store = getPinnedPersonaColors();
    const previous = resolvePinnedPersonaColor(store, oldName);
    const next = getPersonaPinKeys(newName);
    const nextName = normalizeRegistryIdentityName(String(newName ?? ''));
    if (!previous.pinned || !next.key || !nextName) return false;
    store[next.key] = { ...previous.pinned, name: nextName };
    if (previous.key !== next.key) delete store[previous.key];
    persistModuleStore(getAutoSyncRecord(true));
    return true;
}

// Puts the pinned look back on the persona in whatever scope just loaded, creating
// the entry when this scope has never seen it. avoidConflicts stays off so the
// user's own colour is never nudged aside by whoever else is in this chat.
export function restorePinnedPersonaColor() {
    if (settings.persistPersonaColor !== true) return false;
    const store = getPinnedPersonaColors();
    const personaName = getPersonaName();
    const personaIdentity = normalizeRegistryIdentity(personaName);
    const resolved = resolvePinnedPersonaColor(store, personaName);
    let changed = resolved.migrated;
    if (applyPinnedPersonaLook(personaName, personaIdentity, buildPinnedPersonaColor(personaIdentity ? resolved.pinned : null))) changed = true;
    // The other personas this chat was played under get their pins back too, so a chat
    // with several of the user's personas in it shows every one in its own color.
    for (const { identity, stored } of collectPresentPinnedPersonas(store, personaIdentity)) {
        if (applyPinnedPersonaLook(stored.name, identity, buildPinnedPersonaColor(stored))) changed = true;
    }
    return changed;
}

function applyPinnedPersonaLook(name, identity, pinned) {
    if (!pinned) return false;
    const existingKey = findRegistryKeyByIdentity(identity);
    if (existingKey) {
        const entry = characterColors[existingKey];
        if (jsonValuesEqual(buildPinnedPersonaColor(entry), pinned)) return false;
        entry.baseColor = pinned.baseColor;
        entry.color = pinned.color;
        entry.style = pinned.style;
        entry.font = pinned.font;
        entry.gradient = cloneJsonValue(pinned.gradient);
        entry.gradientGenerator = cloneJsonValue(pinned.gradientGenerator);
        return true;
    }
    const built = buildCharacterEntry(name, {
        color: pinned.baseColor,
        colorMode: 'base',
        origin: 'persona',
        avoidConflicts: false,
        style: pinned.style,
        font: pinned.font,
        gradient: pinned.gradient,
        gradientGenerator: pinned.gradientGenerator,
    });
    if (!built.entry) return false;
    characterColors[built.key] = built.entry;
    clearSpeakerRegexCache();
    return true;
}

// Pinned characters live outside colorData for the same reason persona pins do: that table
// is keyed per chat, and the whole point of a pin is to survive the key changing. Bucketed
// by card or group so one card's cast never turns up in another card's chats.
export function getPinnedCharacters(owner = getChatOwnerStorageComponent()) {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.ui)) record.ui = {};
    if (!isPlainObject(record.ui.pinnedCharacters)) record.ui.pinnedCharacters = {};
    if (!isPlainObject(record.ui.pinnedCharacters[owner])) record.ui.pinnedCharacters[owner] = {};
    return record.ui.pinnedCharacters[owner];
}

// The reading half, which must not create the bucket: every card a user visits would
// otherwise leave an empty one behind in a record that gets synced.
function readPinnedCharacters(owner = getChatOwnerStorageComponent()) {
    const pins = getAutoSyncRecord(true).ui?.pinnedCharacters;
    return isPlainObject(pins?.[owner]) ? pins[owner] : null;
}

// Aliases and the lock come along because they describe the character. Dialogue counts and
// group membership stay per-scope for the same reason they do on a persona pin: they
// describe the chat, not who is in it.
function buildPinnedCharacter(entry) {
    const normalized = normalizeCharacterEntry(entry);
    if (!normalized) return null;
    return {
        name: normalized.name,
        baseColor: normalized.baseColor,
        color: normalized.color,
        style: normalized.style,
        font: normalized.font,
        gradient: normalized.gradient,
        gradientGenerator: normalized.gradientGenerator,
        aliases: normalized.aliases,
        locked: normalized.locked,
    };
}

// The live table is the only source of truth: Keep on writes the pin, Keep off removes it,
// so unpinning in any one chat stops the carry everywhere. Deliberately not gated on the
// scope - recording a pin costs nothing on card or global, and it means a later switch to
// per-chat already knows who the user wanted to keep.
function syncPinnedCharacters() {
    const existing = readPinnedCharacters();
    if (!existing && !Object.values(characterColors).some(entry => entry?.keep === true)) return false;
    const store = existing || getPinnedCharacters();
    let changed = false;
    for (const [key, entry] of Object.entries(characterColors)) {
        if (entry?.keep === true) {
            const pinned = buildPinnedCharacter(entry);
            if (!pinned || jsonValuesEqual(store[key], pinned)) continue;
            store[key] = pinned;
            changed = true;
        } else if (hasOwn(store, key)) {
            delete store[key];
            changed = true;
        }
    }
    return changed;
}

// A rekeyed entry leaves its old pin behind, and the next chat would seed the stale name
// back in as a second character. Only the rename paths know the old key.
export function removePinnedCharacterKey(key) {
    const store = readPinnedCharacters();
    if (!key || !store || !hasOwn(store, key)) return false;
    delete store[key];
    return true;
}

// Seeds the pinned cast into whatever chat just loaded, so a new chat opens with the
// characters the user pinned rather than an empty list. Chat scope only: a card or global
// table already outlives a chat change, so there is nothing there to put back.
export function restorePinnedCharacters() {
    if (getCurrentStorageScope() !== 'chat') return false;
    const store = readPinnedCharacters();
    if (!store) return false;
    let changed = false;
    for (const [key, stored] of Object.entries(store)) {
        const pinned = buildPinnedCharacter(stored);
        if (!pinned) continue;
        const entry = characterColors[key];
        if (entry) {
            if (entry.keep === true && jsonValuesEqual(buildPinnedCharacter(entry), pinned)) continue;
            entry.baseColor = pinned.baseColor;
            entry.color = pinned.color;
            entry.style = pinned.style;
            entry.font = pinned.font;
            entry.gradient = cloneJsonValue(pinned.gradient);
            entry.gradientGenerator = cloneJsonValue(pinned.gradientGenerator);
            entry.aliases = [...pinned.aliases];
            entry.locked = pinned.locked;
            entry.keep = true;
            changed = true;
            continue;
        }
        // avoidConflicts off for the same reason the persona restore leaves it off: the pin
        // is a color the user chose, so it is reproduced exactly rather than nudged aside by
        // whoever else is in this chat. randomGradient is pinned off too, or a pinned
        // character with no gradient would grow one on the way into every new chat.
        const built = buildCharacterEntry(pinned.name, {
            color: pinned.baseColor,
            colorMode: 'base',
            origin: 'pin',
            avoidConflicts: false,
            randomGradient: false,
            style: pinned.style,
            font: pinned.font,
            gradient: pinned.gradient,
            gradientGenerator: pinned.gradientGenerator,
            aliases: pinned.aliases,
            locked: pinned.locked,
            keep: true,
        });
        if (!built.entry) continue;
        characterColors[built.key] = built.entry;
        changed = true;
    }
    if (changed) clearSpeakerRegexCache();
    return changed;
}

export function captureHistoryPinState() {
    const owner = getChatOwnerStorageComponent();
    const existingCharacters = readPinnedCharacters(owner);
    const pinnedCharacters = cloneJsonValue(existingCharacters || {});
    for (const [key, entry] of Object.entries(characterColors)) {
        if (entry?.keep === true) {
            const pinned = buildPinnedCharacter(entry);
            if (pinned) pinnedCharacters[key] = pinned;
        } else {
            delete pinnedCharacters[key];
        }
    }

    const record = getAutoSyncRecord(true);
    const personaColors = cloneJsonValue(isPlainObject(record.ui?.personaColors) ? record.ui.personaColors : {});
    if (settings.persistPersonaColor === true) {
        const activeIdentity = normalizeRegistryIdentity(getPersonaName());
        const active = resolvePinnedPersonaColor(personaColors);
        const activePin = buildPinnedPersonaColor(characterColors[findRegistryKeyByIdentity(activeIdentity)]);
        if (active.key && activePin) personaColors[active.key] = activePin;
        for (const { pinKey, identity, stored } of collectPresentPinnedPersonas(personaColors, activeIdentity)) {
            const pinned = buildPinnedPersonaColor(characterColors[findRegistryKeyByIdentity(identity)]);
            if (pinned && !jsonValuesEqual(buildPinnedPersonaColor(stored), pinned)) personaColors[pinKey] = pinned;
        }
    }
    return {
        owner,
        characters: existingCharacters || Object.keys(pinnedCharacters).length ? pinnedCharacters : null,
        personas: personaColors,
    };
}

export function restoreHistoryPinState(pinState) {
    if (!isPlainObject(pinState) || pinState.owner !== getChatOwnerStorageComponent()) return false;
    const record = getAutoSyncRecord(true);
    record.ui = isPlainObject(record.ui) ? record.ui : {};
    const pinnedStores = isPlainObject(record.ui.pinnedCharacters) ? record.ui.pinnedCharacters : {};
    if (isPlainObject(pinState.characters)) pinnedStores[pinState.owner] = cloneJsonValue(pinState.characters);
    else delete pinnedStores[pinState.owner];
    if (Object.keys(pinnedStores).length) record.ui.pinnedCharacters = pinnedStores;
    else delete record.ui.pinnedCharacters;
    record.ui.personaColors = cloneJsonValue(isPlainObject(pinState.personas) ? pinState.personas : {});
    return true;
}

function restoreProtectedPinsAfterReplace() {
    const pinsRestored = restorePinnedCharacters();
    const personaRestored = restorePinnedPersonaColor();
    const personaKept = markCurrentPersonaKept();
    const cardKept = markCardCharactersKept();
    return pinsRestored || personaRestored || personaKept || cardKept;
}

export function saveLegendPosition(position) {
    const record = getAutoSyncRecord(true);
    const nextPosition = isPlainObject(position) ? position : {};
    record.ui = { ...(isPlainObject(record.ui) ? record.ui : {}), legendPosition: nextPosition };
    persistModuleStore(record);
}

// Extract dominant color from avatar image

function isLegacyLocalStorageMigrationComplete() {
    try {
        return localStorage.getItem(LEGACY_LOCAL_STORAGE_MIGRATION_KEY) === 'true';
    } catch {
        return false;
    }
}

function enumerateLegacyColorStorageKeys() {
    const keys = [];
    const length = Number(localStorage.length ?? 0);
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid localStorage length');
    for (let index = 0; index < length; index++) {
        const key = localStorage.key(index);
        if (key && (key.startsWith('dc_char_') || key.startsWith('dc_chat_') || key === 'dc_global')) keys.push(key);
    }
    return keys;
}

export function migrateLegacyLocalStorageIfNeeded() {
    const existing = extension_settings?.[MODULE_NAME];
    const unsupported = unsupportedSchemaVersionResult(existing, { moduleRecord: true });
    if (unsupported) return unsupported;
    const storedVersion = Number(existing?.version);
    const identitySchemaMigrated = !Number.isFinite(storedVersion) || storedVersion < COLOR_SCHEMA_VERSION;
    if (isLegacyLocalStorageMigrationComplete()) {
        const record = getAutoSyncRecord(true);
        if (identitySchemaMigrated) persistModuleStore(record);
        return { ok: true, migrated: false };
    }

    let legacyColorKeys;
    try {
        legacyColorKeys = enumerateLegacyColorStorageKeys();
    } catch {
        return { ok: false, error: 'legacy_storage_enumeration_failed' };
    }

    const record = getAutoSyncRecord(true);
    const identityMigration = createStorageIdentityMigration();
    let legacyPaletteMappings = null;

    if (!isPlainObject(record.globalSettings) || !Object.keys(record.globalSettings).length) {
        const legacyGlobal = parseStorageObject(LEGACY_GLOBAL_SETTINGS_KEY);
        const globalV2 = parseStorageObject(GLOBAL_SETTINGS_V2_KEY);
        if (hasAutoSyncSettingsPayload(record)) applySettingsSubset(record.settings, PORTABLE_SETTING_KEYS);
        applySettingsSubset(legacyGlobal, GLOBAL_VISUAL_KEYS);
        if (globalV2) applySettingsSubset(globalV2, PORTABLE_SETTING_KEYS);
        record.globalSettings = buildPortableSettingsSnapshot();
    }

    applyStoredSettingsSnapshot(readStoredGlobalSettings(record), { includeColorSchemaVersion: false });

    for (const key of [PRESETS_KEY, CUSTOM_PALETTE_KEY, CUSTOM_PALETTE_META_KEY, LEGEND_POSITION_KEY]) {
        const value = parseStorageObject(key);
        if (!value) continue;
        if (key === PRESETS_KEY && !Object.keys(record.presets || {}).length) {
            record.presets = normalizeStoredColorPresets(migrateLegacyStoredColorPresets(value, identityMigration));
        } else if (key === CUSTOM_PALETTE_KEY && !Object.keys(record.customPalettes || {}).length) {
            const palettes = migrateLegacyNamedCatalog(value, 120, 'Legacy palette', identityMigration, 'customPalettes');
            record.customPalettes = normalizeCustomPaletteRegistry(palettes.registry);
            legacyPaletteMappings = palettes.mappings;
        } else if (key === CUSTOM_PALETTE_META_KEY && !Object.keys(record.customPaletteMeta || {}).length) {
            record.customPaletteMeta = normalizeNameDictionary(migrateLegacyMappedCatalog(
                value,
                legacyPaletteMappings,
                120,
                'Legacy palette metadata',
                identityMigration,
                'customPaletteMeta',
            ));
        } else if (key === LEGEND_POSITION_KEY && !isPlainObject(record.ui?.legendPosition)) {
            record.ui = { ...(isPlainObject(record.ui) ? record.ui : {}), legendPosition: value };
        }
    }

    for (const key of legacyColorKeys) {
        if (record.colorData?.[key]) continue;
        const value = parseStorageObject(key);
        const normalized = normalizeColorDataEntry(migrateLegacyColorDataEntry(
            value,
            identityMigration,
            `colorData.${key}`,
        ));
        if (!normalized) continue;
        if (!isPlainObject(record.colorData)) record.colorData = Object.create(null);
        record.colorData[key] = normalized;
    }

    record.ui = attachStorageIdentityMigration(record.ui, identityMigration);
    persistModuleStore(record);
    try {
        localStorage.setItem(LEGACY_LOCAL_STORAGE_MIGRATION_KEY, 'true');
    } catch {
        return { ok: false, error: 'legacy_migration_marker_failed' };
    }
    return { ok: true, migrated: true };
}

function persistActiveStorageData(options = {}) {
    if (!activeStorageKey || !activeStorageScope) return false;
    setStoredColorData(activeStorageKey, characterColors, {
        ...settings,
        colorStorageScope: activeStorageScope,
    }, options);
    return true;
}

export function saveData(options = {}) {
    persistLocalRemoteFontConsent(settings.allowRemoteFonts === true);
    normalizeToggleSettings();
    persistLocalConnectionProfiles(settings);
    setCharacterColors(normalizeCharacterColors(characterColors));
    setGroupProfiles(normalizeGroupProfiles(groupProfiles));
    settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
    if (!options.preserveEffectiveColors) syncAllEffectiveColors();
    syncPinnedPersonaColors();
    syncPinnedCharacters();
    try {
        let storageKey = getStorageKey();
        if (activeStorageKey && storageKey !== activeStorageKey) {
            persistActiveStorageData({ debounce: false });
            console.warn('[Dialogue Colors] Ignored an unsafe direct storage scope change; use switchColorStorageScope().');
            settings.colorStorageScope = activeStorageScope;
            storageKey = activeStorageKey;
        }
        setStoredColorData(storageKey, characterColors, settings, { debounce: false });
        activeStorageKey = storageKey;
        activeStorageScope = getCurrentStorageScope();
        saveGlobalSettingsSnapshot(options.immediate === false ? {} : { immediate: true });
        // Trigger auto-sync if enabled
        if (autoSyncEnabled && !options.skipAutoSync) {
            saveSettingsToStore({ force: true });
        }
    } catch (e) {
        console.warn('[Dialogue Colors] Failed to save user settings:', e);
        toast.warning('Could not save color data to your user settings.');
    }
}

// A large brightness offset used to be subtracted straight back out of the effective color, which
// bottomed out at pure black or white and took the hue and saturation with it. The rendered color
// beside it survived intact, so hue and saturation can be read back off that.
//
// Not gated on a schema version: the guard is its own gate. A base color is only ever exactly
// black or white beside a colored rendering because of that arithmetic, and once repaired the
// condition can never be true again. Bumping the schema instead would re-arm every unrelated
// legacy migration for every existing user.
const REPAIRABLE_MIN_SATURATION = 4;

function repairFlattenedBaseColor(entry) {
    const baseColor = normalizeHexColor(entry.baseColor, null);
    if (baseColor !== '#000000' && baseColor !== '#ffffff') return false;
    const effectiveColor = normalizeHexColor(entry.color, null);
    if (!effectiveColor || effectiveColor === baseColor) return false;
    const [hue, saturation, lightness] = hexToHsl(effectiveColor);
    // A grey rendering has no hue left to recover; leave it for the user to recolor.
    if (saturation < REPAIRABLE_MIN_SATURATION) return false;
    // Inverting the brightness pass would hand back the same washed-out lightness it was
    // flattened onto, leaving the character exactly as indistinct as it was. The lightness is
    // genuinely gone, so re-home it somewhere the color can be seen again.
    const { floor, ceiling } = getRepairedBaseLightnessWindow();
    entry.baseColor = hslToHex(hue, saturation, Math.max(floor, Math.min(ceiling, lightness)));
    if (normalizeHexColor(entry.baseColor, null) === baseColor) return false;
    // Refresh the rendering too, or the pair stays inconsistent until some later save and the
    // repair is invisible.
    entry.color = applyThemeReadabilityAndBrightness(entry.baseColor);
    return true;
}

export function migrateColorSchemaIfNeeded() {
    const currentVersion = Number(settings.colorSchemaVersion);
    if (Number.isFinite(currentVersion) && currentVersion > COLOR_SCHEMA_VERSION) {
        assertSupportedSchemaVersion({ version: currentVersion });
    }
    const needsBaseColorMigration = !Number.isFinite(currentVersion) || currentVersion < 4;
    let changed = false;
    const previousNarratorStyle = JSON.stringify(settings.narratorStyle ?? null);
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
    if (previousNarratorStyle !== JSON.stringify(settings.narratorStyle)) changed = true;
    for (const entry of Object.values(characterColors)) {
        if (!entry) continue;
        // Runs before the re-derive below, which would otherwise keep the flattened base as-is,
        // and before any effective-color synchronization, which would overwrite the only copy of
        // the color the repair reads from.
        if (!needsBaseColorMigration && repairFlattenedBaseColor(entry)) changed = true;
        const normalizedColor = normalizeHexColor(entry.color, null);
        if (needsBaseColorMigration) {
            if (normalizedColor) {
                entry.color = normalizedColor;
                entry.baseColor = deriveBaseColorFromEffectiveColor(normalizedColor);
            } else {
                entry.baseColor = getBaseColor(entry);
                entry.color = applyThemeReadabilityAndBrightness(entry.baseColor);
            }
            changed = true;
        } else {
            const normalizedBase = normalizeHexColor(entry.baseColor, normalizedColor ? deriveBaseColorFromEffectiveColor(normalizedColor) : getBaseColor(entry));
            if (normalizeHexColor(entry.baseColor, '') !== normalizedBase) {
                entry.baseColor = normalizedBase;
                changed = true;
            }
            if (normalizedColor) {
                if (normalizeHexColor(entry.color) !== normalizedColor) changed = true;
                entry.color = normalizedColor;
            } else {
                const effective = applyThemeReadabilityAndBrightness(getBaseColor(entry));
                if (normalizeHexColor(entry.color) !== effective) changed = true;
                entry.color = effective;
            }
        }
        const serializedGradient = JSON.stringify(entry.gradient ?? null);
        entry.gradient = normalizeGradient(entry.gradient);
        if (serializedGradient !== JSON.stringify(entry.gradient)) changed = true;
        const serializedGenerator = JSON.stringify(entry.gradientGenerator ?? null);
        entry.gradientGenerator = normalizeEntryGradientGenerator(entry.gradientGenerator, entry.gradient);
        if (serializedGenerator !== JSON.stringify(entry.gradientGenerator)) changed = true;
    }
    if (settings.colorSchemaVersion !== COLOR_SCHEMA_VERSION) {
        settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
        changed = true;
    }
    return changed;
}

// Legacy localStorage fallback is intentionally read-only and only seeds user settings.

export function applyStoredColorData(data) {
    if (!data) return false;
    assertSupportedSchemaVersion({ settings: data.settings });
    if (data.colors) setCharacterColors(normalizeCharacterColors(data.colors));
    setGroupProfiles(normalizeGroupProfiles(data.groupProfiles));
    if (data.settings) {
        applyStoredSettingsSnapshot(data.settings);
        if (data.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
    } else if (data.colors) {
        settings.colorSchemaVersion = 0;
    }
    return !!data.colors;
}

// Legacy localStorage fallback is intentionally read-only and only seeds user settings.
export function loadData(options = {}) {
    const unsupported = unsupportedSchemaVersionResult(extension_settings?.[MODULE_NAME], { moduleRecord: true });
    if (unsupported) return unsupported;
    const record = getAutoSyncRecord(true);
    applyStoredSettingsSnapshot(readStoredGlobalSettings(record), { includeColorSchemaVersion: false });
    const scope = getCurrentStorageScope();
    const primaryKey = getStorageKeyForScope(scope, { persistMetadata: options.allowMetadataPersistence !== false });
    if (options.persistPrevious !== false && activeStorageKey && activeStorageKey !== primaryKey) {
        persistActiveStorageData();
    }
    setCharacterColors(normalizeCharacterColors({}));
    setGroupProfiles(normalizeGroupProfiles({}));
    selectedCharacterKeys.clear();
    setExpandedCharacterRows(new Set());
    setSwapMode(null);
    clearSpeakerRegexCache();
    const located = findColorDataForScope(scope, primaryKey, options);
    const loaded = applyStoredColorData(located.entry);
    if (loaded && (located.legacy || located.sourceKey !== primaryKey) && options.persistMigrations !== false) {
        if (located.identityMigration?.renamed) {
            record.ui = attachStorageIdentityMigration(record.ui, located.identityMigration);
        }
        setStoredColorData(primaryKey, characterColors, { ...settings, colorStorageScope: scope });
    }
    applyStoredSettingsSnapshot(readStoredGlobalSettings(record), { includeColorSchemaVersion: false });
    applyLocalConnectionProfiles();
    settings.colorStorageScope = scope;
    normalizeToggleSettings();
    activeStorageKey = primaryKey;
    activeStorageScope = scope;
    setLastCharKey(scope === 'chat' ? primaryKey : getCardIdentity());
    // Pins first, persona last: a persona that is also pinned should still show the color
    // the persona option holds, not the one the pin captured in some other chat.
    const pinsRestored = restorePinnedCharacters();
    const personaRestored = restorePinnedPersonaColor();
    const personaKept = markCurrentPersonaKept();
    const cardKept = markCardCharactersKept();
    if ((migrateColorSchemaIfNeeded() || personaRestored || pinsRestored || personaKept || cardKept) && options.persistMigrations !== false) {
        saveData({ preserveEffectiveColors: true });
    }
    setColorHistory([createHistorySnapshot()]); setHistoryIndex(0);
    setLastProcessedMessageSignature('');
    return {
        scope,
        key: primaryKey,
        loaded,
        sourceKey: located.sourceKey,
        usedLegacyFallback: located.legacy,
        characterCount: Object.keys(characterColors).length,
    };
}

function captureStorageTransaction(binding = captureActiveStorageBinding()) {
    return {
        record: getModuleRecordSnapshot(),
        colors: cloneJsonValue(characterColors),
        groupProfiles: cloneJsonValue(groupProfiles),
        settings: cloneJsonValue(settings),
        history: [...colorHistory],
        historyIndex,
        lastCharKey,
        lastProcessedMessageSignature,
        selectedKeys: [...selectedCharacterKeys],
        expandedKeys: [...expandedCharacterRows],
        swapMode,
        binding,
    };
}

function captureStorageRuntimeState() {
    return {
        colors: cloneJsonValue(characterColors),
        groupProfiles: cloneJsonValue(groupProfiles),
        settings: cloneJsonValue(settings),
        history: [...colorHistory],
        historyIndex,
        lastCharKey,
        lastProcessedMessageSignature,
        activeStorageKey,
        activeStorageScope,
        selectedKeys: [...selectedCharacterKeys],
        expandedKeys: [...expandedCharacterRows],
        swapMode,
    };
}

function restoreRuntimeValue(baseValue, appliedValue, currentValue) {
    if (jsonValuesEqual(currentValue, appliedValue)) return cloneJsonValue(baseValue);
    if (isPlainObject(appliedValue) && isPlainObject(currentValue)
        && (!baseValue || isPlainObject(baseValue))) {
        return restoreAppliedObjectChanges(baseValue, appliedValue, currentValue);
    }
    return cloneJsonValue(currentValue);
}

function restoreSettingsState(snapshot) {
    for (const key of Object.keys(settings)) delete settings[key];
    Object.assign(settings, cloneJsonValue(snapshot));
}

async function rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, contextCurrent) {
    try {
        restoreModuleRecord(transaction.record, appliedRecord || getModuleRecordSnapshot());
        const canRestoreCapturedRuntime = contextCurrent && isRuntimeContextCurrent(transaction.binding.context);
        if (canRestoreCapturedRuntime) {
            const currentRuntime = captureStorageRuntimeState();
            const baseRuntime = {
                colors: transaction.colors,
                groupProfiles: transaction.groupProfiles,
                settings: transaction.settings,
                history: transaction.history,
                historyIndex: transaction.historyIndex,
                lastCharKey: transaction.lastCharKey,
                lastProcessedMessageSignature: transaction.lastProcessedMessageSignature,
                activeStorageKey: transaction.binding.key,
                activeStorageScope: transaction.binding.scope,
                selectedKeys: transaction.selectedKeys,
                expandedKeys: transaction.expandedKeys,
                swapMode: transaction.swapMode,
            };
            const applied = appliedRuntime || currentRuntime;
            restoreSettingsState(restoreRuntimeValue(baseRuntime.settings, applied.settings, currentRuntime.settings));
            activeStorageKey = restoreRuntimeValue(baseRuntime.activeStorageKey, applied.activeStorageKey, currentRuntime.activeStorageKey);
            activeStorageScope = restoreRuntimeValue(baseRuntime.activeStorageScope, applied.activeStorageScope, currentRuntime.activeStorageScope);
            const restoredColors = restoreRuntimeValue(baseRuntime.colors, applied.colors, currentRuntime.colors);
            setCharacterColors(normalizeCharacterColors(restoredColors));
            const restoredGroupProfiles = restoreRuntimeValue(baseRuntime.groupProfiles, applied.groupProfiles, currentRuntime.groupProfiles);
            setGroupProfiles(normalizeGroupProfiles(restoredGroupProfiles));
            const restoredSelectedKeys = restoreRuntimeValue(baseRuntime.selectedKeys, applied.selectedKeys, currentRuntime.selectedKeys);
            selectedCharacterKeys.clear();
            restoredSelectedKeys.filter(key => hasOwn(characterColors, key) && characterColors[key]).forEach(key => selectedCharacterKeys.add(key));
            const restoredExpandedKeys = restoreRuntimeValue(baseRuntime.expandedKeys, applied.expandedKeys, currentRuntime.expandedKeys);
            setExpandedCharacterRows(new Set(restoredExpandedKeys.filter(key => hasOwn(characterColors, key) && characterColors[key])));
            const restoredSwapMode = restoreRuntimeValue(baseRuntime.swapMode, applied.swapMode, currentRuntime.swapMode);
            setSwapMode(restoredSwapMode && hasOwn(characterColors, restoredSwapMode) && characterColors[restoredSwapMode] ? restoredSwapMode : null);
            if (jsonValuesEqual(currentRuntime.history, applied.history)
                && currentRuntime.historyIndex === applied.historyIndex) {
                setColorHistory([...baseRuntime.history]);
                setHistoryIndex(baseRuntime.historyIndex);
            } else {
                const appliedHistory = Array.isArray(applied.history) ? applied.history : [];
                const currentHistory = Array.isArray(currentRuntime.history) ? currentRuntime.history : [];
                const hasAppliedPrefix = appliedHistory.every((snapshot, index) => currentHistory[index] === snapshot);
                const concurrentSuffix = hasAppliedPrefix ? currentHistory.slice(appliedHistory.length) : [];
                const transformedSuffix = concurrentSuffix.map(snapshot => {
                    try {
                        const parsed = parseHistorySnapshot(snapshot);
                        return createHistorySnapshot(
                            restoreAppliedObjectChanges(baseRuntime.colors, applied.colors, parsed.colors),
                            restoreAppliedObjectChanges(baseRuntime.groupProfiles, applied.groupProfiles, parsed.groupProfiles),
                            parsed.narratorStyle || settings,
                        );
                    } catch {
                        return null;
                    }
                }).filter(Boolean);
                const nextHistory = [
                    ...baseRuntime.history,
                    ...transformedSuffix,
                    ...(transformedSuffix.length ? [] : [createHistorySnapshot(restoredColors, restoredGroupProfiles, settings)]),
                ].slice(-20);
                setColorHistory(nextHistory);
                setHistoryIndex(nextHistory.length - 1);
            }
            setLastCharKey(restoreRuntimeValue(baseRuntime.lastCharKey, applied.lastCharKey, currentRuntime.lastCharKey));
            setLastProcessedMessageSignature(restoreRuntimeValue(baseRuntime.lastProcessedMessageSignature, applied.lastProcessedMessageSignature, currentRuntime.lastProcessedMessageSignature));
            clearSpeakerRegexCache();
            invalidateThemeCache();
            syncAllEffectiveColors();
            applyLiveColorChangesFromSnapshot(
                failedSnapshot,
                [...new Set([...Object.keys(failedSnapshot || {}), ...Object.keys(characterColors)])],
                { saveImmediately: true },
            );
            refreshGradientPresetControls();
            syncUIWithSettings();
            updateCharList();
            injectPrompt();
        } else {
            activeStorageKey = null;
            activeStorageScope = null;
            reloadCurrentStorageWithoutPersistence();
            refreshGradientPresetControls();
        }
        const rollbackExpected = prepareExpectedModuleRecord({ refreshAutoSyncSettings: false });
        return await persistSettingsImmediately(rollbackExpected);
    } catch (error) {
        console.error('[Dialogue Colors] Failed to roll back storage transaction:', error);
        return false;
    }
}

async function persistSettingsImmediately(expectedSource = getAutoSyncRecord(true)) {
    const expected = getModuleRecordSnapshot(expectedSource);
    clearModuleSettingsDebounce();
    return enqueueModuleSettingsPersistence(async () => {
        if (!moduleRecordMatchesSnapshot(expected)) return false;
        if (typeof saveSettings !== 'function') {
            saveSettingsDebounced?.();
            return false;
        }
        try {
            await saveSettings();
            const stored = await fetchModuleRecordFromServer();
            const matches = !!stored && recordsEqual(stored, expected);
            if (matches) confirmAutoSyncRecord(stored, { serverVerified: true });
            return matches;
        } catch (error) {
            console.warn('[Dialogue Colors] Failed to persist storage scope state:', error);
            return false;
        }
    });
}

export async function switchColorStorageScope(scope, strategy = 'switch') {
    if (!COLOR_STORAGE_SCOPES.includes(scope)) {
        return { ok: false, error: 'invalid_scope', message: `Unknown color storage scope: ${String(scope)}` };
    }
    if (!['switch', 'copy', 'replace', 'merge', 'empty'].includes(strategy)) {
        return { ok: false, error: 'invalid_strategy', message: `Unknown scope switch strategy: ${String(strategy)}` };
    }
    const binding = captureActiveStorageBinding();
    const targetKey = getStorageKeyForScope(scope);
    return runStorageOperation(() => switchColorStorageScopeInternal(scope, strategy, binding, targetKey));
}

async function switchColorStorageScopeInternal(
    scope,
    strategy = 'switch',
    binding = captureActiveStorageBinding(),
    targetKey = getStorageKeyForScope(scope),
) {
    const previousScope = binding.scope;
    const previousKey = binding.key;
    const scopeKeyBindings = { [previousScope]: previousKey, [scope]: targetKey };
    if (!isActiveStorageBindingCurrent(binding) || !areScopeStorageKeysCurrent(scopeKeyBindings)) {
        return { ...contextChangedError(), previousScope, previousKey };
    }
    if (previousScope === 'chat' || scope === 'chat') {
        const metadataSafety = await ensureChatScopeMetadataSafety();
        if (!isActiveStorageBindingCurrent(binding) || !areScopeStorageKeysCurrent(scopeKeyBindings)) {
            return { ...contextChangedError(), previousScope, previousKey };
        }
        if (!metadataSafety.safe) {
            return {
                ok: false,
                error: 'chat_metadata_persist_failed',
                message: 'The per-chat identifier could not be saved and no stable host chat identifier is available.',
                previousScope,
                previousKey,
            };
        }
    }

    let transaction = captureStorageTransaction(binding);
    let appliedRecord = transaction.record;
    let appliedRuntime = captureStorageRuntimeState();
    try {
        const sourceColors = normalizeCharacterColors(characterColors);
        const sourceGroupProfiles = normalizeGroupProfiles(groupProfiles);
        settings.colorStorageScope = previousScope;
        normalizeToggleSettings();
        setStoredColorData(previousKey, sourceColors, { ...settings, colorStorageScope: previousScope }, {
            debounce: false,
            groupProfiles: sourceGroupProfiles,
        });
        const sourceExpected = prepareExpectedModuleRecord();
        appliedRecord = sourceExpected;
        appliedRuntime = captureStorageRuntimeState();
        const sourcePersisted = await persistSettingsImmediately(sourceExpected);
        const sourceContextCurrent = areScopeStorageKeysCurrent(scopeKeyBindings)
            && isActiveStorageBindingCurrent(binding);
        if (!sourcePersisted || !sourceContextCurrent) {
            const rollbackPersisted = await rollbackModuleRecord(transaction.record, sourceExpected);
            if (!sourceContextCurrent) reloadCurrentStorageWithoutPersistence();
            return {
                ok: false,
                error: sourceContextCurrent ? 'source_persist_failed' : 'context_changed',
                message: sourceContextCurrent
                    ? 'The current color table could not be persisted, so the scope was not changed.'
                    : 'The active chat or card changed before the scope switch completed.',
                previousScope,
                previousKey,
                rollbackPersisted,
            };
        }

        // Source persistence is a preflight boundary. Preserve edits made while
        // it was in flight before mutating the destination/runtime scope.
        const latestSourceColors = normalizeCharacterColors(characterColors);
        const latestSourceGroupProfiles = normalizeGroupProfiles(groupProfiles);
        setStoredColorData(previousKey, latestSourceColors, { ...settings, colorStorageScope: previousScope }, {
            debounce: false,
            groupProfiles: latestSourceGroupProfiles,
        });
        transaction = captureStorageTransaction(binding);
        appliedRecord = transaction.record;
        appliedRuntime = captureStorageRuntimeState();

        const target = findColorDataForScope(scope, targetKey);
        const targetExisted = target.exists;
        let destinationWritten = false;
        let nextColors = target.entry?.colors || {};
        let nextGroupProfiles = target.entry?.groupProfiles || {};

        if (strategy === 'copy' || strategy === 'replace') {
            nextColors = latestSourceColors;
            nextGroupProfiles = latestSourceGroupProfiles;
            destinationWritten = true;
        } else if (strategy === 'merge') {
            nextColors = normalizeCharacterColors({ ...(target.entry?.colors || {}), ...latestSourceColors });
            nextGroupProfiles = normalizeGroupProfiles({ ...(target.entry?.groupProfiles || {}), ...latestSourceGroupProfiles });
            destinationWritten = true;
        } else if (strategy === 'empty') {
            nextColors = {};
            nextGroupProfiles = {};
            destinationWritten = true;
        }

        if (destinationWritten) {
            setStoredColorData(targetKey, nextColors, { ...settings, colorStorageScope: scope }, {
                debounce: false,
                groupProfiles: nextGroupProfiles,
            });
        }

        const colorSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        settings.colorStorageScope = scope;
        saveGlobalSettingsSnapshot({ debounce: false });
        const loadResult = loadData({ persistPrevious: false });
        invalidateThemeCache();
        syncAllEffectiveColors();
        applyLiveColorChangesFromSnapshot(
            colorSnapshot,
            [...new Set([...Object.keys(colorSnapshot), ...Object.keys(characterColors)])],
            { saveImmediately: true },
        );
        syncUIWithSettings();
        updateCharList();
        injectPrompt();

        const expected = prepareExpectedModuleRecord();
        appliedRecord = expected;
        appliedRuntime = captureStorageRuntimeState();
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = areScopeStorageKeysCurrent(scopeKeyBindings)
            && isRuntimeContextCurrent(binding.context)
            && activeStorageScope === scope
            && activeStorageKey === targetKey;
        if (!persisted || !contextCurrent) {
            const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            const rollbackPersisted = await rollbackStorageTransaction(
                transaction,
                expected,
                appliedRuntime,
                failedSnapshot,
                contextCurrent,
            );
            return {
                ok: false,
                persisted: false,
                error: contextCurrent ? 'destination_persist_failed' : 'context_changed',
                message: contextCurrent
                    ? rollbackPersisted
                        ? 'The new storage scope could not be saved. The previous scope has been restored.'
                        : 'The scope change and its recovery could not be saved reliably. Export your colors before reloading.'
                    : 'The active chat or card changed before the scope switch completed. The scope change was rolled back.',
                previousScope,
                previousKey,
                rollbackPersisted,
            };
        }
        const descriptor = getStorageScopeDescriptor(scope);
        return {
            ok: true,
            persisted,
            strategy,
            previousScope,
            previousKey,
            scope,
            key: targetKey,
            targetExisted,
            destinationWritten,
            loaded: loadResult.loaded,
            characterCount: descriptor.characterCount,
            descriptor,
            message: descriptor.exists
                ? `${descriptor.label} is active with ${descriptor.characterCount} character${descriptor.characterCount === 1 ? '' : 's'}.`
                : `${descriptor.label} is active with an empty color table.`,
            refresh: { characterState: true, history: true, theme: true, ui: true, prompt: true, render: true, fonts: true },
            rollbackTransaction: transaction,
        };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to switch color storage scope:', error);
        const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        const contextCurrent = isRuntimeContextCurrent(binding.context)
            && areScopeStorageKeysCurrent(scopeKeyBindings);
        const rollbackPersisted = await rollbackStorageTransaction(
            transaction,
            appliedRecord,
            appliedRuntime,
            failedSnapshot,
            contextCurrent,
        );
        return {
            ok: false,
            error: contextCurrent ? 'scope_apply_failed' : 'context_changed',
            message: rollbackPersisted
                ? 'The storage scope could not be changed. The previous state was restored.'
                : 'The scope change and its recovery could not be saved reliably. Export your colors before reloading.',
            previousScope,
            previousKey,
            rollbackPersisted,
        };
    }
}

function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function getStylePackRegistryKey(pack, digest) {
    const id = String(pack?.metadata?.id || pack?.metadata?.name || 'unnamed').trim() || 'unnamed';
    const version = String(pack?.metadata?.version || '1').trim() || '1';
    return `${id}@${version}/${digest}`;
}

function getStylePackItemMappings(plan) {
    const itemMappings = Object.create(null);
    for (const category of ['palettes', 'gradientPresets', 'assignmentPresets']) {
        const mappings = Object.create(null);
        for (const operation of plan.operations || []) {
            if (operation.category !== category || operation.action === 'keep') continue;
            mappings[operation.sourceName] = operation.targetName;
        }
        if (Object.keys(mappings).length) itemMappings[category] = mappings;
    }
    return itemMappings;
}

function applyStylePackAppearance(appearance) {
    for (const key of AESTHETIC_APPEARANCE_KEYS) {
        if (!hasOwn(appearance, key)) continue;
        if (key === 'narratorColor') {
            setNarratorStyle(settings, {
                ...normalizeNarratorStyle(settings.narratorStyle, { legacy: settings }),
                baseColor: appearance.narratorColor,
            }, applyThemeReadabilityAndBrightness);
        } else {
            settings[key] = cloneJsonValue(appearance[key]);
        }
    }
}

function mergeCharacterRegistriesKeepingCurrent(incoming, current) {
    const merged = normalizeCharacterColors(incoming);
    const normalizedCurrent = normalizeCharacterColors(current);
    for (const [key, entry] of Object.entries(normalizedCurrent)) merged[key] = entry;
    return merged;
}

function mergeGroupProfileRegistriesKeepingCurrent(incoming, current) {
    const merged = normalizeGroupProfiles(incoming);
    const normalizedCurrent = normalizeGroupProfiles(current);
    for (const [key, profile] of Object.entries(normalizedCurrent)) merged[key] = profile;
    return merged;
}

function getStylePackAssignmentApplyPlan(pack, options) {
    const selected = isPlainObject(options?.selected) ? options.selected : {};
    return buildStylePackInstallationPlan(pack, {}, {
        selected: {
            palettes: [],
            gradientPresets: [],
            assignmentPresets: selected.assignmentPresets,
        },
        includeAssignmentPresets: true,
        includeAppearance: false,
    });
}

function collectStylePackAssignments(pack, plan) {
    const presetNames = (plan.operations || [])
        .filter(operation => operation.category === 'assignmentPresets')
        .map(operation => operation.sourceName);
    return flattenStylePackAssignmentPresets(pack.assignmentPresets || Object.create(null), presetNames).assignments;
}

function getStylePackCatalogFingerprint(record) {
    const normalized = buildAutoSyncRecord(record || {});
    return JSON.stringify(sortJsonForComparison({
        customPalettes: normalized.customPalettes,
        customPaletteMeta: normalized.customPaletteMeta,
        customGradientPresets: normalized.customGradientPresets,
        presets: normalized.presets,
    }));
}

function snapshotStylePackSelection(value) {
    if (value instanceof Set) return [...value];
    if (Array.isArray(value)) return [...value];
    return value === undefined ? undefined : cloneJsonValue(value);
}

function snapshotStylePackApplyOptions(options = {}) {
    const selected = isPlainObject(options?.selected) ? options.selected : {};
    return {
        applyAssignments: options?.applyAssignments === true,
        applyAppearance: options?.applyAppearance === true,
        installAssignmentPresets: options?.installAssignmentPresets === true,
        includeAssignmentPresets: options?.includeAssignmentPresets === true,
        assignmentApplyMode: options?.assignmentApplyMode === 'replace' ? 'replace' : 'merge',
        conflictStrategy: options?.conflictStrategy,
        selected: {
            palettes: snapshotStylePackSelection(selected.palettes),
            gradientPresets: snapshotStylePackSelection(selected.gradientPresets),
            assignmentPresets: snapshotStylePackSelection(selected.assignmentPresets),
        },
        categoryStrategies: cloneJsonValue(options?.categoryStrategies),
        decisions: cloneJsonValue(options?.decisions),
        resolutions: cloneJsonValue(options?.resolutions),
    };
}

function applyStylePackAssignments(assignments, mode) {
    const incoming = Object.create(null);
    assignments.forEach((entry, index) => {
        incoming[index] = entry;
    });
    const incomingColors = normalizeImportedColorsForApply(incoming, COLOR_SCHEMA_VERSION);
    if (!Object.keys(incomingColors).length && mode !== 'replace') return false;
    setCharacterColors(mode === 'replace'
        ? incomingColors
        : mergeCharacterRegistriesKeepingCurrent(incomingColors, characterColors));
    if (mode === 'replace') {
        selectedCharacterKeys.clear();
        setExpandedCharacterRows(new Set());
        setSwapMode(null);
        restoreProtectedPinsAfterReplace();
    }
    clearSpeakerRegexCache();
    setLastProcessedMessageSignature('');
    return true;
}

export function getStylePackRegistry() {
    const record = extension_settings?.[MODULE_NAME];
    assertSupportedSchemaVersion(record, { moduleRecord: true });
    return normalizeStylePackRegistry(record?.stylePackRegistry);
}

/** Analyze only local JSON and current library names. This never persists or binds a chat scope. */
export async function analyzeStylePackImport(source) {
    const analysis = await analyzeStylePackEnvelopeSource(source, { includeAssignmentPresets: true });
    if (!analysis.ok) return analysis;
    const unsupported = unsupportedSchemaVersionResult(extension_settings?.[MODULE_NAME], { moduleRecord: true });
    if (unsupported) return unsupported;
    const current = buildAutoSyncRecord(extension_settings?.[MODULE_NAME] || {});
    const conflicts = analyzeStylePackConflicts(analysis.pack, current, { includeAssignmentPresets: true });
    return {
        ...analysis,
        conflicts,
        catalogFingerprint: getStylePackCatalogFingerprint(current),
        registryKey: getStylePackRegistryKey(analysis.pack, analysis.digest),
    };
}

function getStylePackPlanOptions(pack, options, includeAssignmentPresets) {
    const selected = isPlainObject(options?.selected) ? options.selected : {};
    const categoryStrategies = isPlainObject(options?.categoryStrategies) ? options.categoryStrategies : {};
    const decisions = isPlainObject(options?.decisions) ? cloneJsonValue(options.decisions) : {};
    for (const category of ['palettes', 'gradientPresets', 'assignmentPresets']) {
        const strategy = categoryStrategies[category];
        if (!['keep', 'rename', 'replace'].includes(strategy)) continue;
        if (!isPlainObject(decisions[category])) decisions[category] = {};
        for (const name of Object.keys(pack?.[category] || {})) {
            if (decisions[category][name] === undefined) decisions[category][name] = strategy;
        }
    }
    return {
        selected: {
            palettes: selected.palettes,
            gradientPresets: selected.gradientPresets,
            assignmentPresets: includeAssignmentPresets ? selected.assignmentPresets : [],
        },
        includeAssignmentPresets: includeAssignmentPresets || options?.applyAssignments === true,
        includeAppearance: options?.applyAppearance === true,
        conflictStrategy: options?.conflictStrategy || 'keep',
        decisions,
        resolutions: options?.resolutions,
    };
}

async function rollbackStylePackImport({ transaction, baseRecord, appliedRecord, appliedRuntime, needsScope, contextCurrent }) {
    if (!needsScope) return rollbackModuleRecord(baseRecord, appliedRecord || baseRecord);
    const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    return rollbackStorageTransaction(
        transaction,
        appliedRecord,
        appliedRuntime,
        failedSnapshot,
        contextCurrent,
    );
}

/**
 * Apply a reviewed pack in one verified module-record transaction. Library-only
 * installs do not touch the active color scope; applying appearance or entries does.
 */
export async function applyStylePackImport(reviewed, options = {}) {
    if (!reviewed?.ok || !reviewed?.pack || typeof reviewed.digest !== 'string') {
        return importError('invalid_reviewed_pack', 'Choose a style pack and review it before installing.');
    }

    const optionSnapshot = snapshotStylePackApplyOptions(options);
    const applyAssignments = optionSnapshot.applyAssignments;
    const applyAppearance = optionSnapshot.applyAppearance;
    const installAssignments = optionSnapshot.installAssignmentPresets
        || optionSnapshot.includeAssignmentPresets;
    const needsScope = applyAssignments || applyAppearance;
    const binding = needsScope ? captureActiveStorageBinding() : null;
    const reviewedDigest = reviewed.digest;
    const reviewedCatalogFingerprint = reviewed.catalogFingerprint;
    const reviewedAssignmentOrder = cloneJsonValue(reviewed.conflicts?.categories?.assignmentPresets?.presetOrder);
    let normalized;
    let digest;
    try {
        normalized = normalizeStylePackEnvelope(reviewed.pack, { includeAssignmentPresets: true });
        digest = await digestStylePackEnvelope(normalized.pack, { includeAssignmentPresets: true });
    } catch (error) {
        return importError('invalid_reviewed_pack', 'The reviewed style pack is no longer valid.');
    }
    if (digest !== reviewedDigest) {
        return importError('digest_mismatch', 'The style pack changed after review. Analyze it again before installing.');
    }
    if (typeof reviewedCatalogFingerprint !== 'string' || !reviewedCatalogFingerprint) {
        return importError('invalid_reviewed_pack', 'The style-pack catalog review is incomplete. Analyze it again before installing.');
    }

    if (optionSnapshot.applyAssignments) {
        let selectedOrder;
        try {
            selectedOrder = flattenStylePackAssignmentPresets(
                normalized.pack.assignmentPresets || Object.create(null),
                optionSnapshot.selected.assignmentPresets,
            ).presetNames;
        } catch {
            return importError('selection_changed', 'The assignment preset selection changed after review. Analyze the pack again.');
        }
        if (!Array.isArray(reviewedAssignmentOrder) || !jsonValuesEqual(selectedOrder, reviewedAssignmentOrder)) {
            return importError('selection_changed', 'The assignment preset order changed after review. Analyze the pack again.');
        }
    }

    return runStorageOperation(() => applyStylePackImportInternal(
        normalized,
        digest,
        optionSnapshot,
        {
            applyAssignments,
            applyAppearance,
            installAssignments,
            needsScope,
            binding,
            reviewedCatalogFingerprint,
        },
    ));
}

async function applyStylePackImportInternal(normalized, digest, options, mode) {
    const { applyAssignments, applyAppearance, installAssignments, needsScope, binding, reviewedCatalogFingerprint } = mode;
    const baseRecord = getModuleRecordSnapshot();
    const transaction = needsScope ? captureStorageTransaction(binding) : null;
    let appliedRecord = baseRecord;
    let appliedRuntime = needsScope ? captureStorageRuntimeState() : null;
    let mutationStarted = false;

    try {
        if (needsScope && !isActiveStorageBindingCurrent(binding)) {
            return contextChangedError('The active style-pack target changed after review.');
        }
        if (needsScope && binding.scope === 'chat') {
            const metadataSafety = await ensureChatScopeMetadataSafety();
            if (!isActiveStorageBindingCurrent(binding)) {
                return contextChangedError('The active style-pack target changed after review.');
            }
            if (!metadataSafety.safe) {
                return importError('chat_metadata_persist_failed', 'The per-chat identifier could not be saved safely.');
            }
        }

        const record = getAutoSyncRecord(true);
        if (getStylePackCatalogFingerprint(record) !== reviewedCatalogFingerprint) {
            return importError('stale_review', 'The installed style library changed after review. Analyze the style pack again.');
        }
        const plan = buildStylePackInstallationPlan(
            normalized.pack,
            record,
            getStylePackPlanOptions(normalized.pack, options, installAssignments),
        );
        const assignmentsToApply = applyAssignments
            ? collectStylePackAssignments(
                normalized.pack,
                getStylePackAssignmentApplyPlan(normalized.pack, options),
            )
            : [];
        const paletteOperations = plan.operations.filter(operation => operation.category === 'palettes' && operation.action !== 'keep');
        const gradientOperations = plan.operations.filter(operation => operation.category === 'gradientPresets' && operation.action !== 'keep');
        const assignmentOperations = plan.operations.filter(operation => operation.category === 'assignmentPresets' && operation.action !== 'keep');
        const hasLibraryChanges = paletteOperations.length || gradientOperations.length || assignmentOperations.length;
        if (!hasLibraryChanges && !applyAssignments && !applyAppearance) {
            return {
                ok: true,
                digest,
                registryKey: getStylePackRegistryKey(normalized.pack, digest),
                summary: plan.summary,
                installed: 0,
                unchanged: true,
            };
        }

        mutationStarted = true;
        if (paletteOperations.length) {
            record.customPalettes = normalizeCustomPaletteRegistry({ ...record.customPalettes, ...plan.install.palettes });
            record.customPaletteMeta = isPlainObject(record.customPaletteMeta) ? { ...record.customPaletteMeta } : {};
            for (const operation of paletteOperations) {
                const metadata = normalized.paletteMetadata[operation.sourceName];
                if (metadata) record.customPaletteMeta[operation.targetName] = metadata;
                else delete record.customPaletteMeta[operation.targetName];
            }
        }
        if (gradientOperations.length) {
            record.customGradientPresets = normalizeGradientPresetRegistry({ ...record.customGradientPresets, ...plan.install.gradientPresets });
        }
        if (assignmentOperations.length) {
            record.presets = normalizeStoredColorPresets({ ...record.presets, ...plan.install.assignmentPresets });
        }

        const registryKey = getStylePackRegistryKey(normalized.pack, digest);
        const registry = normalizeStylePackRegistry(record.stylePackRegistry);
        registry[registryKey] = {
            installedAt: new Date().toISOString(),
            itemMappings: getStylePackItemMappings(plan),
        };
        record.stylePackRegistry = registry;
        persistModuleStore(record, { debounce: false });

        let changedRuntime = false;
        if (needsScope) {
            if (!isActiveStorageBindingCurrent(binding)) {
                const rollbackPersisted = await rollbackStylePackImport({
                    transaction,
                    baseRecord,
                    appliedRecord,
                    appliedRuntime,
                    needsScope,
                    contextCurrent: false,
                });
                return { ...contextChangedError(), rollbackPersisted };
            }
            const colorSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            if (applyAppearance && plan.install.appearance) {
                applyStylePackAppearance(plan.install.appearance);
                changedRuntime = true;
            }
            if (applyAssignments) {
                changedRuntime = applyStylePackAssignments(
                    assignmentsToApply,
                    options.assignmentApplyMode === 'replace' ? 'replace' : 'merge',
                ) || changedRuntime;
            }
            if (changedRuntime) {
                normalizeToggleSettings();
                invalidateThemeCache();
                syncAllEffectiveColors();
                applyLiveColorChangesFromSnapshot(
                    colorSnapshot,
                    [...new Set([...Object.keys(colorSnapshot), ...Object.keys(characterColors)])],
                    { saveImmediately: true },
                );
                commit({ history: false });
            }
        }

        refreshGradientPresetControls();
        syncUIWithSettings();
        if (changedRuntime) updateCharList();
        const expected = prepareExpectedModuleRecord();
        appliedRecord = expected;
        appliedRuntime = needsScope ? captureStorageRuntimeState() : null;
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = !needsScope || isActiveStorageBindingCurrent(binding);
        if (!persisted || !contextCurrent) {
            const rollbackPersisted = await rollbackStylePackImport({
                transaction,
                baseRecord,
                appliedRecord,
                appliedRuntime,
                needsScope,
                contextCurrent,
            });
            return {
                ...importError(
                    contextCurrent ? 'style_pack_persist_failed' : 'context_changed',
                    contextCurrent
                        ? rollbackPersisted
                            ? 'The style pack could not be saved. The previous library was restored.'
                            : 'The style-pack install and recovery could not be saved reliably. Export your library before reloading.'
                        : 'The active chat or card changed before the style pack completed. The install was rolled back.',
                ),
                rollbackPersisted,
            };
        }

        if (changedRuntime) {
            setColorHistory([createHistorySnapshot()]);
            setHistoryIndex(0);
        }
        return {
            ok: true,
            digest,
            registryKey,
            summary: plan.summary,
            installed: paletteOperations.length + gradientOperations.length + assignmentOperations.length,
            appliedAppearance: applyAppearance && !!normalized.pack.appearance,
            appliedAssignments: applyAssignments,
            assignmentPresetsInstalled: assignmentOperations.length,
        };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to apply style pack:', error);
        const contextCurrent = !needsScope || isActiveStorageBindingCurrent(binding);
        const rollbackPersisted = mutationStarted
            ? await rollbackStylePackImport({
                transaction,
                baseRecord,
                appliedRecord,
                appliedRuntime,
                needsScope,
                contextCurrent,
            })
            : true;
        return {
            ...importError(
                error instanceof StylePackError ? error.code : 'style_pack_apply_failed',
                error instanceof StylePackError
                    ? error.message
                    : rollbackPersisted
                    ? 'The style pack could not be applied. The previous library was restored.'
                    : 'The style-pack install and recovery could not be saved reliably. Export your library before reloading.',
            ),
            rollbackPersisted,
        };
    }
}

function importError(error, message) {
    return { ok: false, error, message };
}

function analyzeImportPayloadSafely(analyze) {
    try {
        return analyze();
    } catch (error) {
        return importError(error?.code || 'invalid_payload', error?.message || 'The import payload is malformed.');
    }
}

async function parseImportSource(source) {
    const decoded = await analyzeJsonSource(source, ORDINARY_IMPORT_LIMITS);
    return decoded.ok ? { ok: true, value: decoded.value } : decoded;
}

function normalizeImportSettings(source, keys) {
    const normalized = normalizeStoredSettings(source);
    delete normalized.allowRemoteFonts;
    if (!hasOwn(source, 'colorStorageScope') && !hasOwn(source, 'shareColorsGlobally')) delete normalized.colorStorageScope;
    for (const key of Object.keys(normalized)) {
        if (!keys.includes(key)) delete normalized[key];
    }
    return normalized;
}

function getRemoteFontImportDisclosure(source, inherited = null) {
    if (isPlainObject(inherited) && inherited.preserved === true) {
        return { present: true, requested: inherited.requested === true, preserved: true };
    }
    if (!isPlainObject(source) || !hasOwn(source, 'allowRemoteFonts')) {
        return { present: false, requested: false, preserved: false };
    }
    return { present: true, requested: source.allowRemoteFonts === true, preserved: true };
}

function getExplicitImportScope(source) {
    if (!hasOwn(source, 'colorStorageScope')) {
        if (hasOwn(source, 'shareColorsGlobally')) {
            return { ok: true, requestedStorageScope: source.shareColorsGlobally === true ? 'global' : 'card' };
        }
        return { ok: true };
    }
    if (!COLOR_STORAGE_SCOPES.includes(source.colorStorageScope)) {
        return importError('invalid_storage_scope', `Unknown color storage scope: ${String(source.colorStorageScope)}`);
    }
    return { ok: true, requestedStorageScope: source.colorStorageScope };
}

function migrateLegacyColorPayload(source, { allowUnversioned = false } = {}) {
    const version = Number(source?.settings?.colorSchemaVersion ?? source?.version);
    if ((!Number.isFinite(version) && !allowUnversioned) || version >= COLOR_SCHEMA_VERSION) {
        return { source, migration: null };
    }
    const migration = createStorageIdentityMigration();
    const groups = migrateLegacyGroupProfileRegistry(source.groupProfiles, migration, 'groupProfiles');
    const migrated = {
        ...source,
        colors: normalizeCharacterColors(migrateLegacyCharacterRegistry(
            source.colors,
            groups.nameMappings,
            migration,
            'colors',
        )),
    };
    if (hasOwn(source, 'groupProfiles')) migrated.groupProfiles = groups.profiles;
    if (hasOwn(source, 'customGradientPresets')) {
        migrated.customGradientPresets = migrateLegacyNamedCatalog(
            source.customGradientPresets,
            80,
            'Legacy gradient',
            migration,
            'customGradientPresets',
        ).registry;
    }
    return { source: migrated, migration };
}

function migrateLegacySettingsPayload(source) {
    const version = Number(source?.settings?.colorSchemaVersion ?? source?.version);
    if (!Number.isFinite(version) || version >= COLOR_SCHEMA_VERSION || !hasOwn(source, 'customGradientPresets')) {
        return { source, migration: null };
    }
    const migration = createStorageIdentityMigration();
    const gradients = migrateLegacyNamedCatalog(
        source.customGradientPresets,
        80,
        'Legacy gradient',
        migration,
        'customGradientPresets',
    );
    return { source: { ...source, customGradientPresets: gradients.registry }, migration };
}

function buildImportPreview(colors, profiles, importedSettings, customGradientPresets, requestedStorageScope, options = {}) {
    const preview = {
        characterCount: Object.keys(colors || {}).length,
        groupProfileCount: Object.keys(profiles || {}).length,
        settingsPresent: importedSettings !== null,
        settingsCount: Object.keys(importedSettings || {}).length,
        customGradientPresetCount: Object.keys(customGradientPresets || {}).length,
        customPaletteCount: Object.keys(options.customPalettes || {}).length,
    };
    if (requestedStorageScope !== undefined) preview.requestedStorageScope = requestedStorageScope;
    if (options.remoteFontSettingPresent) {
        preview.remoteFontConsentPreserved = true;
        preview.remoteFontsRequested = options.remoteFontsRequested === true;
    }
    if (options.identityMigration?.renamed) {
        preview.legacyIdentityMigration = {
            renamed: options.identityMigration.renamed,
            collisions: options.identityMigration.collisions,
        };
    }
    return preview;
}

function validateImportedCatalogIdentities(source, maximum, label) {
    const identities = new Map();
    for (const rawName of Object.keys(source || {})) {
        if (isDangerousRegistryIdentity(rawName)) {
            return importError('reserved_identity', `Reserved ${label} name "${rawName}" is not allowed.`);
        }
        const identity = normalizeRegistryIdentity(rawName, maximum);
        if (!identity) return importError('invalid_identity', `${label} name "${rawName}" is invalid.`);
        const existing = identities.get(identity);
        if (existing !== undefined) {
            return importError('identity_collision', `${label} names "${existing}" and "${rawName}" normalize to the same identity.`);
        }
        identities.set(identity, rawName);
    }
    return null;
}

function analyzeImportedPalettes(source) {
    const palettesPresent = hasOwn(source, 'customPalettes');
    const metadataPresent = hasOwn(source, 'customPaletteMeta');
    if (palettesPresent && !isPlainObject(source.customPalettes)) {
        return importError('invalid_custom_palettes', 'The payload has invalid custom palette data.');
    }
    if (metadataPresent && !isPlainObject(source.customPaletteMeta)) {
        return importError('invalid_custom_palette_metadata', 'The payload has invalid custom palette metadata.');
    }
    if (!palettesPresent) return { ok: true, palettesPresent: false, customPalettes: null, customPaletteMeta: null };
    if (Object.keys(source.customPalettes).length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxCustomPalettes) {
        return importError('too_many_custom_palettes', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxCustomPalettes} custom palettes.`);
    }
    const catalogError = validateImportedCatalogIdentities(source.customPalettes, 120, 'Custom palette');
    if (catalogError) return catalogError;
    for (const [name, colors] of Object.entries(source.customPalettes)) {
        if (!Array.isArray(colors) || !colors.length) {
            return importError('invalid_custom_palette', `Custom palette "${name}" must contain colors.`);
        }
    }
    const customPalettes = normalizeCustomPaletteRegistry(source.customPalettes);
    if (Object.keys(customPalettes).length !== Object.keys(source.customPalettes).length) {
        return importError('invalid_custom_palette', 'One or more custom palettes contain no valid colors.');
    }
    const metadata = normalizeNameDictionary(source.customPaletteMeta);
    const paletteIdentities = new Set(Object.keys(customPalettes).map(name => normalizeRegistryIdentity(name, 120)));
    const customPaletteMeta = Object.fromEntries(Object.entries(metadata)
        .filter(([name]) => paletteIdentities.has(normalizeRegistryIdentity(name, 120))));
    return { ok: true, palettesPresent, customPalettes, customPaletteMeta };
}

function bindImportedCustomPalette(settingsSnapshot, incomingPalettes) {
    const theme = settingsSnapshot?.colorTheme;
    if (typeof theme !== 'string' || !theme.toLowerCase().startsWith('custom:')) return null;
    const requestedName = normalizeRegistryIdentityName(theme.slice(7), 120);
    const identity = normalizeRegistryIdentity(requestedName, 120);
    const current = buildAutoSyncRecord(extension_settings?.[MODULE_NAME] || {}).customPalettes;
    const paletteName = [...Object.keys(current), ...Object.keys(incomingPalettes || {})]
        .find(name => normalizeRegistryIdentity(name, 120) === identity);
    if (!paletteName) {
        return importError('missing_custom_palette', `Custom palette "${requestedName}" is not included or installed.`);
    }
    settingsSnapshot.colorTheme = `custom:${paletteName}`;
    return null;
}

function validateImportedCollectionLimits(colors, profiles) {
    const colorEntries = Object.entries(colors || {});
    if (colorEntries.length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxCharacters) {
        return importError('too_many_characters', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxCharacters} characters.`);
    }
    let aliasCount = 0;
    for (const [rawKey, entry] of colorEntries) {
        if (!isPlainObject(entry)) return importError('invalid_character', `Character entry "${rawKey}" is not a JSON object.`);
        if (hasOwn(entry, 'aliases') && !Array.isArray(entry.aliases)) {
            return importError('invalid_aliases', `Aliases for "${rawKey}" must be an array.`);
        }
        const aliases = entry.aliases || [];
        if (aliases.length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxAliasesPerCharacter) {
            return importError('too_many_aliases', `Character "${rawKey}" exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxAliasesPerCharacter} aliases.`);
        }
        aliasCount += aliases.length;
        if (aliasCount > ORDINARY_IMPORT_OUTPUT_LIMITS.maxAliasesTotal) {
            return importError('too_many_aliases', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxAliasesTotal} aliases.`);
        }
    }
    if (Object.keys(profiles || {}).length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxGroupProfiles) {
        return importError('too_many_group_profiles', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxGroupProfiles} group profiles.`);
    }
    return null;
}

function validateImportedIdentities(colors, profiles) {
    const colorEntries = Object.entries(colors || {});
    if (colorEntries.length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxCharacters) {
        return importError('too_many_characters', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxCharacters} characters.`);
    }
    let aliasCount = 0;
    const characterIdentities = new Map();
    for (const [rawKey, entry] of colorEntries) {
        if (!isPlainObject(entry)) return importError('invalid_character', `Character entry "${rawKey}" is not a JSON object.`);
        const name = hasOwn(entry, 'name') ? entry.name : rawKey;
        if (isDangerousRegistryIdentity(name) || isReservedCharacterIdentity(name)) {
            return importError('reserved_identity', `Reserved registry identity "${name}" is not allowed.`);
        }
        const identity = normalizeRegistryIdentity(name);
        if (!identity) {
            return importError('invalid_identity', `Character entry "${rawKey}" has an invalid name.`);
        }
        const existingCharacter = characterIdentities.get(identity);
        if (existingCharacter !== undefined) {
            return importError('identity_collision', `Characters "${existingCharacter}" and "${name}" normalize to the same identity.`);
        }
        characterIdentities.set(identity, name);
        if (hasOwn(entry, 'aliases') && !Array.isArray(entry.aliases)) {
            return importError('invalid_aliases', `Aliases for "${name}" must be an array.`);
        }
        const aliases = entry.aliases || [];
        if (aliases.length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxAliasesPerCharacter) {
            return importError('too_many_aliases', `Character "${name}" exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxAliasesPerCharacter} aliases.`);
        }
        aliasCount += aliases.length;
        if (aliasCount > ORDINARY_IMPORT_OUTPUT_LIMITS.maxAliasesTotal) {
            return importError('too_many_aliases', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxAliasesTotal} aliases.`);
        }
        for (const alias of aliases) {
            if (isDangerousRegistryIdentity(alias) || isReservedCharacterIdentity(alias)) {
                return importError('reserved_identity', `Reserved registry identity "${alias}" is not allowed.`);
            }
            if (!normalizeRegistryIdentity(alias)) {
                return importError('invalid_identity', `Character "${name}" contains an invalid alias.`);
            }
        }
    }

    const ownership = resolveCanonicalAliasOwners(colorEntries.map(([rawKey, entry]) => ({
        name: hasOwn(entry, 'name') ? entry.name : rawKey,
        aliases: entry.aliases || [],
    })));
    const ambiguity = ownership.conflicts.find(conflict => conflict.kind === 'alias-ambiguity');
    if (ambiguity) {
        return importError('identity_collision', `Alias identity "${ambiguity.identity}" belongs to more than one character.`);
    }
    colorEntries.forEach(([, entry], index) => { entry.aliases = ownership.aliases[index]; });

    const profileEntries = Object.entries(profiles || {});
    if (profileEntries.length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxGroupProfiles) {
        return importError('too_many_group_profiles', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxGroupProfiles} group profiles.`);
    }
    const groupIdentities = new Map();
    for (const [rawKey, profile] of profileEntries) {
        if (!isPlainObject(profile)) return importError('invalid_group_profile', `Group profile "${rawKey}" is not a JSON object.`);
        const name = hasOwn(profile, 'name') ? profile.name : rawKey;
        if (isDangerousRegistryIdentity(name)) {
            return importError('reserved_identity', `Reserved registry identity "${name}" is not allowed.`);
        }
        const identity = normalizeRegistryIdentity(name, 80);
        if (!identity || !normalizeGroupProfile(profile, rawKey)) {
            return importError('invalid_group_profile', `Group profile "${rawKey}" has an invalid name or style.`);
        }
        const existingGroup = groupIdentities.get(identity);
        if (existingGroup !== undefined) {
            return importError('identity_collision', `Group profiles "${existingGroup}" and "${name}" normalize to the same identity.`);
        }
        groupIdentities.set(identity, name);
    }
    return null;
}

function analyzeColorPayload(source, kind = 'colors') {
    const unsupported = unsupportedSchemaVersionResult(source);
    if (unsupported) return unsupported;
    if (!isPlainObject(source) || !hasOwn(source, 'colors') || !isPlainObject(source.colors)) {
        return importError('unrecognized_payload', 'The source does not contain a recognized color payload.');
    }
    if (hasOwn(source, 'settings') && !isPlainObject(source.settings)) {
        return importError('invalid_settings', 'The color payload has invalid settings data.');
    }
    if (hasOwn(source, 'customGradientPresets') && !isPlainObject(source.customGradientPresets)) {
        return importError('invalid_gradient_presets', 'The color payload has invalid custom gradient presets.');
    }
    if (hasOwn(source, 'groupProfiles') && !isPlainObject(source.groupProfiles)) {
        return importError('invalid_group_profiles', 'The color payload has invalid group profile data.');
    }
    const paletteAnalysis = analyzeImportedPalettes(source);
    if (!paletteAnalysis.ok) return paletteAnalysis;
    const collectionLimitError = validateImportedCollectionLimits(source.colors, source.groupProfiles);
    if (collectionLimitError) return collectionLimitError;
    const legacyPayload = migrateLegacyColorPayload(source, { allowUnversioned: kind === 'card' });
    source = legacyPayload.source;
    const identityError = validateImportedIdentities(source.colors, source.groupProfiles);
    if (identityError) return identityError;

    const settingsPresent = hasOwn(source, 'settings');
    const remoteFontConsent = getRemoteFontImportDisclosure(source.settings, source.remoteFontConsent);
    const importedSettings = settingsPresent ? normalizeImportSettings(source.settings, PORTABLE_SETTING_KEYS) : null;
    const paletteReferenceError = bindImportedCustomPalette(importedSettings, paletteAnalysis.customPalettes);
    if (paletteReferenceError) return paletteReferenceError;
    const scopeResult = getExplicitImportScope(source.settings);
    if (!scopeResult.ok) return scopeResult;
    const presetsPresent = hasOwn(source, 'customGradientPresets');
    if (presetsPresent && Object.keys(source.customGradientPresets).length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxGradientPresets) {
        return importError('too_many_gradient_presets', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxGradientPresets} custom gradient presets.`);
    }
    if (presetsPresent) {
        const catalogError = validateImportedCatalogIdentities(source.customGradientPresets, 80, 'Gradient preset');
        if (catalogError) return catalogError;
    }
    const customGradientPresets = presetsPresent ? normalizeGradientPresetRegistry(source.customGradientPresets) : null;
    const colors = normalizeCharacterColors(source.colors);
    const profilesPresent = hasOwn(source, 'groupProfiles');
    const profiles = profilesPresent ? normalizeGroupProfiles(source.groupProfiles) : null;
    const declaredVersion = Number(source.settings?.colorSchemaVersion ?? source.version);
    const payload = {
        kind,
        version: Number.isFinite(declaredVersion) ? Math.max(0, Math.trunc(declaredVersion)) : 0,
        colors,
        ...(profilesPresent ? { groupProfiles: profiles } : {}),
        ...(settingsPresent ? { settings: importedSettings } : {}),
        ...(remoteFontConsent.present ? { remoteFontConsent } : {}),
        ...(presetsPresent ? { customGradientPresets } : {}),
        ...(paletteAnalysis.palettesPresent ? {
            customPalettes: paletteAnalysis.customPalettes,
            customPaletteMeta: paletteAnalysis.customPaletteMeta,
        } : {}),
        ...(scopeResult.requestedStorageScope !== undefined
            ? { requestedStorageScope: scopeResult.requestedStorageScope }
            : {}),
    };
    return {
        ok: true,
        kind,
        payload,
        preview: buildImportPreview(colors, profiles, importedSettings, customGradientPresets, scopeResult.requestedStorageScope, {
            remoteFontSettingPresent: remoteFontConsent.present,
            remoteFontsRequested: remoteFontConsent.requested,
            identityMigration: legacyPayload.migration,
            customPalettes: paletteAnalysis.customPalettes,
        }),
    };
}

function analyzeSettingsPayload(source) {
    const unsupported = unsupportedSchemaVersionResult(source);
    if (unsupported) return unsupported;
    if (!isPlainObject(source) || !hasOwn(source, 'settings') || !isPlainObject(source.settings)) {
        return importError('unrecognized_payload', 'The source does not contain a recognized settings payload.');
    }
    if (hasOwn(source, 'customGradientPresets') && !isPlainObject(source.customGradientPresets)) {
        return importError('invalid_gradient_presets', 'The settings payload has invalid custom gradient presets.');
    }
    const paletteAnalysis = analyzeImportedPalettes(source);
    if (!paletteAnalysis.ok) return paletteAnalysis;
    const legacyPayload = migrateLegacySettingsPayload(source);
    source = legacyPayload.source;

    const remoteFontConsent = getRemoteFontImportDisclosure(source.settings, source.remoteFontConsent);
    const importedSettings = normalizeImportSettings(source.settings, PORTABLE_SETTING_KEYS);
    const paletteReferenceError = bindImportedCustomPalette(importedSettings, paletteAnalysis.customPalettes);
    if (paletteReferenceError) return paletteReferenceError;
    const scopeResult = getExplicitImportScope(source.settings);
    if (!scopeResult.ok) return scopeResult;
    const presetsPresent = hasOwn(source, 'customGradientPresets');
    if (presetsPresent && Object.keys(source.customGradientPresets).length > ORDINARY_IMPORT_OUTPUT_LIMITS.maxGradientPresets) {
        return importError('too_many_gradient_presets', `The import exceeds ${ORDINARY_IMPORT_OUTPUT_LIMITS.maxGradientPresets} custom gradient presets.`);
    }
    if (presetsPresent) {
        const catalogError = validateImportedCatalogIdentities(source.customGradientPresets, 80, 'Gradient preset');
        if (catalogError) return catalogError;
    }
    const customGradientPresets = presetsPresent ? normalizeGradientPresetRegistry(source.customGradientPresets) : null;
    if (!Object.keys(importedSettings).length && !Object.keys(customGradientPresets || {}).length
        && !Object.keys(paletteAnalysis.customPalettes || {}).length) {
        return importError('unrecognized_payload', 'The source contains no recognized settings, palettes, or gradient presets.');
    }

    const declaredVersion = Number(source.settings?.colorSchemaVersion ?? source.version);
    const payload = {
        kind: 'settings',
        version: Number.isFinite(declaredVersion) ? Math.max(0, Math.trunc(declaredVersion)) : 0,
        settings: importedSettings,
        ...(remoteFontConsent.present ? { remoteFontConsent } : {}),
        ...(presetsPresent ? { customGradientPresets } : {}),
        ...(paletteAnalysis.palettesPresent ? {
            customPalettes: paletteAnalysis.customPalettes,
            customPaletteMeta: paletteAnalysis.customPaletteMeta,
        } : {}),
        ...(scopeResult.requestedStorageScope !== undefined
            ? { requestedStorageScope: scopeResult.requestedStorageScope }
            : {}),
    };
    return {
        ok: true,
        kind: 'settings',
        payload,
        preview: buildImportPreview({}, {}, importedSettings, customGradientPresets, scopeResult.requestedStorageScope, {
            remoteFontSettingPresent: remoteFontConsent.present,
            remoteFontsRequested: remoteFontConsent.requested,
            identityMigration: legacyPayload.migration,
            customPalettes: paletteAnalysis.customPalettes,
        }),
    };
}

function getImportSourceFingerprint(payload) {
    const normalized = { ...(isPlainObject(payload) ? payload : {}) };
    delete normalized.reviewedContext;
    return JSON.stringify(sortJsonForComparison(normalized));
}

function getImportDestinationFingerprint(scope, key, { runtime = false } = {}) {
    const record = getAutoSyncRecord(true);
    const located = runtime ? null : findColorDataForScope(scope, key);
    const table = runtime ? {
        colors: normalizeCharacterColors(characterColors),
        groupProfiles: normalizeGroupProfiles(groupProfiles),
        settings: buildSettingsSubsetFromSource({ ...settings, colorStorageScope: scope }, PORTABLE_SETTING_KEYS),
    } : located?.entry;
    return JSON.stringify(sortJsonForComparison({
        scope,
        key,
        table: table || null,
        sourceKey: runtime ? key : located?.sourceKey || key,
        globalSettings: buildSettingsSubsetFromSource({ ...settings, colorStorageScope: scope }, PORTABLE_SETTING_KEYS),
        customGradientPresets: normalizeGradientPresetRegistry(record.customGradientPresets),
        customPalettes: normalizeCustomPaletteRegistry(record.customPalettes),
        customPaletteMeta: normalizeNameDictionary(record.customPaletteMeta),
        pinnedCharacters: cloneJsonValue(record.ui?.pinnedCharacters?.[getChatOwnerStorageComponent()] || null),
        personaColors: cloneJsonValue(record.ui?.personaColors || null),
    }));
}

function getReviewedImportDestination(reviewedContext, scope, key) {
    return Array.isArray(reviewedContext?.destinations)
        ? reviewedContext.destinations.find(destination => destination?.scope === scope && destination?.key === key)
        : null;
}

function importDestinationMatches(destination) {
    return isPlainObject(destination)
        && typeof destination.fingerprint === 'string'
        && destination.fingerprint === getImportDestinationFingerprint(destination.scope, destination.key, {
            runtime: destination.runtime === true,
        });
}

function attachImportReviewContext(analysis, binding = captureActiveStorageBinding()) {
    if (!analysis?.ok || !isPlainObject(analysis.payload)) return analysis;
    const destinations = [{
        scope: binding.scope,
        key: binding.key,
        runtime: true,
        fingerprint: getImportDestinationFingerprint(binding.scope, binding.key, { runtime: true }),
    }];
    const requestedScope = analysis.payload.requestedStorageScope;
    if (requestedScope && requestedScope !== binding.scope) {
        const key = getStorageKeyForScope(requestedScope, { persistMetadata: false });
        destinations.push({
            scope: requestedScope,
            key,
            runtime: false,
            fingerprint: getImportDestinationFingerprint(requestedScope, key),
        });
    }
    analysis.payload.reviewedContext = {
        scope: binding.scope,
        key: binding.key,
        cardKey: getStorageKeyForScope('card'),
        context: binding.context,
        sourceFingerprint: getImportSourceFingerprint(analysis.payload),
        destinations,
    };
    return analysis;
}

export async function analyzeColorImport(source) {
    const binding = captureActiveStorageBinding();
    const parsed = await parseImportSource(source);
    if (!isActiveStorageBindingCurrent(binding)) return contextChangedError('The active import target changed while the file was read.');
    return parsed.ok
        ? attachImportReviewContext(analyzeImportPayloadSafely(() => analyzeColorPayload(parsed.value)), binding)
        : parsed;
}

export async function analyzeSettingsImport(source) {
    const binding = captureActiveStorageBinding();
    const parsed = await parseImportSource(source);
    if (!isActiveStorageBindingCurrent(binding)) return contextChangedError('The active import target changed while the file was read.');
    return parsed.ok
        ? attachImportReviewContext(analyzeImportPayloadSafely(() => analyzeSettingsPayload(parsed.value)), binding)
        : parsed;
}

function analyzeCardValue(source, binding, { allowUnboundRuntime = false } = {}) {
    let value;
    try {
        value = inspectJsonValue(source, ORDINARY_IMPORT_LIMITS).value;
    } catch (error) {
        return importError(error?.code || 'invalid_payload', error?.message || 'The card data is malformed.');
    }
    if (!(allowUnboundRuntime ? isRuntimeContextCurrent(binding.context) : isActiveStorageBindingCurrent(binding))) {
        return contextChangedError('The active import target changed while the card data was read.');
    }
    return attachImportReviewContext(analyzeImportPayloadSafely(() => analyzeColorPayload(value, 'card')), binding);
}

export function analyzeCardData(source, options = {}) {
    const binding = captureActiveStorageBinding();
    if (isPlainObject(source) || Array.isArray(source)) return analyzeCardValue(source, binding, options);
    return parseImportSource(source).then(parsed => {
        if (!isActiveStorageBindingCurrent(binding)) return contextChangedError('The active import target changed while the card data was read.');
        return parsed.ok
            ? attachImportReviewContext(analyzeImportPayloadSafely(() => analyzeColorPayload(parsed.value, 'card')), binding)
            : parsed;
    });
}

export async function readCardData({ refresh = true } = {}) {
    const binding = captureActiveStorageBinding();
    if (refresh) {
        try {
            await getCharacters?.();
        } catch {
            return importError('card_read_failed', 'The character card could not be reloaded.');
        }
    }
    if (!isActiveStorageBindingCurrent(binding)) {
        return contextChangedError('The active character changed while the card was reloaded.');
    }
    try {
        const context = getContext();
        const characterId = context?.characterId;
        if (characterId === undefined || characterId === null) {
            return importError('no_character', 'No character is loaded.');
        }
        const data = context?.characters?.[characterId]?.data?.extensions?.dialogueColors;
        if (!data) return importError('no_card_data', 'The character card has no saved color data.');
        return await analyzeCardData(data);
    } catch {
        return importError('card_read_failed', 'The character card data could not be read.');
    }
}

function normalizeReviewedPayload(payload, kind) {
    if (!isPlainObject(payload) || payload.kind !== kind) {
        return importError('invalid_reviewed_payload', `Expected a reviewed ${kind} payload.`);
    }
    const source = cloneJsonValue(payload);
    delete source.reviewedContext;
    return analyzeImportPayloadSafely(() => kind === 'settings'
        ? analyzeSettingsPayload(source)
        : analyzeColorPayload(source, kind));
}

function applyImportedSettings(importedSettings, activeScope) {
    for (const [key, value] of Object.entries(importedSettings || {})) {
        if (key === 'colorStorageScope' || key === 'colorSchemaVersion' || key === 'allowRemoteFonts') continue;
        settings[key] = value;
    }
    settings.colorStorageScope = activeScope;
}

function normalizeImportedColorsForApply(colors, colorSchemaVersion) {
    const parsedVersion = Number(colorSchemaVersion);
    if (Number.isFinite(parsedVersion) && parsedVersion > COLOR_SCHEMA_VERSION) {
        assertSupportedSchemaVersion({ version: parsedVersion });
    }
    const normalized = normalizeCharacterColors(colors);
    if (!Number.isFinite(parsedVersion) || parsedVersion < 4) {
        for (const entry of Object.values(normalized)) {
            const effectiveColor = normalizeHexColor(entry.color, null);
            if (effectiveColor) entry.baseColor = deriveBaseColorFromEffectiveColor(effectiveColor);
        }
    }
    return normalized;
}

function applyImportedGradientPresets(payload) {
    if (!hasOwn(payload, 'customGradientPresets')) return false;
    const incoming = normalizeGradientPresetRegistry(payload.customGradientPresets);
    const current = getCustomGradientPresets();
    const currentIdentities = new Set(Object.keys(current).map(name => normalizeRegistryIdentity(name, 80)));
    const nextPresets = Object.fromEntries(Object.entries(incoming)
        .filter(([name]) => !currentIdentities.has(normalizeRegistryIdentity(name, 80))));
    Object.assign(nextPresets, current);
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.customGradientPresets = nextPresets;
    persistModuleStore(record, { debounce: false });
    return true;
}

function applyImportedPalettes(payload) {
    if (!hasOwn(payload, 'customPalettes')) return false;
    const incoming = normalizeCustomPaletteRegistry(payload.customPalettes);
    const record = getAutoSyncRecord(true);
    const current = normalizeCustomPaletteRegistry(record.customPalettes);
    const currentIdentities = new Set(Object.keys(current).map(name => normalizeRegistryIdentity(name, 120)));
    const accepted = Object.fromEntries(Object.entries(incoming)
        .filter(([name]) => !currentIdentities.has(normalizeRegistryIdentity(name, 120))));
    const nextPalettes = { ...accepted, ...current };
    const currentMeta = normalizeNameDictionary(record.customPaletteMeta);
    const incomingMeta = normalizeNameDictionary(payload.customPaletteMeta);
    const acceptedIdentities = new Set(Object.keys(accepted).map(name => normalizeRegistryIdentity(name, 120)));
    const nextMeta = {
        ...Object.fromEntries(Object.entries(incomingMeta)
            .filter(([name]) => acceptedIdentities.has(normalizeRegistryIdentity(name, 120)))),
        ...currentMeta,
    };
    if (jsonValuesEqual(nextPalettes, current) && jsonValuesEqual(nextMeta, currentMeta)) return false;
    record.version = COLOR_SCHEMA_VERSION;
    record.customPalettes = nextPalettes;
    record.customPaletteMeta = nextMeta;
    persistModuleStore(record, { debounce: false });
    return true;
}

function importReviewContextMatches(reviewedContext) {
    if (!isPlainObject(reviewedContext)
        || typeof reviewedContext.sourceFingerprint !== 'string'
        || !Array.isArray(reviewedContext.destinations)) return false;
    const binding = captureActiveStorageBinding();
    if (reviewedContext.scope !== binding.scope || reviewedContext.key !== binding.key) return false;
    if (reviewedContext.context && !isRuntimeContextCurrent(reviewedContext.context)) return false;
    return !reviewedContext.cardKey || reviewedContext.cardKey === getStorageKeyForScope('card');
}

async function applyReviewedImport(payload, kind, options = {}) {
    const { mode, applyScope = false } = options || {};
    if (!['merge', 'replace'].includes(mode)) {
        return importError('invalid_mode', 'Import mode must be either merge or replace.');
    }
    const reviewedContext = cloneJsonValue(payload?.reviewedContext);
    const reviewed = normalizeReviewedPayload(payload, kind);
    if (!reviewed.ok) return reviewed;
    if (!isPlainObject(reviewedContext) || getImportSourceFingerprint(reviewed.payload) !== reviewedContext.sourceFingerprint) {
        return contextChangedError('The normalized import source changed after review.');
    }
    const operationBinding = captureActiveStorageBinding();
    const requestedScopeIncluded = hasOwn(reviewed.payload, 'requestedStorageScope');
    const requestedTargetKey = applyScope === true && requestedScopeIncluded
        ? getStorageKeyForScope(reviewed.payload.requestedStorageScope)
        : null;
    const destinationScope = requestedTargetKey ? reviewed.payload.requestedStorageScope : operationBinding.scope;
    const destinationKey = requestedTargetKey || operationBinding.key;
    const reviewedDestination = getReviewedImportDestination(reviewedContext, destinationScope, destinationKey);
    if (!reviewedDestination) {
        return importError('invalid_reviewed_payload', 'The import destination review is incomplete. Analyze the source again.');
    }
    return runStorageOperation(() => applyReviewedImportInternal(
        reviewed,
        reviewedContext,
        kind,
        { mode, applyScope },
        operationBinding,
        requestedTargetKey,
        reviewedDestination,
    ));
}

async function applyReviewedImportInternal(
    reviewed,
    reviewedContext,
    kind,
    options,
    operationBinding,
    requestedTargetKey,
    reviewedDestination,
) {
    const { mode, applyScope } = options;
    const normalized = reviewed.payload;
    const requestedScopeIncluded = hasOwn(normalized, 'requestedStorageScope');
    const contextBindings = { [operationBinding.scope]: operationBinding.contextKey };
    if (applyScope === true && requestedScopeIncluded) {
        contextBindings[normalized.requestedStorageScope] = requestedTargetKey;
    }
    let transaction = null;
    let importBinding = operationBinding;
    let mutationStarted = false;
    let appliedRecord = null;
    let appliedRuntime = null;
    const previousEnabled = settings.enabled;

    try {
        if (!isActiveStorageBindingCurrent(operationBinding) || !importReviewContextMatches(reviewedContext)
            || getImportSourceFingerprint(normalized) !== reviewedContext.sourceFingerprint
            || !importDestinationMatches(reviewedDestination)) {
            return contextChangedError('The active import target changed after review.');
        }
        transaction = captureStorageTransaction(operationBinding);
        appliedRecord = transaction.record;
        appliedRuntime = captureStorageRuntimeState();
        if (applyScope === true && requestedScopeIncluded && normalized.requestedStorageScope !== getCurrentStorageScope()) {
            mutationStarted = true;
            const switchResult = await switchColorStorageScopeInternal(
                normalized.requestedStorageScope,
                'switch',
                operationBinding,
                requestedTargetKey,
            );
            if (!switchResult.ok) return switchResult;
            transaction = switchResult.rollbackTransaction || transaction;
            appliedRecord = getModuleRecordSnapshot();
            appliedRuntime = captureStorageRuntimeState();
        }
        if (!isRuntimeContextCurrent(operationBinding.context) || !areScopeStorageKeysCurrent(contextBindings)) {
            const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            const rollbackPersisted = mutationStarted
                ? await rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, false)
                : true;
            return { ...contextChangedError(), rollbackPersisted };
        }

        const activeScope = getCurrentStorageScope();
        importBinding = captureActiveStorageBinding();
        if (activeScope === 'chat') {
            appliedRecord = mutationStarted ? getModuleRecordSnapshot() : appliedRecord;
            const metadataSafety = await ensureChatScopeMetadataSafety();
            if (!isActiveStorageBindingCurrent(importBinding) || !areScopeStorageKeysCurrent(contextBindings)) {
                const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
                const rollbackPersisted = mutationStarted
                    ? await rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, false)
                    : true;
                return { ...contextChangedError(), rollbackPersisted };
            }
            if (!metadataSafety.safe) {
                const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
                const rollbackPersisted = mutationStarted
                    ? await rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, true)
                    : true;
                return {
                    ...importError('chat_metadata_persist_failed', 'The per-chat identifier could not be saved safely.'),
                    rollbackPersisted,
                };
            }
        }

        if (!mutationStarted) {
            transaction = captureStorageTransaction(importBinding);
            appliedRecord = transaction.record;
            appliedRuntime = captureStorageRuntimeState();
        }

        if (getImportSourceFingerprint(normalized) !== reviewedContext.sourceFingerprint
            || !importDestinationMatches(reviewedDestination)) {
            const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            const rollbackPersisted = mutationStarted
                ? await rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, false)
                : true;
            return { ...contextChangedError('The normalized import source or destination changed after review.'), rollbackPersisted };
        }

        const colorSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        mutationStarted = true;
        applyImportedPalettes(normalized);
        applyImportedSettings(normalized.settings, activeScope);
        normalizeToggleSettings();
        invalidateThemeCache();

        const hasColors = kind !== 'settings';
        if (hasColors) {
            const incomingColors = normalizeImportedColorsForApply(normalized.colors, normalized.settings?.colorSchemaVersion);
            setCharacterColors(mode === 'merge'
                ? mergeCharacterRegistriesKeepingCurrent(incomingColors, characterColors)
                : incomingColors);
            const incomingProfiles = normalizeGroupProfiles(normalized.groupProfiles);
            setGroupProfiles(mode === 'merge'
                ? mergeGroupProfileRegistriesKeepingCurrent(incomingProfiles, groupProfiles)
                : incomingProfiles);
            if (mode === 'replace') {
                selectedCharacterKeys.clear();
                setExpandedCharacterRows(new Set());
                setSwapMode(null);
                restoreProtectedPinsAfterReplace();
            }
            clearSpeakerRegexCache();
            setLastProcessedMessageSignature('');
        }

        settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
        migrateColorSchemaIfNeeded();
        syncAllEffectiveColors();
        const renderKeys = [...new Set([...Object.keys(colorSnapshot), ...Object.keys(characterColors)])];
        applyLiveColorChangesFromSnapshot(colorSnapshot, renderKeys, { saveImmediately: true });
        const gradientPresetsChanged = applyImportedGradientPresets(normalized);
        commit({ history: false });
        if (gradientPresetsChanged) refreshGradientPresetControls();
        syncUIWithSettings();

        const expected = getModuleRecordSnapshot();
        appliedRecord = expected;
        appliedRuntime = captureStorageRuntimeState();
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = isActiveStorageBindingCurrent(importBinding)
            && areScopeStorageKeysCurrent(contextBindings);
        if (!persisted || !contextCurrent) {
            const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            const rollbackPersisted = await rollbackStorageTransaction(
                transaction,
                appliedRecord,
                appliedRuntime,
                failedSnapshot,
                contextCurrent,
            );
            return {
                ...importError(
                    contextCurrent ? 'import_persist_failed' : 'context_changed',
                    contextCurrent
                        ? rollbackPersisted
                            ? 'The imported data could not be saved. The previous data was restored.'
                            : 'The import and its recovery could not be saved reliably. Export your colors before reloading.'
                        : 'The active chat or card changed before the import completed. The import was rolled back.',
                ),
                rollbackPersisted,
            };
        }

        setColorHistory([createHistorySnapshot()]);
        setHistoryIndex(0);
        if (settings.enabled !== previousEnabled) synchronizeEnabledLifecycle();
        return {
            ok: true,
            kind,
            mode,
            scope: activeScope,
            scopeApplied: applyScope === true && requestedScopeIncluded,
            characterCount: Object.keys(characterColors).length,
            groupProfileCount: Object.keys(groupProfiles).length,
            settingsCount: reviewed.preview.settingsCount,
            customGradientPresetCount: reviewed.preview.customGradientPresetCount,
            remoteFontConsentPreserved: reviewed.preview.remoteFontConsentPreserved === true,
        };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to apply reviewed import data:', error);
        const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        const contextCurrent = isActiveStorageBindingCurrent(importBinding)
            && areScopeStorageKeysCurrent(contextBindings);
        const rollbackPersisted = mutationStarted
            ? await rollbackStorageTransaction(
                transaction,
                appliedRecord,
                appliedRuntime,
                failedSnapshot,
                contextCurrent,
            )
            : true;
        return {
            ...importError(
                'apply_failed',
                rollbackPersisted
                    ? 'The reviewed data could not be applied. The previous data was restored.'
                    : 'The import and its recovery could not be saved reliably. Export your colors before reloading.',
            ),
            rollbackPersisted,
        };
    }
}

export function applyColorImport(payload, options) {
    return applyReviewedImport(payload, 'colors', options);
}

export function applySettingsImport(payload, options) {
    return applyReviewedImport(payload, 'settings', options);
}

export function applyCardData(payload, options) {
    return applyReviewedImport(payload, 'card', options);
}

function buildPortablePaletteFields(settingsSnapshot) {
    const theme = settingsSnapshot.colorTheme;
    if (typeof theme !== 'string' || !theme.toLowerCase().startsWith('custom:')) return {};
    const identity = normalizeRegistryIdentity(theme.slice(7), 120);
    const record = getAutoSyncRecord(true);
    const palettes = normalizeCustomPaletteRegistry(record.customPalettes);
    const name = Object.keys(palettes).find(candidate => normalizeRegistryIdentity(candidate, 120) === identity);
    if (!name) {
        settingsSnapshot.colorTheme = 'pastel';
        return {};
    }
    settingsSnapshot.colorTheme = `custom:${name}`;
    const metadata = normalizeNameDictionary(record.customPaletteMeta);
    const metadataName = Object.keys(metadata).find(candidate => normalizeRegistryIdentity(candidate, 120) === identity);
    return {
        customPalettes: { [name]: palettes[name] },
        ...(metadataName ? { customPaletteMeta: { [name]: metadata[metadataName] } } : {}),
    };
}

function buildPortableDataPayload(source = {}) {
    const settingsSnapshot = buildPortableSettingsSnapshot();
    return {
        version: COLOR_SCHEMA_VERSION,
        ...source,
        settings: settingsSnapshot,
        ...buildPortablePaletteFields(settingsSnapshot),
    };
}

export function exportColors() {
    const colors = normalizeCharacterColors(characterColors);
    const profiles = normalizeGroupProfiles(groupProfiles);
    const customGradientPresets = getCustomGradientPresets();
    const blob = new Blob([JSON.stringify(buildPortableDataPayload({ colors, groupProfiles: profiles, customGradientPresets }), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dialogue-colors-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importColors(file) {
    const analysis = await analyzeColorImport(file);
    if (!analysis.ok) {
        toast.error(analysis.message || 'Invalid color file');
        return analysis;
    }
    const result = await applyColorImport(analysis.payload, { mode: 'merge', applyScope: false });
    if (result.ok) toast.success('Imported!');
    else toast.error(result.message || 'Could not import colors');
    return result;
}

export function exportSettings() {
    const exportObj = buildPortableDataPayload({
        timestamp: new Date().toISOString(),
        customGradientPresets: getCustomGradientPresets(),
    });
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dc-settings-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast.success('Settings exported!');
}

export async function importSettings(file) {
    const analysis = await analyzeSettingsImport(file);
    if (!analysis.ok) {
        toast.error(analysis.message || 'Invalid settings file');
        return analysis;
    }
    const result = await applySettingsImport(analysis.payload, { mode: 'merge', applyScope: false });
    if (result.ok) toast.success('Settings imported!');
    else toast.error(result.message || 'Could not import settings');
    return result;
}

export function applySettingsSnapshotWithRefresh(snapshot) {
    if (typeof snapshot?.allowRemoteFonts === 'boolean') {
        persistLocalRemoteFontConsent(snapshot.allowRemoteFonts);
    }
    const keys = Object.keys(characterColors);
    const colorSnapshot = captureEffectiveColorSnapshot(keys);
    pruneInactiveSettings();
    applyStoredSettingsSnapshot(snapshot);
    invalidateThemeCache();
    syncAllEffectiveColors();
    applyLiveColorChangesFromSnapshot(colorSnapshot, keys, { saveImmediately: true });
    saveData();
    saveGlobalSettingsSnapshot();
    syncUIWithSettings();
    updateCharList();
    injectPrompt();
}

// Auto-sync functions

export function restoreAllSettingsToDefaults() {
    const previousSettings = buildFullSettingsSnapshot();

    Object.entries(TOGGLE_SETTING_DEFAULTS).forEach(([key, defaultValue]) => {
        settings[key] = defaultValue;
    });

    settings.themeMode = 'auto';
    settings.colorTheme = 'pastel';
    settings.brightness = 0;
    settings.thoughtSymbols = '*';
    setNarratorStyle(settings, { enabled: false, baseColor: '#888888', gradient: null, gradientGenerator: null }, applyThemeReadabilityAndBrightness);
    settings.promptDepth = 1;
    settings.promptRole = 'system';
    settings.promptMode = 'inject';
    settings.sortMode = 'name';
    settings.coloringEngine = 'llm';
    settings.gradientRandomMasterSeed = '';
    settings.colorVisionPreviewMode = 'none';
    settings.colorVisionPreviewSeverity = 100;
    settings.colorVisionPreviewTarget = 'all';
    settings.gradientAnimationMode = 'auto';
    settings.llmConnectionProfile = null;
    settings.attributionConnectionProfile = null;
    settings.attributionReviewPolicy = 'review';
    settings.attributionMaxTokens = 4096;
    settings.attributionVerifyPasses = 1;
    settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;

    applySettingsSnapshotWithRefresh(settings);
    const defaultSettings = buildFullSettingsSnapshot();
    showUndoToast('All settings restored to defaults.', () => {
        applySettingsSnapshotWithRefresh(restoreAppliedObjectChanges(
            previousSettings,
            defaultSettings,
            buildFullSettingsSnapshot(),
        ));
        toast.success('Previous settings restored.');
    });
}

// Auto-sync functions
export async function loadSettingsFromServer() {
    flushPendingColorStateActivity();
    const request = autoSyncRequestGate.begin();
    const activityEpoch = moduleSettingsActivityEpoch;
    try {
        const record = await fetchAutoSyncRecordFromServer();
        if (!autoSyncRequestGate.isCurrent(request)) return { ok: false, superseded: true };
        if (!record) {
            clearAutoSyncError();
            return { ok: true, found: false };
        }
        const disposition = applyAutoSyncRecord(record, { serverVerified: true, request, activityEpoch });
        if (disposition === 'unsupported_schema_version') {
            return { ok: false, found: true, error: disposition, disposition };
        }
        return { ok: disposition !== 'conflict', found: true, disposition };
    } catch (e) {
        if (!autoSyncRequestGate.isCurrent(request)) return { ok: false, superseded: true };
        console.warn('[Dialogue Colors] Auto-sync settings refresh failed:', e);
        setAutoSyncError('Read failed');
        return { ok: false, error: 'read_failed' };
    }
}

function pollAutoSyncServer() {
    if (autoSyncPollPromise) return autoSyncPollPromise;
    const request = loadSettingsFromServer();
    autoSyncPollPromise = request;
    void request.finally(() => {
        if (autoSyncPollPromise === request) autoSyncPollPromise = null;
    });
    return request;
}

export function saveSettingsToStore(options = {}) {
    const { force = false, schedule = true } = options;
    const currentRecord = getAutoSyncRecord(true);
    const settingsData = buildSettingsSubset(PORTABLE_SETTING_KEYS);
    const settingsChanged = !areSettingsSubsetsEqual(currentRecord.settings, settingsData);
    const enabledChanged = currentRecord.autoSyncEnabled !== autoSyncEnabled;

    if (!force && (!autoSyncEnabled || (!settingsChanged && !enabledChanged))) return false;

    const nextRecord = buildAutoSyncRecord({
        ...currentRecord,
        version: COLOR_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        writerId: AUTO_SYNC_WRITER_ID,
        sequence: getNextLocalAutoSyncSequence(currentRecord),
        autoSyncEnabled,
        settings: settingsData,
        // Both halves come from the same live settings, so writing them together keeps the
        // record self-consistent. Publishing only the payload left globalSettings -- the half a
        // reload restores from -- empty or stale, which is how a chosen storage scope came back
        // as Per card on the next load.
        globalSettings: buildPortableSettingsSnapshot(),
    });

    persistModuleStore(nextRecord, { debounce: false });
    markAutoSyncPending(nextRecord);
    if (schedule) queueImmediateSettingsSave();
    cleanupLegacyAutoSyncPreference();
    return true;
}

export function enableAutoSync() {
    setAutoSyncEnabled(true);
    startAutoSyncPolling();
    saveSettingsToStore({ force: true });
    toast.success('Auto-sync enabled! Settings will sync across devices.');
}

export function disableAutoSync() {
    setAutoSyncEnabled(false);
    stopAutoSyncPolling();
    saveSettingsToStore({ force: true });
    toast.info('Auto-sync disabled');
}

export function startAutoSyncPolling() {
    if (autoSyncInterval) return;
    const pollInterval = document.hidden ? 30000 : 5000;
    setAutoSyncInterval(setInterval(() => {
        void pollAutoSyncServer();
    }, pollInterval));
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

export function stopAutoSyncPolling() {
    autoSyncRequestGate.supersede();
    autoSyncPollPromise = null;
    deferredAutoSyncApplication = null;
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        setAutoSyncInterval(null);
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
}

export function handleVisibilityChange() {
    if (autoSyncEnabled) {
        stopAutoSyncPolling();
        startAutoSyncPolling();
        void pollAutoSyncServer();
    }
}

export function updateAutoSyncUI() {
    const setupBtn = document.getElementById('dc-setup-autosync');
    const disableBtn = document.getElementById('dc-disable-autosync');
    const status = document.getElementById('dc-autosync-status');
    if (!setupBtn || !disableBtn || !status) return;

    if (autoSyncEnabled) {
        setupBtn.style.display = 'none';
        disableBtn.style.display = 'block';
    } else {
        setupBtn.style.display = 'block';
        disableBtn.style.display = 'none';
    }

    if (autoSyncStatusError) {
        status.textContent = autoSyncStatusError;
        status.style.color = 'var(--SmartThemeErrorColor, #ff6b6b)';
    } else if (autoSyncPendingRecord) {
        status.textContent = 'Saving...';
        status.style.color = 'var(--SmartThemeQuoteColor)';
    } else if (autoSyncEnabled) {
        status.textContent = '✓ Active';
        status.style.color = 'var(--SmartThemeQuoteColor)';
    } else {
        status.textContent = '';
        status.style.color = '';
    }
}

// Phase 7: Removed debug console.log statements

export function initAutoSync() {
    const unsupported = unsupportedSchemaVersionResult(extension_settings?.[MODULE_NAME], { moduleRecord: true });
    if (unsupported) {
        setAutoSyncError('Stored schema is newer than this extension');
        return unsupported;
    }
    const hadLegacyPreference = getLegacyLocalStorageValue(LEGACY_AUTO_SYNC_ENABLED_KEY) !== null;
    const record = getAutoSyncRecord(true);
    applyStoredSettingsSnapshot(readStoredGlobalSettings(record), { includeColorSchemaVersion: false });
    applyAutoSyncRecord(record, { force: true });
    cleanupLegacyAutoSyncPreference();

    if (autoSyncEnabled && (hadLegacyPreference || !record.timestamp || !hasAutoSyncSettingsPayload(record))) {
        saveSettingsToStore({ force: true });
    }

    if (autoSyncEnabled) {
        startAutoSyncPolling();
        void pollAutoSyncServer();
    }
}

// Phase 7: Removed debug console.log statements
export function ensureRegexScript() {
    try {
        let changed = false;
        if (!extension_settings || typeof extension_settings !== 'object') return;
        if (!Array.isArray(extension_settings.regex)) extension_settings.regex = [];

        const isLegacyOwnedFontRule = rule => ((rule?.id === LEGACY_FONT_TRIM_RULE_ID
            && rule.scriptName === FONT_TRIM_RULE.scriptName
            && rule.findRegex === FONT_TRIM_RULE.findRegex)
            || (rule?.scriptName === 'Trim Font Colors' && rule.findRegex === '/<\\/?font[^>]*>/gi'))
            && rule.replaceString === ''
            && Array.isArray(rule.trimStrings) && rule.trimStrings.length === 0
            && Array.isArray(rule.placement) && rule.placement.length === 1 && rule.placement[0] === 2
            && rule.disabled === false
            && rule.markdownOnly === false
            && rule.promptOnly === true
            && rule.runOnEdit === true
            && rule.substituteRegex === 0
            && rule.minDepth === null
            && rule.maxDepth === null;
        const stableOwnedFontRule = extension_settings.regex.find(rule => rule?.id === FONT_TRIM_RULE.id);
        const legacyOwnedFontRule = extension_settings.regex.find(isLegacyOwnedFontRule);
        const hasUnownedTargetName = extension_settings.regex.some(rule => rule !== stableOwnedFontRule
            && rule !== legacyOwnedFontRule
            && rule?.scriptName === FONT_TRIM_RULE.scriptName);
        const ownedFontRule = stableOwnedFontRule || (!hasUnownedTargetName ? legacyOwnedFontRule : null);
        if (ownedFontRule) {
            for (const [key, value] of Object.entries(FONT_TRIM_RULE)) {
                const nextValue = Array.isArray(value) ? [...value] : value;
                if (JSON.stringify(ownedFontRule[key]) === JSON.stringify(nextValue)) continue;
                ownedFontRule[key] = nextValue;
                changed = true;
            }
        } else if (!hasUnownedTargetName) {
            extension_settings.regex.push({
                ...FONT_TRIM_RULE,
                trimStrings: [],
                placement: [2],
            });
            changed = true;
        }

        const isLegacyOwnedColorBlockRule = rule => rule?.scriptName === 'Trim Color Blocks'
            && rule.findRegex === COLOR_BLOCK_TRIM_RULE.findRegex
            && rule.replaceString === ''
            && Array.isArray(rule.trimStrings) && rule.trimStrings.length === 0
            && Array.isArray(rule.placement) && rule.placement.length === 1 && rule.placement[0] === 2
            && rule.disabled === false
            && rule.markdownOnly === true
            && rule.promptOnly === true
            && rule.runOnEdit === true
            && rule.substituteRegex === 0
            && rule.minDepth === null
            && rule.maxDepth === null;
        const stableOwnedColorBlockRule = extension_settings.regex.find(rule => rule?.id === COLOR_BLOCK_TRIM_RULE.id);
        const legacyOwnedColorBlockRule = extension_settings.regex.find(isLegacyOwnedColorBlockRule);
        const hasUnownedColorBlockTargetName = extension_settings.regex.some(rule => rule !== stableOwnedColorBlockRule
            && rule !== legacyOwnedColorBlockRule
            && rule?.scriptName === COLOR_BLOCK_TRIM_RULE.scriptName);
        const ownedColorBlockRule = stableOwnedColorBlockRule
            || (!hasUnownedColorBlockTargetName ? legacyOwnedColorBlockRule : null);
        if (ownedColorBlockRule) {
            for (const [key, value] of Object.entries(COLOR_BLOCK_TRIM_RULE)) {
                const nextValue = Array.isArray(value) ? [...value] : value;
                if (JSON.stringify(ownedColorBlockRule[key]) === JSON.stringify(nextValue)) continue;
                ownedColorBlockRule[key] = nextValue;
                changed = true;
            }
        } else if (!hasUnownedColorBlockTargetName) {
            extension_settings.regex.push({
                ...COLOR_BLOCK_TRIM_RULE,
                trimStrings: [],
                placement: [2],
            });
            changed = true;
        }

        const isLegacyOwnedCssRule = rule => rule?.scriptName === 'Trim CSS Effects (Prompt)'
            && rule.findRegex === CSS_EFFECTS_TRIM_RULE.findRegex
            && rule.replaceString === CSS_EFFECTS_TRIM_RULE.replaceString
            && Array.isArray(rule.trimStrings) && rule.trimStrings.length === 0
            && Array.isArray(rule.placement) && rule.placement.length === 1 && rule.placement[0] === 2
            && rule.disabled === false
            && rule.markdownOnly === false
            && rule.promptOnly === true
            && rule.runOnEdit === true
            && rule.substituteRegex === 0
            && rule.minDepth === null
            && rule.maxDepth === null;
        const stableOwnedCssRule = extension_settings.regex.find(rule => rule?.id === CSS_EFFECTS_TRIM_RULE.id);
        const legacyOwnedCssRule = extension_settings.regex.find(isLegacyOwnedCssRule);
        const hasUnownedCssTargetName = extension_settings.regex.some(rule => rule !== stableOwnedCssRule
            && rule !== legacyOwnedCssRule
            && rule?.scriptName === CSS_EFFECTS_TRIM_RULE.scriptName);
        const ownedCssRule = stableOwnedCssRule || (!hasUnownedCssTargetName ? legacyOwnedCssRule : null);
        if (ownedCssRule) {
            for (const [key, value] of Object.entries(CSS_EFFECTS_TRIM_RULE)) {
                const nextValue = Array.isArray(value) ? [...value] : value;
                if (JSON.stringify(ownedCssRule[key]) === JSON.stringify(nextValue)) continue;
                ownedCssRule[key] = nextValue;
                changed = true;
            }
        } else if (!hasUnownedCssTargetName) {
            extension_settings.regex.push({
                ...CSS_EFFECTS_TRIM_RULE,
                trimStrings: [],
                placement: [2],
            });
            changed = true;
        }
        if (changed) queueImmediateSettingsSave();
    } catch (e) {
        console.error('[Dialogue Colors] Failed to import regex scripts:', e);
    }
}

function buildReviewedCardPayload(payload) {
    return {
        version: COLOR_SCHEMA_VERSION,
        colors: cloneJsonValue(payload.colors),
        groupProfiles: cloneJsonValue(payload.groupProfiles || {}),
        settings: cloneJsonValue(payload.settings || {}),
        ...(hasOwn(payload, 'customGradientPresets')
            ? { customGradientPresets: cloneJsonValue(payload.customGradientPresets) }
            : {}),
        ...(hasOwn(payload, 'customPalettes') ? {
            customPalettes: cloneJsonValue(payload.customPalettes),
            customPaletteMeta: cloneJsonValue(payload.customPaletteMeta || {}),
        } : {}),
    };
}

function getCardByCapturedIdentity(context, cardIdentity, avatar) {
    const characters = Array.isArray(context?.characters) ? context.characters : [];
    return characters.find(character => (avatar && character?.avatar === avatar)
        || String(character?.characterId ?? '') === String(cardIdentity ?? '')) || null;
}

export async function saveToCard() {
    const binding = captureActiveStorageBinding();
    const context = getContext();
    const characterId = context?.characterId;
    const character = context?.characters?.[characterId];
    if (!character) {
        toast.error('No character loaded');
        return importError('no_character', 'No character is loaded.');
    }
    const cardIdentity = getCardIdentity(context);
    const avatar = character.avatar;
    const prospective = buildPortableDataPayload({
        colors: normalizeCharacterColors(characterColors),
        groupProfiles: normalizeGroupProfiles(groupProfiles),
    });
    const prospectiveFingerprint = JSON.stringify(sortJsonForComparison(prospective));
    const pendingAnalysis = analyzeCardData(prospective);
    const analysis = pendingAnalysis && typeof pendingAnalysis.then === 'function'
        ? await pendingAnalysis
        : pendingAnalysis;
    if (!analysis?.ok) {
        toast.error(analysis?.message || 'The card data is too large or invalid.');
        return analysis || importError('card_analysis_failed', 'The card data could not be analyzed.');
    }

    const currentContext = getContext();
    const currentCharacter = currentContext?.characters?.[currentContext?.characterId];
    if (!isActiveStorageBindingCurrent(binding)
        || getCardIdentity(currentContext) !== cardIdentity
        || currentContext?.characterId !== characterId
        || currentCharacter !== character
        || JSON.stringify(sortJsonForComparison(buildPortableDataPayload({
            colors: normalizeCharacterColors(characterColors),
            groupProfiles: normalizeGroupProfiles(groupProfiles),
        }))) !== prospectiveFingerprint) {
        return contextChangedError('The active card or prospective card data changed before it could be saved.');
    }
    if (typeof currentContext.writeExtensionField !== 'function') {
        const result = importError('card_save_unavailable', 'This SillyTavern version has no immediate, awaitable character-card writer.');
        toast.error(result.message);
        return result;
    }

    const output = buildReviewedCardPayload(analysis.payload);
    try {
        const writeResult = await currentContext.writeExtensionField(characterId, 'dialogueColors', output);
        if (writeResult === false || typeof getCharacters !== 'function') {
            throw new Error('Character-card write was not confirmed.');
        }
        await getCharacters();
        const refreshed = getCardByCapturedIdentity(getContext(), cardIdentity, avatar);
        if (!refreshed || JSON.stringify(sortJsonForComparison(refreshed.data?.extensions?.dialogueColors ?? null))
            !== JSON.stringify(sortJsonForComparison(output))) {
            const result = importError('card_save_unverified', 'The character card did not retain the saved color data.');
            toast.error(result.message);
            return result;
        }
        toast.success('Saved to card.');
        return { ok: true, cardIdentity, characterCount: Object.keys(output.colors).length };
    } catch (error) {
        console.warn('[Dialogue Colors] Failed to save character-card color data:', error);
        const result = importError('card_save_failed', 'The character card could not be saved and verified.');
        toast.error(result.message);
        return result;
    }
}

export async function loadFromCard() {
    const analysis = await readCardData();
    if (!analysis.ok) {
        if (analysis.error === 'no_card_data') toast.info('No saved colors in card');
        else toast.error(analysis.message || 'Failed to load from card');
        return analysis;
    }
    const result = await applyCardData(analysis.payload, { mode: 'merge', applyScope: false });
    if (result.ok) toast.success('Loaded from card');
    else toast.error(result.message || 'Failed to load from card');
    return result;
}

function applyAutomaticCardSeed(analysis, captured, { colorsOnly = true } = {}) {
    if (!analysis?.ok) {
        if (analysis?.error !== 'no_card_data') toast.error(analysis?.message || 'Saved colors on this character card could not be read.');
        return analysis;
    }
    const context = getContext();
    const character = context?.characters?.[context?.characterId];
    const destination = getReviewedImportDestination(
        analysis.payload.reviewedContext,
        captured.binding.scope,
        captured.binding.key,
    );
    const storageBindingCurrent = isActiveStorageBindingCurrent(captured.binding);
    if (!(storageBindingCurrent || (!captured.binding.aligned && isRuntimeContextCurrent(captured.binding.context)))
        || context?.characterId !== captured.characterId
        || character !== captured.character
        || getCardIdentity(context) !== captured.cardIdentity
        || character?.data?.extensions?.dialogueColors !== captured.data
        || getImportSourceFingerprint(analysis.payload) !== analysis.payload.reviewedContext?.sourceFingerprint
        || !importDestinationMatches(destination)) {
        return contextChangedError('The active card or color table changed while automatic card data was analyzed.');
    }

    try {
        const currentScope = getCurrentStorageScope();
        setCharacterColors(normalizeImportedColorsForApply(
            analysis.payload.colors,
            analysis.payload.settings?.colorSchemaVersion ?? analysis.payload.version,
        ));
        if (!colorsOnly) setGroupProfiles(normalizeGroupProfiles(analysis.payload.groupProfiles));
        selectedCharacterKeys.clear();
        setExpandedCharacterRows(new Set());
        setSwapMode(null);
        settings.colorStorageScope = currentScope;
        normalizeToggleSettings();
        settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
        restoreProtectedPinsAfterReplace();
        if (storageBindingCurrent) {
            saveHistory();
            saveData();
        }
        return { ok: true, kind: 'card', persisted: storageBindingCurrent, characterCount: Object.keys(characterColors).length };
    } catch (error) {
        console.warn('[Dialogue Colors] Card colors could not be applied; keeping the current registry.', error);
        toast.error('Saved colors on this character card could not be applied.');
        return importError(error?.code || 'card_apply_failed', error?.message || 'Saved card colors could not be applied.');
    }
}

export function tryLoadFromCard(options = {}) {
    const context = getContext();
    const characterId = context?.characterId;
    const character = context?.characters?.[characterId];
    const data = character?.data?.extensions?.dialogueColors;
    if (!data) return importError('no_card_data', 'The character card has no saved color data.');
    const captured = {
        binding: captureActiveStorageBinding(),
        characterId,
        character,
        cardIdentity: getCardIdentity(context),
        data,
    };
    const analysis = analyzeCardData(data, { allowUnboundRuntime: true });
    return analysis && typeof analysis.then === 'function'
        ? analysis.then(result => applyAutomaticCardSeed(result, captured, options))
        : applyAutomaticCardSeed(analysis, captured, options);
}
