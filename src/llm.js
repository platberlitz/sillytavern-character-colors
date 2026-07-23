// llm.js - extracted from index.js (mechanical split)
import { generateQuietPrompt, getContext } from './st-api.js';
import { settings } from './state.js';

function isLlmErrorResponse(res) {
    if (!res) return false;
    const text = normalizeLlmResponse(res);
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

function normalizeLlmResponse(response) {
    const content = response?.content ?? response;
    if (typeof content === 'string') return content;
    if (content === null || content === undefined) return '';
    try {
        return JSON.stringify(content);
    } catch {
        return String(content);
    }
}

export async function callLLMWithProfile(instruction, options = {}) {
    const profileId = options.profileId ?? settings.llmConnectionProfile;
    const schemaSpec = options.jsonSchema ? {
        name: 'dialogue_colors_result',
        description: 'Dialogue Colors structured result',
        value: options.jsonSchema,
        strict: true,
    } : null;
    const quietOptions = {
        skipWIAN: true,
        quietName: options.quietName || `DC_${Date.now()}`,
        quietToLoud: false,
        ...(schemaSpec ? { jsonSchema: schemaSpec } : {}),
    };

    if (!profileId) {
        const quietRes = await generateQuietPrompt({
            quietPrompt: instruction,
            ...quietOptions,
        });
        const resultText = normalizeLlmResponse(quietRes);
        if (isLlmErrorResponse(resultText)) throw new Error(`Main AI returned error response: ${resultText.slice(0, 100)}`);
        return resultText;
    }

    let CMRS = null;
    try {
        CMRS = getContext().ConnectionManagerRequestService;
    } catch { /* pre-1.15.0 */ }

    if (!CMRS) throw new Error(`Selected Connection Manager profile ${profileId} is unavailable.`);

    try {
        const messages = [{ role: 'user', content: instruction }];
        const profile = typeof CMRS.getProfile === 'function' ? CMRS.getProfile(profileId) : null;
        const apiMap = profile && typeof CMRS.validateProfile === 'function'
            ? CMRS.validateProfile(profile)
            : profile ? getContext()?.CONNECT_API_MAP?.[profile.api] : null;
        const overridePayload = schemaSpec && apiMap?.selected === 'openai'
            ? { json_schema: schemaSpec }
            : {};
        const response = await CMRS.sendRequest(
            profileId,
            messages,
            options.maxTokens ?? 2000,
            { extractData: true, includePreset: true, includeInstruct: true, stream: false },
            overridePayload,
        );
        const resultText = normalizeLlmResponse(response);
        if (isLlmErrorResponse(resultText)) throw new Error(`Profile ${profileId} returned error response: ${resultText.slice(0, 100)}`);
        return resultText;
    } catch (e) {
        console.warn(`[DC] Connection Manager profile ${profileId} request failed:`, e);
        throw e;
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
