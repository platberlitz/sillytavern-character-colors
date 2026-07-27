// llm.js - extracted from index.js (mechanical split)
import { generateQuietPrompt, getContext } from './st-api.js';
import { settings } from './state.js';

const DEFAULT_LLM_MAX_TOKENS = 2000;
const MAX_LLM_MAX_TOKENS = 131072;
const DEFAULT_LLM_TIMEOUT_MS = 120000;
const MAX_LLM_TIMEOUT_MS = 600000;

let mainAiRequestTail = Promise.resolve();
let activeMainAiRequest = null;
let mainAiRequestEpoch = 0;

function validatedPositiveInteger(value, fallback, maximum) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum
        ? value
        : fallback;
}

function getLlmErrorStatus(value) {
    for (const candidate of [value?.status, value?.statusCode, value?.response?.status, value?.cause?.status]) {
        const status = Number(candidate);
        if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
    }
    const text = String(value?.message ?? value ?? '');
    const match = text.match(/(?:\bHTTP\s*|\bstatus\s*[:=]?\s*|^)([1-5]\d{2})\b/i);
    return match ? Number(match[1]) : null;
}

export function classifyLlmRequestError(error) {
    const status = getLlmErrorStatus(error);
    const text = String(error?.message ?? error ?? '').toLowerCase();
    const name = String(error?.name ?? '');
    if (typeof error?.retryable === 'boolean' && error?.llmCategory) {
        return { category: error.llmCategory, retryable: error.retryable, status };
    }
    if (name === 'AbortError') return { category: 'cancelled', retryable: false, status };
    if (name === 'TimeoutError' || /\b(?:timed? out|timeout)\b/.test(text)) {
        return { category: 'timeout', retryable: true, status };
    }
    if (status === 402 || /\b(?:quota|billing|payment required|insufficient (?:funds|credits?)|credit balance|resource exhausted)\b/.test(text)) {
        return { category: 'quota', retryable: false, status };
    }
    if (status === 401 || status === 403 || /\b(?:unauthorized|forbidden|authentication|invalid api[- ]?key|permission denied)\b/.test(text)) {
        return { category: 'authentication', retryable: false, status };
    }
    if ([400, 404, 413, 422].includes(status)
        || /\b(?:bad request|profile .+ unavailable|model (?:is )?not found|invalid model|unsupported (?:model|provider)|configuration error)\b/.test(text)) {
        return { category: 'configuration', retryable: false, status };
    }
    if (status === 429 || /\b(?:rate limit|too many requests)\b/.test(text)) {
        return { category: 'rate-limit', retryable: true, status };
    }
    if (status === 408 || status === 409 || status === 425 || (status !== null && status >= 500)
        || /\b(?:network|fetch failed|connection (?:reset|refused)|temporar(?:y|ily)|service unavailable|bad gateway)\b/.test(text)) {
        return { category: 'transient', retryable: true, status };
    }
    return { category: 'unknown', retryable: false, status };
}

function annotateLlmRequestError(value) {
    const error = value instanceof Error ? value : new Error(String(value ?? 'LLM request failed'));
    const classification = classifyLlmRequestError(error);
    try {
        Object.defineProperties(error, {
            llmCategory: { value: classification.category, configurable: true },
            retryable: { value: classification.retryable, configurable: true },
            ...(classification.status === null ? {} : { status: { value: classification.status, configurable: true } }),
        });
        return error;
    } catch {
        const wrapped = new Error(error.message, { cause: error });
        wrapped.name = error.name;
        wrapped.llmCategory = classification.category;
        wrapped.retryable = classification.retryable;
        if (classification.status !== null) wrapped.status = classification.status;
        return wrapped;
    }
}

function createLlmResponseError(prefix, detail, response) {
    const error = new Error(`${prefix}: ${detail}`);
    const status = getLlmErrorStatus(response);
    if (status !== null) error.status = status;
    return annotateLlmRequestError(error);
}

