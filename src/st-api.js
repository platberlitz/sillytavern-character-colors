// st-api.js - single point of contact with SillyTavern core.
// Every module imports ST bindings from here so relative path juggling lives
// in exactly one file (src/ is one level deeper than the old index.js).
import { converter } from '../../../../../script.js';
import { power_user } from '/scripts/power-user.js';
import { escapeHtml, escapeRegex } from '/scripts/utils.js';

const { extension_settings, getContext } = await import('../../../../extensions.js');
const scriptApi = await import('../../../../../script.js');
const {
    eventSource,
    event_types,
    setExtensionPrompt,
    saveSettings,
    saveSettingsDebounced,
    saveCharacterDebounced,
    getCharacters,
    extension_prompt_types,
    extension_prompt_roles,
    generateQuietPrompt,
    registerMacro,
    getRequestHeaders,
} = scriptApi;

function saveMetadata(...args) {
    if (typeof scriptApi.saveMetadata === 'function') return scriptApi.saveMetadata(...args);
    const context = getContext?.();
    if (typeof context?.saveMetadata === 'function') return context.saveMetadata(...args);
    if (typeof scriptApi.saveMetadataDebounced === 'function') return scriptApi.saveMetadataDebounced(...args);
    if (typeof context?.saveMetadataDebounced === 'function') return context.saveMetadataDebounced(...args);
}

function saveMetadataDebounced(...args) {
    if (typeof scriptApi.saveMetadataDebounced === 'function') return scriptApi.saveMetadataDebounced(...args);
    const context = getContext?.();
    if (typeof context?.saveMetadataDebounced === 'function') return context.saveMetadataDebounced(...args);
    return saveMetadata(...args);
}

export {
    converter,
    power_user,
    escapeHtml,
    escapeRegex,
    extension_settings,
    getContext,
    eventSource,
    event_types,
    setExtensionPrompt,
    saveSettings,
    saveSettingsDebounced,
    saveCharacterDebounced,
    getCharacters,
    extension_prompt_types,
    extension_prompt_roles,
    generateQuietPrompt,
    registerMacro,
    getRequestHeaders,
    saveMetadata,
    saveMetadataDebounced,
};
