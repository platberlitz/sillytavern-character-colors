// llm.js - extracted from index.js (mechanical split)
import { generateQuietPrompt, getContext } from './st-api.js';
import { settings } from './state.js';

function isLlmErrorResponse(res) {
    if (!res) return false;
    const text = typeof res === 'string' ? res : String(res?.content ?? res);
    const lower = text.trim().toLowerCase();
    return lower.startsWith('error:')
        || lower.startsWith('[api error]')
        || lower.includes('400 bad request')
        || lower.includes('502 bad gateway')
        || lower.includes('500 internal')
        || lower.includes('503 service')
        || lower.includes('429 rate limit')
        || lower.includes('quota exceeded');
}

export async function callLLMWithProfile(instruction, options = {}) {
    const profileId = options.profileId ?? settings.llmConnectionProfile;
    const quietOptions = {
        skipWIAN: true,
        quietName: options.quietName || `DC_${Date.now()}`,
        quietToLoud: false,
        ...(options.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
    };

    if (!profileId) {
        const quietRes = await generateQuietPrompt({
            quietPrompt: instruction,
            ...quietOptions,
        });
        if (isLlmErrorResponse(quietRes)) throw new Error(`Main AI returned error response: ${String(quietRes).slice(0, 100)}`);
        return quietRes;
    }

    let CMRS = null;
    try {
        CMRS = getContext().ConnectionManagerRequestService;
    } catch { /* pre-1.15.0 */ }

    if (!CMRS) {
        const quietRes = await generateQuietPrompt({
            quietPrompt: instruction,
            ...quietOptions,
        });
        if (isLlmErrorResponse(quietRes)) throw new Error(`Main AI returned error response: ${String(quietRes).slice(0, 100)}`);
        return quietRes;
    }

    try {
        const messages = [{ role: 'user', content: instruction }];
        const response = await CMRS.sendRequest(
            profileId,
            messages,
            options.maxTokens || 2000,
            { extractData: true, includePreset: true, stream: false }
        );
        const resultText = typeof response === 'string' ? response : (response?.content || response?.toString() || '');
        if (isLlmErrorResponse(resultText)) throw new Error(`Profile ${profileId} returned error response: ${resultText.slice(0, 100)}`);
        return resultText;
    } catch (e) {
        console.warn('[DC] CMRS request failed, falling back to main AI:', e);
        const quietRes = await generateQuietPrompt({
            quietPrompt: instruction,
            ...quietOptions,
        });
        if (isLlmErrorResponse(quietRes)) throw new Error(`Fallback AI returned error response: ${String(quietRes).slice(0, 100)}`);
        return quietRes;
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