function getStructuredLlmError(response) {
    if (!response || typeof response !== 'object' || Array.isArray(response)) return '';
    const status = response.status ?? response.statusCode;
    const nestedError = response.error;
    const detail = typeof nestedError === 'string'
        ? nestedError
        : typeof nestedError?.message === 'string'
            ? nestedError.message
            : '';
    const numericStatus = Number(status);
    if (Number.isInteger(numericStatus) && numericStatus >= 400 && numericStatus <= 599) {
        return `HTTP ${numericStatus}${detail ? `: ${detail}` : ''}`;
    }
    if (response.ok === false) return 'Provider returned an unsuccessful response';
    if (nestedError !== undefined && nestedError !== null && nestedError !== false && nestedError !== '') {
        if (detail) return detail;
        return 'Provider returned a structured error';
    }
    return '';
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

function getTextualLlmError(responseText) {
    const text = typeof responseText === 'string' ? responseText.trim() : '';
    if (!text) return '';

    // Only recognize complete, structured provider envelopes. Error phrases in
    // ordinary model content must remain valid output.
    if (/^(?:\[api error\]\s*(?::|-)?|(?:api error|error)\s*(?::|-|\r?\n))\s*\S[\s\S]*$/i.test(text)) {
        return text.slice(0, 500);
    }
    if (/^(?:(?:http|status)\s*)?(?:400\s+bad request|401\s+unauthorized|403\s+forbidden|404\s+not found|408\s+request timeout|409\s+conflict|413\s+(?:payload too large|content too large)|422\s+unprocessable (?:entity|content)|429\s+(?:too many requests|rate limit(?:ed| exceeded)?)|500\s+internal server error|502\s+bad gateway|503\s+service unavailable|504\s+gateway timeout)(?:\s*(?::|-|\r?\n)\s*[\s\S]*)?$/i.test(text)) {
        return text.slice(0, 500);
    }
    if (/^(?:quota exceeded|rate limit exceeded|insufficient quota)(?:\s*(?::|-|\r?\n)\s*[\s\S]*)?$/i.test(text)) {
        return text.slice(0, 500);
    }

    if (text.startsWith('{') && text.endsWith('}')) {
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                && Object.prototype.hasOwnProperty.call(parsed, 'error')) {
                return getStructuredLlmError(parsed);
            }
        } catch { /* not a JSON error envelope */ }
    }
    return '';
}

function createAbortError(message, name = 'AbortError') {
    const error = new Error(message);
    error.name = name;
    return error;
}

function createRequestCancellation(externalSignal, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });

    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort(createAbortError(`LLM request timed out after ${timeoutMs}ms`, 'TimeoutError'));
    }, timeoutMs);
    const aborted = new Promise((_, reject) => {
        const rejectAborted = () => {
            const reason = controller.signal.reason;
            if (reason instanceof Error) {
                if (timedOut) reason.name = 'TimeoutError';
                reject(reason);
                return;
            }
            reject(createAbortError(
                timedOut ? `LLM request timed out after ${timeoutMs}ms` : 'LLM request was cancelled',
                timedOut ? 'TimeoutError' : 'AbortError',
            ));
        };
        if (controller.signal.aborted) rejectAborted();
        else controller.signal.addEventListener('abort', rejectAborted, { once: true });
    });
    // The request can fail during synchronous setup before waitFor is called.
    // Keep a handler attached so an already-aborted signal cannot go unhandled.
    aborted.catch(() => {});

    return {
        signal: controller.signal,
        waitFor: request => Promise.race([request, aborted]),
        cleanup() {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener?.('abort', abortFromExternal);
        },
    };
}

function reserveMainAiRequestTurn() {
    const predecessor = mainAiRequestTail.catch(() => {});
    let release;
    const turn = new Promise(resolve => { release = resolve; });
    mainAiRequestTail = predecessor.then(() => turn);
    return { predecessor, release };
}

async function callMainAi(userContent, systemInstruction, maxTokens, timeoutMs, quietOptions, externalSignal) {
    const cancellation = createRequestCancellation(externalSignal, timeoutMs);
    const turn = reserveMainAiRequestTurn();

    try {
        try {
            // The timeout starts before this wait, so queueing time is part of
            // the request deadline. Resolving a cancelled turn lets successors
            // skip it once the real predecessor has settled.
            await cancellation.waitFor(turn.predecessor);
        } catch (error) {
            turn.release();
            throw error;
        }
        if (cancellation.signal.aborted) {
            turn.release();
            const reason = cancellation.signal.reason;
            throw reason instanceof Error ? reason : createAbortError('LLM request was cancelled');
        }

        const epoch = ++mainAiRequestEpoch;
        activeMainAiRequest = {
            epoch,
            quietName: quietOptions.quietName,
            generationEndConsumed: false,
        };
        const quietPrompt = systemInstruction
            ? `${systemInstruction}\n\n[USER/DATA MESSAGE]\n${userContent}`
            : userContent;
        // SillyTavern does not expose an AbortSignal for generateQuietPrompt.
        // The consumer races cancellation, while this settlement chain retains
        // the lock and active quiet-request tag until the host really finishes.
        const hostOutcome = Promise.resolve()
            .then(() => {
                if (cancellation.signal.aborted) {
                    const reason = cancellation.signal.reason;
                    throw reason instanceof Error ? reason : createAbortError('LLM request was cancelled');
                }
                return generateQuietPrompt({
                    quietPrompt,
                    responseLength: maxTokens,
                    ...quietOptions,
                });
            })
            .then(
                value => ({ ok: true, value }),
                error => ({ ok: false, error }),
            );
        const hostSettlement = hostOutcome.then(outcome => {
            if (activeMainAiRequest?.epoch === epoch) activeMainAiRequest = null;
            turn.release();
            return outcome;
        });
        const outcome = await cancellation.waitFor(hostSettlement);
        if (!outcome.ok) throw outcome.error;
        const quietRes = outcome.value;
        const structuredError = getStructuredLlmError(quietRes);
        if (structuredError) throw createLlmResponseError('Main AI request failed', structuredError, quietRes);
        const resultText = normalizeLlmResponse(quietRes);
        const textualError = getTextualLlmError(resultText);
        if (textualError) throw createLlmResponseError('Main AI request failed', textualError, quietRes);
        return resultText;
    } catch (error) {
        throw annotateLlmRequestError(error);
    } finally {
        cancellation.cleanup();
    }
}

