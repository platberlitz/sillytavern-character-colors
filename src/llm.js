// llm.js - extracted from index.js (mechanical split)
import { generateQuietPrompt, getContext } from './st-api.js';
import { settings } from './state.js';

export async function callLLMWithProfile(instruction, options = {}) {
    const profileId = options.profileId ?? settings.llmConnectionProfile;
    const quietOptions = {
        skipWIAN: true,
        quietName: options.quietName || `DC_${Date.now()}`,
        quietToLoud: false,
        ...(options.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
    };

    if (!profileId) {
        return await generateQuietPrompt({
            quietPrompt: instruction,
            ...quietOptions,
        });
    }

    let CMRS = null;
    try {
        CMRS = getContext().ConnectionManagerRequestService;
    } catch { /* pre-1.15.0 */ }

    if (!CMRS) {
        return await generateQuietPrompt({
            quietPrompt: instruction,
            ...quietOptions,
        });
    }

    try {
        const messages = [{ role: 'user', content: instruction }];
        const response = await CMRS.sendRequest(
            profileId,
            messages,
            options.maxTokens || 2000,
            { extractData: true, includePreset: true, stream: false }
        );
        if (typeof response === 'string') return response;
        return response?.content || response?.toString() || '';
    } catch (e) {
        console.warn('[DC] CMRS request failed, falling back to main AI:', e);
        return await generateQuietPrompt({
            quietPrompt: instruction,
            ...quietOptions,
        });
    }
}

export function populateProfileSelect(elementId, selectedProfileId) {
    const select = document.getElementById(elementId);
    if (!select) return;
    select.innerHTML = '<option value="">-- Use main chat AI --</option>';
    try {
        const ctx = getContext();
        const CMRS = ctx.ConnectionManagerRequestService;
        if (!CMRS) {
            select.innerHTML += '<option value="" disabled>Requires SillyTavern 1.15.0+</option>';
            return;
        }
        const profiles = CMRS.getSupportedProfiles();
        for (const p of profiles) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name || p.id;
            if (p.id === selectedProfileId) opt.selected = true;
            select.appendChild(opt);
        }
        select.disabled = false;
    } catch (e) {
        console.warn('[DC] Failed to load profiles:', e);
        select.innerHTML += '<option value="" disabled>Error loading profiles</option>';
    }
}

export function populateProfileDropdown() {
    populateProfileSelect('dc-llm-profile', settings.llmConnectionProfile);
    populateProfileSelect('dc-attr-profile', settings.attributionConnectionProfile);
}
