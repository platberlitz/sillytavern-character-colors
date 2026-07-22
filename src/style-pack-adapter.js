// style-pack-adapter.js - bridges portable packs to the existing palette metadata map.

import {
    ImportCodecError,
    analyzeJsonSource,
    digestCanonicalJson,
    hardenJsonValue,
} from './import-codec.js';
import {
    StylePackError,
    buildStylePack,
    buildStylePackCatalog,
    normalizeStylePack,
} from './style-packs.js';

const PALETTE_META_FIELDS = Object.freeze(['source', 'notes', 'createdAt']);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function lookupName(value) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cleanText(value, maximum) {
    if (typeof value !== 'string') return '';
    return value
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum);
}

/** Only the metadata already used by custom palettes is portable. */
export function normalizePortablePaletteMetadata(value) {
    if (!isRecord(value)) return {};
    const metadata = {};
    const source = cleanText(value.source, 80);
    const notes = cleanText(value.notes, 500);
    const createdAt = Number(value.createdAt);
    if (source) metadata.source = source;
    if (notes) metadata.notes = notes;
    if (Number.isFinite(createdAt) && createdAt >= 0 && createdAt <= 8640000000000000) {
        metadata.createdAt = Math.floor(createdAt);
    }
    return metadata;
}

function extractPaletteMetadata(raw, normalizedPalettes) {
    const rawPalettes = isRecord(raw?.palettes) ? raw.palettes : {};
    const rawByName = new Map(Object.entries(rawPalettes).map(([name, value]) => [lookupName(name), value]));
    const paletteMetadata = {};
    const droppedFields = [];

    for (const name of Object.keys(normalizedPalettes || {})) {
        const rawPalette = rawByName.get(lookupName(name));
        if (!isRecord(rawPalette)) continue;
        for (const field of Object.keys(rawPalette)) {
            if (field !== 'colors' && field !== 'metadata') droppedFields.push(`palettes.${name}.${field}`);
        }
        if (rawPalette.metadata === undefined) continue;
        if (!isRecord(rawPalette.metadata)) {
            droppedFields.push(`palettes.${name}.metadata`);
            continue;
        }
        for (const field of Object.keys(rawPalette.metadata)) {
            if (!PALETTE_META_FIELDS.includes(field)) droppedFields.push(`palettes.${name}.metadata.${field}`);
        }
        const metadata = normalizePortablePaletteMetadata(rawPalette.metadata);
        if (Object.keys(metadata).length) paletteMetadata[name] = metadata;
    }
    return { paletteMetadata, droppedFields: [...new Set(droppedFields)].sort() };
}

/**
 * Normalize a pack with the strict core codec, then retain the bounded palette
 * metadata that the existing customPaletteMeta catalog already understands.
 */
export function normalizeStylePackEnvelope(input, options = {}) {
    const raw = hardenJsonValue(input);
    const core = normalizeStylePack(raw, { includeAssignmentPresets: options.includeAssignmentPresets === true });
    const { paletteMetadata, droppedFields } = extractPaletteMetadata(raw, core.palettes);
    const pack = { ...core };
    if (core.palettes) {
        pack.palettes = {};
        for (const [name, colors] of Object.entries(core.palettes)) {
            pack.palettes[name] = paletteMetadata[name]
                ? { colors, metadata: paletteMetadata[name] }
                : colors;
        }
    }
    return { pack, paletteMetadata, droppedFields };
}

export function buildStylePackEnvelope(source, options = {}) {
    const assignmentSource = source?.assignmentPresets ?? source?.presets;
    const assignmentPresets = {};
    if (isRecord(assignmentSource)) {
        for (const [name, preset] of Object.entries(assignmentSource)) {
            const entries = Array.isArray(preset) ? preset : preset?.entries;
            if (Array.isArray(entries)) assignmentPresets[name] = entries;
        }
    }
    // Do not retain both aliases: the hardened JSON codec deliberately rejects
    // shared references, while real stored presets commonly use the legacy key.
    const sourceWithoutPresetAliases = { ...(source || {}) };
    delete sourceWithoutPresetAliases.presets;
    delete sourceWithoutPresetAliases.assignmentPresets;
    const sourceForBuild = { ...sourceWithoutPresetAliases, assignmentPresets };
    const core = buildStylePack(sourceForBuild, options);
    const metadataSource = isRecord(source?.customPaletteMeta) ? source.customPaletteMeta : {};
    const pack = { ...core };
    if (core.palettes) {
        pack.palettes = {};
        for (const [name, colors] of Object.entries(core.palettes)) {
            const metadata = normalizePortablePaletteMetadata(metadataSource[name]);
            pack.palettes[name] = Object.keys(metadata).length ? { colors, metadata } : colors;
        }
    }
    return normalizeStylePackEnvelope(pack, { includeAssignmentPresets: options.includeAssignmentPresets === true }).pack;
}

export async function digestStylePackEnvelope(input, options = {}) {
    const normalized = normalizeStylePackEnvelope(input, { includeAssignmentPresets: options.includeAssignmentPresets === true });
    return digestCanonicalJson(normalized.pack);
}

export async function analyzeStylePackEnvelopeSource(source, options = {}) {
    const decoded = await analyzeJsonSource(source, options);
    if (!decoded.ok) return decoded;
    try {
        const normalized = normalizeStylePackEnvelope(decoded.value, { includeAssignmentPresets: options.includeAssignmentPresets === true });
        const fontNames = [...new Set(Object.values(normalized.pack.assignmentPresets || {})
            .flatMap(entries => entries.map(entry => entry.font).filter(Boolean)))].sort();
        return {
            ok: true,
            ...normalized,
            catalog: buildStylePackCatalog(normalized.pack, { includeAssignmentPresets: options.includeAssignmentPresets === true }),
            digest: await digestCanonicalJson(normalized.pack),
            fontNames,
            source: {
                byteLength: decoded.byteLength,
                nodeCount: decoded.nodeCount,
                maxDepth: decoded.maxDepth,
            },
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