export function isMainAiRequestActive(quietNamePrefix = '') {
    if (!activeMainAiRequest) return false;
    const prefix = String(quietNamePrefix || '');
    return !prefix || String(activeMainAiRequest.quietName || '').startsWith(prefix);
}

export function consumeMainAiQuietGenerationEnd(quietNamePrefix = '') {
    if (!isMainAiRequestActive(quietNamePrefix) || activeMainAiRequest.generationEndConsumed) return false;
    activeMainAiRequest.generationEndConsumed = true;
    return true;
}

export async function callLLMWithProfile(instruction, options = {}) {
    const hasExplicitProfile = Object.prototype.hasOwnProperty.call(options, 'profileId');
    const selectedProfile = hasExplicitProfile ? options.profileId : settings.llmConnectionProfile;
    const profileId = typeof selectedProfile === 'string' ? selectedProfile.trim() : selectedProfile;
    if (profileId !== null && profileId !== undefined && typeof profileId !== 'string') {
        throw new TypeError('Connection Manager profile ID must be a string, null, or undefined.');
    }
    const maxTokens = validatedPositiveInteger(options.maxTokens, DEFAULT_LLM_MAX_TOKENS, MAX_LLM_MAX_TOKENS);
    const timeoutMs = validatedPositiveInteger(options.timeoutMs, DEFAULT_LLM_TIMEOUT_MS, MAX_LLM_TIMEOUT_MS);
    const systemInstruction = typeof options.systemInstruction === 'string' ? options.systemInstruction.trim() : '';
    const userContent = typeof instruction === 'string' ? instruction : String(instruction ?? '');
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
        return callMainAi(userContent, systemInstruction, maxTokens, timeoutMs, quietOptions, options.signal);
    }

    const cancellation = createRequestCancellation(options.signal, timeoutMs);
    try {

        let CMRS = null;
        try {
            CMRS = getContext().ConnectionManagerRequestService;
        } catch { /* pre-1.15.0 */ }

        if (!CMRS) throw new Error(`Selected Connection Manager profile ${profileId} is unavailable.`);

        const messages = [
            ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
            { role: 'user', content: userContent },
        ];
        const profile = typeof CMRS.getProfile === 'function' ? CMRS.getProfile(profileId) : null;
        const apiMap = profile && typeof CMRS.validateProfile === 'function'
            ? CMRS.validateProfile(profile)
            : profile ? getContext()?.CONNECT_API_MAP?.[profile.api] : null;
        const overridePayload = schemaSpec && apiMap?.selected === 'openai'
            ? { json_schema: schemaSpec }
            : {};
        if (cancellation.signal.aborted) {
            const reason = cancellation.signal.reason;
            throw reason instanceof Error ? reason : createAbortError('LLM request was cancelled');
        }
        const response = await cancellation.waitFor(CMRS.sendRequest(
            profileId,
            messages,
            maxTokens,
            { extractData: true, includePreset: true, includeInstruct: true, stream: false, signal: cancellation.signal },
            overridePayload,
        ));
        const structuredError = getStructuredLlmError(response);
        if (structuredError) throw createLlmResponseError(`Profile ${profileId} request failed`, structuredError, response);
        const resultText = normalizeLlmResponse(response);
        const textualError = getTextualLlmError(resultText);
        if (textualError) throw createLlmResponseError(`Profile ${profileId} request failed`, textualError, response);
        return resultText;
    } catch (e) {
        const error = annotateLlmRequestError(e);
        if (profileId && error?.name !== 'AbortError') {
            console.warn(`[DC] Connection Manager profile ${profileId} request failed:`, error);
        }
        throw error;
    } finally {
        cancellation.cleanup();
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
