(async function() {
    'use strict';
    
    const { extension_settings, saveSettingsDebounced, getContext } = await import('../../../extensions.js');
    const { eventSource, event_types, setExtensionPrompt, saveCharacterDebounced, getCharacters } = await import('../../../../script.js');

    const MODULE_NAME = 'dialogue-colors';
    let characterColors = {};
    let colorHistory = [];
    let historyIndex = -1;
    let swapMode = null;
    let sortMode = 'name';
    let searchTerm = '';
    let settings = { enabled: true, themeMode: 'auto', narratorColor: '', colorTheme: 'pastel', brightness: 0, highlightMode: false, autoScanOnLoad: true, showLegend: false, thoughtSymbols: '*', disableNarration: true, shareColorsGlobally: false, cssEffects: false, autoScanNewMessages: true, autoLockDetected: true, enableRightClick: false };
    let lastCharKey = null;

    const COLOR_THEMES = {
        pastel: [[340,70,75],[200,70,75],[120,50,70],[45,80,70],[280,60,75],[170,60,70],[20,80,75],[240,60,75]],
        neon: [[320,100,60],[180,100,50],[90,100,50],[45,100,55],[270,100,60],[150,100,45],[0,100,60],[210,100,55]],
        earth: [[25,50,55],[45,40,50],[90,30,45],[150,35,45],[180,30,50],[30,60,60],[60,35,55],[120,25,50]],
        jewel: [[340,70,45],[200,80,40],[150,70,40],[45,80,50],[280,70,45],[170,70,40],[0,75,50],[220,75,45]],
        muted: [[350,30,60],[200,30,55],[120,25,55],[45,35,60],[280,25,55],[170,30,55],[20,35,60],[240,25,55]],
        jade: [[170,60,55],[150,55,50],[160,65,45],[165,50,60],[155,70,40],[140,45,55],[175,55,50],[130,60,45]],
        forest: [[120,50,50],[90,45,45],[100,55,40],[110,40,55],[80,50,35],[130,45,50],[95,60,45],[85,55,40]],
        ocean: [[200,70,60],[190,65,55],[180,60,65],[210,55,60],[170,75,50],[220,50,65],[195,80,45],[205,60,70]],
        sunset: [[15,85,60],[35,90,55],[25,80,65],[40,75,70],[30,95,50],[20,70,75],[45,85,55],[10,80,60]],
        aurora: [[280,50,70],[300,55,65],[260,45,75],[290,60,60],[270,65,55],[310,40,80],[285,70,50],[275,55,70]],
        warm: [[20,70,65],[35,75,60],[45,65,70],[30,80,55],[40,85,50],[25,90,60],[50,60,75],[15,75,65]],
        cool: [[210,60,70],[240,55,65],[200,65,75],[225,70,60],[190,75,55],[250,50,80],[215,80,50],[235,60,75]],
        berry: [[330,70,60],[350,65,55],[320,60,70],[340,75,50],[360,80,45],[310,55,75],[345,85,40],[325,70,65]],
        monochrome: [[0,0,30],[0,0,40],[0,0,50],[0,0,60],[0,0,70],[0,0,80],[0,0,90],[0,0,20]],
        protanopia: [[45,80,60],[200,80,55],[270,60,65],[30,90,55],[180,70,50],[300,50,60],[60,70,55],[220,70,60]],
        deuteranopia: [[45,80,60],[220,80,55],[280,60,65],[30,90,55],[200,70,50],[320,50,60],[60,70,55],[240,70,60]],
        tritanopia: [[0,70,60],[180,70,55],[330,60,65],[20,80,55],[200,60,50],[350,50,60],[160,70,55],[10,70,60]]
    };
    let cachedTheme = null;
    let cachedIsDark = null;
    let injectDebouncedTimer = null;

    function hslToHex(h, s, l) {
        l = Math.max(0, Math.min(100, l + settings.brightness));
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function hexToHsl(hex) {
        let r = parseInt(hex.slice(1,3), 16) / 255, g = parseInt(hex.slice(3,5), 16) / 255, b = parseInt(hex.slice(5,7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) { h = s = 0; } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
        }
        return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
    }

    function saveHistory() {
        colorHistory = colorHistory.slice(0, historyIndex + 1);
        colorHistory.push(JSON.stringify(characterColors));
        if (colorHistory.length > 20) colorHistory.shift();
        historyIndex = colorHistory.length - 1;
    }

    function undo() {
        if (historyIndex > 0) { historyIndex--; characterColors = JSON.parse(colorHistory[historyIndex]); saveData(); updateCharList(); injectPrompt(); }
    }

    function redo() {
        if (historyIndex < colorHistory.length - 1) { historyIndex++; characterColors = JSON.parse(colorHistory[historyIndex]); saveData(); updateCharList(); injectPrompt(); }
    }

    function getNextColor() {
        const theme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES.pastel;
        const usedColors = Object.values(characterColors).map(c => c.color);
        if (cachedIsDark === null) {
            const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
            cachedIsDark = mode === 'dark';
        }
        const isDark = cachedIsDark;
        for (const [h, s, l] of theme) {
            const adjustedL = isDark ? Math.min(l + 15, 85) : Math.max(l - 15, 35);
            const color = hslToHex(h, s, adjustedL);
            if (!usedColors.includes(color)) return color;
        }
        const [h, s, l] = theme[Math.floor(Math.random() * theme.length)];
        return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, isDark ? 75 : 40);
    }

    function checkColorConflicts() {
        const colors = Object.entries(characterColors), conflicts = [];
        for (let i = 0; i < colors.length; i++) {
            for (let j = i + 1; j < colors.length; j++) {
                const [h1,,l1] = hexToHsl(colors[i][1].color), [h2,,l2] = hexToHsl(colors[j][1].color);
                if (Math.min(Math.abs(h1-h2), 360-Math.abs(h1-h2)) < 25 && Math.abs(l1-l2) < 15) conflicts.push([colors[i][1].name, colors[j][1].name]);
            }
        }
        return conflicts;
    }

    function suggestColorForName(name) {
        const n = name.toLowerCase();
        const colorMap = { red: 0, rose: 340, pink: 340, magenta: 330, purple: 280, violet: 270, blue: 220, cyan: 180, teal: 170, green: 120, lime: 90, yellow: 50, gold: 45, orange: 30, brown: 25, grey: 0, gray: 0 };
        for (const [k, h] of Object.entries(colorMap)) if (n.includes(k)) return hslToHex(h, 70, 50);
        return null;
    }

    function regenerateAllColors() {
        invalidateThemeCache();
        Object.entries(characterColors).sort((a, b) => (a[1].dialogueCount || 0) - (b[1].dialogueCount || 0)).forEach(([, char]) => {
            if (!char.locked) char.color = suggestColorForName(char.name) || getNextColor();
        });
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.('Colors regenerated');
    }

    function autoResolveConflicts() {
        const conflicts = checkColorConflicts();
        if (!conflicts.length) { toastr?.info?.('No conflicts found'); return; }
        let fixed = 0;
        conflicts.forEach(([name1, name2]) => {
            const key1 = name1.toLowerCase(), key2 = name2.toLowerCase();
            if (!characterColors[key1].locked) { characterColors[key1].color = getNextColor(); fixed++; }
            else if (!characterColors[key2].locked) { characterColors[key2].color = getNextColor(); fixed++; }
        });
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.(`Fixed ${fixed} conflicts`);
    }

    function saveColorPreset() {
        const name = prompt('Preset name:');
        if (!name?.trim()) return;
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        presets[name] = Object.entries(characterColors).map(([k, v]) => ({ name: v.name, color: v.color, style: v.style }));
        localStorage.setItem('dc_presets', JSON.stringify(presets));
        toastr?.success?.('Preset saved');
    }

    function loadColorPreset() {
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        const names = Object.keys(presets);
        if (!names.length) { toastr?.info?.('No presets saved'); return; }
        const name = prompt('Load preset:\n' + names.map(n => `• ${n}`).join('\n'));
        if (name && presets[name]) {
            presets[name].forEach(p => {
                const key = p.name.toLowerCase();
                if (characterColors[key]) { characterColors[key].color = p.color; characterColors[key].style = p.style || ''; }
                else { characterColors[key] = { color: p.color, name: p.name, locked: false, aliases: [], style: p.style || '', dialogueCount: 0 }; }
            });
            saveHistory(); saveData(); updateCharList(); injectPrompt();
            toastr?.success?.('Preset loaded');
        }
    }

    function getSortedEntries() {
        const entries = Object.entries(characterColors).filter(([, v]) => !searchTerm || v.name.toLowerCase().includes(searchTerm.toLowerCase()));
        if (sortMode === 'count') entries.sort((a, b) => (b[1].dialogueCount || 0) - (a[1].dialogueCount || 0));
        else entries.sort((a, b) => a[1].name.localeCompare(b[1].name));
        return entries;
    }

    function getBadge(count) {
        if (count >= 100) return '💎';
        if (count >= 50) return '⭐';
        return '';
    }

    function detectTheme() {
        if (cachedTheme) return cachedTheme;
        const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
        cachedTheme = m && (parseInt(m[0])*299 + parseInt(m[1])*587 + parseInt(m[2])*114) / 1000 < 128 ? 'dark' : 'light';
        return cachedTheme;
    }
    function invalidateThemeCache() { cachedTheme = null; cachedIsDark = null; }

    function getCharKey() { try { const ctx = getContext(); return ctx?.characters?.[ctx?.characterId]?.avatar || ctx?.characterId || null; } catch { return null; } }
    function getStorageKey() { return settings.shareColorsGlobally ? 'dc_global' : `dc_char_${getCharKey() || 'default'}`; }
    
    // Extract dominant color from avatar image
    async function extractAvatarColor(imgSrc) {
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 50; canvas.height = 50;
                ctx.drawImage(img, 0, 0, 50, 50);
                const data = ctx.getImageData(0, 0, 50, 50).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i+3] < 128) continue; // Skip transparent
                    r += data[i]; g += data[i+1]; b += data[i+2]; count++;
                }
                if (count === 0) { resolve(null); return; }
                r = Math.round(r/count); g = Math.round(g/count); b = Math.round(b/count);
                resolve(`#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`);
            };
            img.onerror = () => resolve(null);
            img.src = imgSrc;
        });
    }
    
    // Export legend as PNG
    function exportLegendPng() {
        const entries = Object.entries(characterColors);
        if (!entries.length) { toastr?.info?.('No characters to export'); return; }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const lineHeight = 24, padding = 16, dotSize = 10;
        canvas.width = 300;
        canvas.height = entries.length * lineHeight + padding * 2;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        entries.forEach(([, v], i) => {
            const y = padding + i * lineHeight + lineHeight / 2;
            ctx.beginPath();
            ctx.arc(padding + dotSize/2, y, dotSize/2, 0, Math.PI * 2);
            ctx.fillStyle = v.color;
            ctx.fill();
            ctx.fillStyle = v.color;
            ctx.font = '14px sans-serif';
            ctx.fillText(v.name, padding + dotSize + 8, y + 5);
        });
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `dialogue-colors-legend-${Date.now()}.png`;
        a.click();
        toastr?.success?.('Legend exported');
    }
    
    // Right-click and long-press context menu for messages
    function setupContextMenu() {
        let longPressTimer = null;
        let longPressTarget = null;
        
        const showMenu = (e, fontTag) => {
            e.preventDefault();
            const existingMenu = document.getElementById('dc-context-menu');
            if (existingMenu) existingMenu.remove();
            const color = fontTag.getAttribute('color');
            const text = fontTag.textContent.substring(0, 30) + (fontTag.textContent.length > 30 ? '...' : '');
            const menu = document.createElement('div');
            menu.id = 'dc-context-menu';
            const x = e.clientX || e.touches?.[0]?.clientX || 100;
            const y = e.clientY || e.touches?.[0]?.clientY || 100;
            menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#1a1a2e;border:1px solid #4a4a6a;border-radius:6px;padding:8px;z-index:10001;min-width:180px;color:#e0e0e0;box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
            menu.innerHTML = `
                <div style="font-size:0.8em;opacity:0.7;margin-bottom:6px;">"${text}"</div>
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:${color};"></span>
                    <input type="color" id="dc-ctx-color" value="${color}" style="width:24px;height:20px;border:none;">
                    <input type="text" id="dc-ctx-name" placeholder="Character name" class="text_pole" style="flex:1;padding:3px;font-size:0.85em;background:#2a2a4e;color:#e0e0e0;border:1px solid #4a4a6a;">
                </div>
                <button id="dc-ctx-assign" class="menu_button" style="width:100%;margin-bottom:4px;background:#3a3a5e;">Assign to Character</button>
                <button id="dc-ctx-close" class="menu_button" style="width:100%;background:#3a3a5e;">Cancel</button>
            `;
            document.body.appendChild(menu);
            menu.querySelector('#dc-ctx-close').onclick = () => menu.remove();
            menu.querySelector('#dc-ctx-assign').onclick = () => {
                const name = menu.querySelector('#dc-ctx-name').value.trim();
                const newColor = menu.querySelector('#dc-ctx-color').value;
                if (name) {
                    const key = name.toLowerCase();
                    if (characterColors[key]) {
                        characterColors[key].color = newColor;
                    } else {
                        characterColors[key] = { color: newColor, name, locked: false, aliases: [], style: '', dialogueCount: 1 };
                    }
                    saveHistory(); saveData(); updateCharList(); injectPrompt();
                    toastr?.success?.(`Assigned to ${name}`);
                }
                menu.remove();
            };
            const closeMenu = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('click', closeMenu); document.removeEventListener('touchstart', closeMenu); } };
            setTimeout(() => { document.addEventListener('click', closeMenu); document.addEventListener('touchstart', closeMenu); }, 10);
        };
        
        // Right-click (desktop)
        document.addEventListener('contextmenu', e => {
            if (!settings.enableRightClick) return;
            const fontTag = e.target.closest('font[color]');
            const mesText = e.target.closest('.mes_text');
            if (!fontTag || !mesText) return;
            showMenu(e, fontTag);
        });
        
        // Long-press (mobile)
        document.addEventListener('touchstart', e => {
            if (!settings.enableRightClick) return;
            const fontTag = e.target.closest('font[color]');
            const mesText = e.target.closest('.mes_text');
            if (!fontTag || !mesText) return;
            longPressTarget = fontTag;
            longPressTimer = setTimeout(() => showMenu(e, fontTag), 500);
        }, { passive: true });
        
        document.addEventListener('touchend', () => { clearTimeout(longPressTimer); longPressTimer = null; });
        document.addEventListener('touchmove', () => { clearTimeout(longPressTimer); longPressTimer = null; });
    }
    function saveData() { 
        localStorage.setItem(getStorageKey(), JSON.stringify({ colors: characterColors, settings })); 
        localStorage.setItem('dc_global_settings', JSON.stringify({ thoughtSymbols: settings.thoughtSymbols }));
    }
    function loadData() {
        characterColors = {};
        try { const g = JSON.parse(localStorage.getItem('dc_global_settings')); if (g?.thoughtSymbols !== undefined) settings.thoughtSymbols = g.thoughtSymbols; } catch {}
        try { const d = JSON.parse(localStorage.getItem(getStorageKey())); if (d?.colors) characterColors = d.colors; if (d?.settings) Object.assign(settings, d.settings); } catch {}
        try { const g = JSON.parse(localStorage.getItem('dc_global_settings')); if (g?.thoughtSymbols !== undefined) settings.thoughtSymbols = g.thoughtSymbols; } catch {}
        colorHistory = [JSON.stringify(characterColors)]; historyIndex = 0;
    }

    function exportColors() {
        const blob = new Blob([JSON.stringify({ colors: characterColors, settings }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dialogue-colors-${Date.now()}.json`; a.click();
    }

    function importColors(file) {
        const reader = new FileReader();
        reader.onload = e => { try { const d = JSON.parse(e.target.result); if (d.colors) characterColors = d.colors; if (d.settings) Object.assign(settings, d.settings); saveHistory(); saveData(); updateCharList(); injectPrompt(); toastr?.success?.('Imported!'); } catch { toastr?.error?.('Invalid file'); } };
        reader.readAsText(file);
    }

    function ensureRegexScript() {
        try {
            console.log('[Dialogue Colors] Checking regex scripts, extension_settings:', !!extension_settings);
            if (!extension_settings || typeof extension_settings !== 'object') {
                console.warn('[Dialogue Colors] extension_settings not available');
                return;
            }
            if (!Array.isArray(extension_settings.regex)) extension_settings.regex = [];
            
            const uuidv4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
            
            // Trim font tags from prompt
            if (!extension_settings.regex.some(r => r?.scriptName === 'Trim Font Colors')) {
                console.log('[Dialogue Colors] Adding Trim Font Colors regex');
                extension_settings.regex.push({
                    id: uuidv4(),
                    scriptName: 'Trim Font Colors',
                    findRegex: '/<\\/?font[^>]*>/gi',
                    replaceString: '',
                    trimStrings: [],
                    placement: [2],
                    disabled: false,
                    markdownOnly: false,
                    promptOnly: true,
                    runOnEdit: true,
                    substituteRegex: 0,
                    minDepth: null,
                    maxDepth: null
                });
                saveSettingsDebounced?.();
            }
            
            // Trim [COLORS:...] blocks from prompt and display
            if (!extension_settings.regex.some(r => r?.scriptName === 'Trim Color Blocks')) {
                console.log('[Dialogue Colors] Adding Trim Color Blocks regex');
                extension_settings.regex.push({
                    id: uuidv4(),
                    scriptName: 'Trim Color Blocks',
                    findRegex: '/\\[COLORS?:[^\\]]*\\]/gi',
                    replaceString: '',
                    trimStrings: [],
                    placement: [2],
                    disabled: false,
                    markdownOnly: true,
                    promptOnly: true,
                    runOnEdit: true,
                    substituteRegex: 0,
                    minDepth: null,
                    maxDepth: null
                });
                saveSettingsDebounced?.();
            }
            
            // Trim CSS effect spans from prompt only (keep display)
            if (!extension_settings.regex.some(r => r?.scriptName === 'Trim CSS Effects (Prompt)')) {
                console.log('[Dialogue Colors] Adding Trim CSS Effects regex');
                extension_settings.regex.push({
                    id: uuidv4(),
                    scriptName: 'Trim CSS Effects (Prompt)',
                    findRegex: '/<span[^>]*style=["\'][^"\']*(?:transform|skew|rotate|scale)[^"\']*["\'][^>]*>(.*?)<\\/span>/gi',
                    replaceString: '$1',
                    trimStrings: [],
                    placement: [2],
                    disabled: false,
                    markdownOnly: false,
                    promptOnly: true,
                    runOnEdit: true,
                    substituteRegex: 0,
                    minDepth: null,
                    maxDepth: null
                });
                saveSettingsDebounced?.();
            }
            console.log('[Dialogue Colors] Regex scripts check complete');
        } catch (e) {
            console.error('[Dialogue Colors] Failed to import regex scripts:', e);
        }
    }

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark' ? 'Use light colors.' : 'Use dark colors.';
        const colorList = Object.entries(characterColors).filter(([,v]) => v.locked && v.color).map(([,v]) => `${v.name}=${v.color}${v.style ? ` (${v.style})` : ''}`).join(', ');
        const aliases = Object.entries(characterColors).filter(([,v]) => v.aliases?.length).map(([,v]) => `${v.name}/${v.aliases.join('/')}`).join('; ');
        let thoughts = '';
        if (settings.thoughtSymbols) {
            thoughts = ` Inner thoughts wrapped in ${settings.thoughtSymbols} must be fully enclosed in <font color=...> tags using the current speaker's color.`;
        }
        const narratorRule = settings.disableNarration ? '' : (settings.narratorColor ? `Narrator: ${settings.narratorColor}.` : '');
        const narratorInBlock = settings.disableNarration ? '' : ' Include Narrator=#RRGGBB if narration is used.';
        const cssEffectsRule = settings.cssEffects ? ` For intense emotion/magic/distortion, use CSS transforms: chaos=rotate(2deg) skew(5deg), magic=scale(1.2), unease=skew(-10deg), rage=uppercase, whispers=lowercase. Wrap in <span style='transform:X; display:inline-block; background:transparent;'>text</span>.` : '';
        return `[Font Color Rule: Wrap dialogue in <font color=#RRGGBB> tags. ${themeHint} ${colorList ? `LOCKED: ${colorList}.` : ''} ${aliases ? `ALIASES: ${aliases}.` : ''} ${narratorRule} ${thoughts} ${settings.highlightMode ? 'Also add background highlight.' : ''}${cssEffectsRule} Assign unique colors to new characters. At the very END of your response, on its own line, add: [COLORS:Name=#RRGGBB,Name2=#RRGGBB] listing ALL characters who spoke.${narratorInBlock} This will be auto-removed.]`;
    }

    function buildColoredPromptPreview() {
        if (!settings.enabled) return '<span style="opacity:0.5">(disabled)</span>';
        const entries = Object.entries(characterColors);
        if (!entries.length) return '<span style="opacity:0.5">(no characters)</span>';
        return entries.map(([,v]) => `<span style="color:${v.color}">${v.name}</span>`).join(', ');
    }

    function injectPrompt() {
        if (injectDebouncedTimer) clearTimeout(injectDebouncedTimer);
        injectDebouncedTimer = setTimeout(() => {
            setExtensionPrompt(MODULE_NAME, settings.enabled ? buildPromptInstruction() : '', 1, 0);
            const p = document.getElementById('dc-prompt-preview');
            if (p) p.innerHTML = buildColoredPromptPreview();
        }, 50);
    }

    function createLegend() {
        let legend = document.getElementById('dc-legend-float');
        if (!legend) {
            legend = document.createElement('div');
            legend.id = 'dc-legend-float';
            legend.style.cssText = 'position:fixed;top:60px;right:10px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;z-index:9999;font-size:0.8em;max-width:150px;display:none;';
            document.body.appendChild(legend);
        }
        return legend;
    }

    function updateLegend() {
        const legend = createLegend();
        const entries = Object.entries(characterColors);
        if (!entries.length || !settings.showLegend) { legend.style.display = 'none'; return; }
        legend.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;">Characters</div>' + 
            entries.map(([,v]) => `<div style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${v.color};"></span><span style="color:${v.color}">${v.name}</span><span style="opacity:0.5;font-size:0.8em;">${v.dialogueCount||0}</span></div>`).join('');
        legend.style.display = settings.showLegend ? 'block' : 'none';
    }

    function getDialogueStats() {
        const entries = Object.entries(characterColors);
        const total = entries.reduce((s, [,v]) => s + (v.dialogueCount || 0), 0);
        return entries.map(([,v]) => ({ name: v.name, count: v.dialogueCount || 0, pct: total ? Math.round((v.dialogueCount || 0) / total * 100) : 0, color: v.color })).sort((a,b) => b.count - a.count);
    }

    function showStatsPopup() {
        const stats = getDialogueStats();
        if (!stats.length) { toastr?.info?.('No dialogue data'); return; }
        const maxCount = Math.max(...stats.map(s => s.count), 1);
        let html = stats.map(s => `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;"><span style="width:60px;color:${s.color}">${s.name}</span><div style="flex:1;height:12px;background:var(--SmartThemeBlurTintColor);border-radius:3px;overflow:hidden;"><div style="width:${s.count/maxCount*100}%;height:100%;background:${s.color};"></div></div><span style="width:40px;text-align:right;font-size:0.8em;">${s.count} (${s.pct}%)</span></div>`).join('');
        const popup = document.createElement('div');
        popup.id = 'dc-stats-popup';
        popup.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">Dialogue Statistics</div>${html}<button class="dc-close-popup menu_button" style="margin-top:10px;width:100%;">Close</button>`;
        popup.querySelector('.dc-close-popup').onclick = () => popup.remove();
        document.body.appendChild(popup);
    }

    function saveToCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            if (!char) { toastr?.error?.('No character loaded'); return; }
            if (!char.data) char.data = {};
            if (!char.data.extensions) char.data.extensions = {};
            char.data.extensions.dialogueColors = { colors: characterColors, settings };
            saveData();
            saveCharacterDebounced?.();
            toastr?.success?.('Saved to card');
        } catch { toastr?.error?.('Failed to save to card'); }
    }

    function loadFromCard() {
        try {
            const ctx = getContext();
            const charId = ctx?.characterId;
            if (charId === undefined) { toastr?.error?.('No character loaded'); return; }
            
            getCharacters?.().then(() => {
                const char = ctx?.characters?.[charId];
                const data = char?.data?.extensions?.dialogueColors;
                if (data?.colors) { 
                    characterColors = data.colors; 
                    if (data.settings) Object.assign(settings, data.settings); 
                    saveHistory(); 
                    saveData(); 
                    updateCharList(); 
                    injectPrompt(); 
                    toastr?.success?.('Loaded from card'); 
                } else {
                    toastr?.info?.('No saved colors in card');
                }
            }).catch(() => toastr?.error?.('Failed to reload character'));
        } catch { toastr?.error?.('Failed to load from card'); }
    }

    function tryLoadFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const data = char?.data?.extensions?.dialogueColors;
            if (data?.colors) {
                characterColors = data.colors;
                if (data.settings) Object.assign(settings, data.settings);
                saveHistory();
                saveData();
                console.log('Dialogue Colors: Loaded from card');
            }
        } catch {}
    }

    function parseColorBlock(element) {
        const mesText = element.querySelector?.('.mes_text') || element;
        if (!mesText) return false;
        const text = mesText.textContent;
        const html = mesText.innerHTML;
        console.log('[DC] Parsing, text length:', text?.length, 'html length:', html?.length);
        if (text?.includes('[COLOR')) console.log('[DC] Text snippet:', text.slice(text.indexOf('[COLOR'), text.indexOf('[COLOR') + 100));
        
        // Also check the full message element
        const fullText = element.textContent;
        if (fullText?.includes('[COLOR') && !text?.includes('[COLOR')) {
            console.log('[DC] Found in parent, not mes_text:', fullText.slice(fullText.indexOf('[COLOR'), fullText.indexOf('[COLOR') + 100));
        }
        
        const colorBlockRegex = /\[COLORS?:(.*?)\]/gis;
        let match, foundNew = false;
        const blocksToRemove = [];
        while ((match = colorBlockRegex.exec(text)) !== null) {
            console.log('[DC] Found:', match[0]);
            blocksToRemove.push(match[0]);
            const colorPairs = match[1].split(',');
            for (const pair of colorPairs) {
                const eqIdx = pair.indexOf('=');
                if (eqIdx === -1) continue;
                const name = pair.substring(0, eqIdx).trim();
                const color = pair.substring(eqIdx + 1).trim();
                if (!name || !color || !/^#[a-fA-F0-9]{6}$/i.test(color)) continue;
                const key = name.toLowerCase();
                if (characterColors[key]) {
                    characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1;
                    if (!characterColors[key].locked) characterColors[key].color = color;
                } else {
                    characterColors[key] = { color, name, locked: false, aliases: [], style: '', dialogueCount: 1 };
                    foundNew = true;
                }
            }
        }
        if (blocksToRemove.length) {
            let newHtml = mesText.innerHTML;
            blocksToRemove.forEach(block => { newHtml = newHtml.replace(block, ''); });
            mesText.innerHTML = newHtml;
        }
        return foundNew;
    }

    function scanAllMessages() {
        Object.values(characterColors).forEach(c => c.dialogueCount = 0);
        
        // Scan from chat data (raw messages before regex trimming)
        const ctx = getContext();
        const chat = ctx?.chat || [];
        const colorBlockRegex = /\[COLORS?:(.*?)\]/gis;
        let foundNew = false;
        
        for (const msg of chat) {
            const text = msg?.mes || '';
            let match;
            while ((match = colorBlockRegex.exec(text)) !== null) {
                console.log('[DC] Found in chat data:', match[0]);
                const colorPairs = match[1].split(',');
                for (const pair of colorPairs) {
                    const eqIdx = pair.indexOf('=');
                    if (eqIdx === -1) continue;
                    const name = pair.substring(0, eqIdx).trim();
                    const color = pair.substring(eqIdx + 1).trim();
                    if (!name || !color || !/^#[a-fA-F0-9]{6}$/i.test(color)) continue;
                    const key = name.toLowerCase();
                    if (characterColors[key]) {
                        characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1;
                        if (!characterColors[key].locked) characterColors[key].color = color;
                    } else {
                        characterColors[key] = { color, name, locked: settings.autoLockDetected !== false, aliases: [], style: '', dialogueCount: 1 };
                        foundNew = true;
                    }
                }
            }
        }
        
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        const conflicts = checkColorConflicts();
        if (conflicts.length) toastr?.warning?.(`Similar: ${conflicts.slice(0,3).map(c => c.join(' & ')).join(', ')}`);
        toastr?.info?.(`Found ${Object.keys(characterColors).length} characters`);
    }

    function onNewMessage() {
        if (!settings.enabled || !settings.autoScanNewMessages) return;
        setTimeout(() => { 
            const ctx = getContext();
            const chat = ctx?.chat || [];
            if (!chat.length) return;
            const lastMsg = chat[chat.length - 1];
            const text = lastMsg?.mes || '';
            const colorBlockRegex = /\[COLORS?:(.*?)\]/gis;
            let match;
            while ((match = colorBlockRegex.exec(text)) !== null) {
                const colorPairs = match[1].split(',');
                for (const pair of colorPairs) {
                    const eqIdx = pair.indexOf('=');
                    if (eqIdx === -1) continue;
                    const name = pair.substring(0, eqIdx).trim();
                    const color = pair.substring(eqIdx + 1).trim();
                    if (!name || !color || !/^#[a-fA-F0-9]{6}$/i.test(color)) continue;
                    const key = name.toLowerCase();
                    if (characterColors[key]) {
                        characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1;
                        if (!characterColors[key].locked) characterColors[key].color = color;
                    } else {
                        characterColors[key] = { color, name, locked: settings.autoLockDetected !== false, aliases: [], style: '', dialogueCount: 1 };
                    }
                }
            }
            saveData(); 
            updateCharList(); 
            injectPrompt(); 
        }, 600);
    }

    function addCharacter(name, color) {
        if (!name.trim()) return;
        const key = name.trim().toLowerCase();
        const suggested = color || suggestColorForName(name) || getNextColor();
        characterColors[key] = { color: suggested, name: name.trim(), locked: false, aliases: [], style: '', dialogueCount: 0 };
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function swapColors(key1, key2) {
        const tmp = characterColors[key1].color;
        characterColors[key1].color = characterColors[key2].color;
        characterColors[key2].color = tmp;
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function colorThoughts(element) {
        // Disabled - let the AI handle thought coloring via prompt instruction
    }

    function updateCharList() {
        const list = document.getElementById('dc-char-list'); if (!list) return;
        const entries = getSortedEntries();
        document.getElementById('dc-count').textContent = Object.keys(characterColors).length;
        list.innerHTML = entries.length ? entries.map(([k, v]) => `
            <div class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''}" data-key="${k}" style="display:flex;align-items:center;gap:4px;margin:3px 0;padding:2px;border-radius:4px;${swapMode === k ? 'background:var(--SmartThemeQuoteColor);' : ''}">
                <span style="width:8px;height:8px;border-radius:50%;background:${v.color};flex-shrink:0;"></span>
                <input type="color" value="${v.color}" data-key="${k}" style="width:18px;height:18px;padding:0;border:none;cursor:pointer;">
                <span style="flex:1;color:${v.color};font-size:0.85em;" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + v.aliases.join(', ') : ''}">${v.name}${v.style ? ` [${v.style[0].toUpperCase()}]` : ''}${getBadge(v.dialogueCount || 0)}</span>
                <span style="font-size:0.7em;opacity:0.6;">${v.dialogueCount || 0}</span>
                <button class="dc-lock menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Lock color">${v.locked ? '🔒' : '🔓'}</button>
                <button class="dc-swap menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Swap colors">⇄</button>
                <button class="dc-style menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Style">S</button>
                <button class="dc-alias menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Aliases">+</button>
                <button class="dc-del menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;">×</button>
            </div>`).join('') : '<small style="opacity:0.6;">No characters</small>';

        list.querySelectorAll('input[type="color"]').forEach(i => { i.oninput = () => { const c = characterColors[i.dataset.key]; c.color = i.value; c.aliases?.forEach(a => { const ak = a.toLowerCase(); if (characterColors[ak]) characterColors[ak].color = i.value; }); saveHistory(); saveData(); injectPrompt(); updateCharList(); }; });
        list.querySelectorAll('.dc-del').forEach(b => { b.onclick = () => { delete characterColors[b.dataset.key]; saveHistory(); saveData(); injectPrompt(); updateCharList(); }; });
        list.querySelectorAll('.dc-lock').forEach(b => { b.onclick = () => { characterColors[b.dataset.key].locked = !characterColors[b.dataset.key].locked; saveData(); updateCharList(); }; });
        list.querySelectorAll('.dc-swap').forEach(b => { b.onclick = () => {
            if (!swapMode) { swapMode = b.dataset.key; updateCharList(); toastr?.info?.('Click another character to swap'); }
            else if (swapMode === b.dataset.key) { swapMode = null; updateCharList(); }
            else { swapColors(swapMode, b.dataset.key); swapMode = null; }
        }; });
        list.querySelectorAll('.dc-style').forEach(b => { b.onclick = () => {
            const styles = ['', 'bold', 'italic', 'bold italic'];
            const curr = characterColors[b.dataset.key].style || '';
            characterColors[b.dataset.key].style = styles[(styles.indexOf(curr) + 1) % styles.length];
            saveData(); injectPrompt(); updateCharList();
        }; });
        list.querySelectorAll('.dc-alias').forEach(b => { b.onclick = () => {
            const alias = prompt('Add alias for ' + characterColors[b.dataset.key].name + ':');
            if (alias?.trim()) { characterColors[b.dataset.key].aliases = characterColors[b.dataset.key].aliases || []; characterColors[b.dataset.key].aliases.push(alias.trim()); saveData(); injectPrompt(); updateCharList(); }
        }; });
        updateLegend();
    }

    function autoAssignFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const key = char?.name?.toLowerCase();
            if (key && !characterColors[key]) {
                addCharacter(char.name);
                toastr?.success?.(`Added ${char.name}`);
            }
        } catch {}
    }

    function createUI() {
        if (document.getElementById('dc-ext')) return;
        const html = `
        <div id="dc-ext" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>Dialogue Colors</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content" style="padding:10px;display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
                <label class="checkbox_label"><input type="checkbox" id="dc-enabled"><span>Enable</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-highlight"><span>Highlight mode</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-autoscan"><span>Auto-scan on chat load</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-autoscan-new"><span>Auto-scan new messages</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-auto-lock"><span>Auto-lock detected characters</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-right-click"><span>Enable right-click context menu</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-legend"><span>Show floating legend</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-disable-narration"><span>Disable narration coloring</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-share-global"><span>Share colors across all chats</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-css-effects"><span>CSS effects (emotion/magic transforms)</span></label>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Theme:</label><select id="dc-theme" class="text_pole" style="flex:1;"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Palette:</label><select id="dc-palette" class="text_pole" style="flex:1;"><option value="pastel">Pastel</option><option value="neon">Neon</option><option value="earth">Earth</option><option value="jewel">Jewel</option><option value="muted">Muted</option><option value="jade">Jade</option><option value="forest">Forest</option><option value="ocean">Ocean</option><option value="sunset">Sunset</option><option value="aurora">Aurora</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="berry">Berry</option><option value="monochrome">Monochrome</option><option value="protanopia">Protanopia</option><option value="deuteranopia">Deuteranopia</option><option value="tritanopia">Tritanopia</option></select></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Bright:</label><input type="range" id="dc-brightness" min="-30" max="30" value="0" style="flex:1;"><span id="dc-bright-val">0</span></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Narr:</label><input type="color" id="dc-narrator" value="#888888" style="width:24px;height:20px;"><button id="dc-narrator-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;"><label style="width:50px;" title="Symbols for inner thoughts (*「etc)">Think:</label><input type="text" id="dc-thought-symbols" placeholder="*" class="text_pole" style="width:60px;padding:3px;"><button id="dc-thought-add" class="menu_button" style="padding:2px 6px;font-size:0.8em;">+</button><button id="dc-thought-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                <hr style="margin:2px 0;opacity:0.2;">
                <div style="display:flex;gap:4px;"><button id="dc-scan" class="menu_button" style="flex:1;">Scan</button><button id="dc-clear" class="menu_button" style="flex:1;">Clear</button><button id="dc-stats" class="menu_button" style="flex:1;" title="Dialogue statistics">Stats</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-undo" class="menu_button" style="flex:1;">↶</button><button id="dc-redo" class="menu_button" style="flex:1;">↷</button><button id="dc-fix-conflicts" class="menu_button" style="flex:1;" title="Auto-fix color conflicts">Fix</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-regen" class="menu_button" style="flex:1;" title="Regenerate all colors">Regen</button><button id="dc-save-preset" class="menu_button" style="flex:1;" title="Save color preset">Preset↓</button><button id="dc-load-preset" class="menu_button" style="flex:1;" title="Load color preset">Preset↑</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-export" class="menu_button" style="flex:1;">Export</button><button id="dc-import" class="menu_button" style="flex:1;">Import</button><button id="dc-export-png" class="menu_button" style="flex:1;" title="Export legend as image">PNG</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-card" class="menu_button" style="flex:1;" title="Add from card">+Card</button><button id="dc-avatar-color" class="menu_button" style="flex:1;" title="Suggest color from avatar">Avatar</button><button id="dc-save-card" class="menu_button" style="flex:1;" title="Save to card">Save→Card</button><button id="dc-load-card" class="menu_button" style="flex:1;" title="Load from card">Card→Load</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-del-locked" class="menu_button" style="flex:1;" title="Delete all locked characters">DelLocked</button><button id="dc-del-unlocked" class="menu_button" style="flex:1;" title="Delete all unlocked characters">DelUnlocked</button><button id="dc-reset" class="menu_button" style="flex:1;" title="Reset to default colors">Reset</button></div>
                <input type="file" id="dc-import-file" accept=".json" style="display:none;">
                <div style="display:flex;gap:4px;"><input type="text" id="dc-search" placeholder="Search characters..." class="text_pole" style="flex:1;padding:3px;"></div>
                <div style="display:flex;gap:4px;align-items:center;"><label>Sort:</label><select id="dc-sort" class="text_pole" style="flex:1;"><option value="name">Name</option><option value="count">Dialogue Count</option></select></div>
                <div style="display:flex;gap:4px;"><input type="text" id="dc-add-name" placeholder="Add character..." class="text_pole" style="flex:1;padding:3px;"><button id="dc-add-btn" class="menu_button" style="padding:3px 8px;">+</button></div>
                <small>Characters: <span id="dc-count">0</span> (⭐=50+, 💎=100+)</small>
                <div id="dc-char-list" style="max-height:150px;overflow-y:auto;"></div>
                <hr style="margin:2px 0;opacity:0.2;">
                <small>Preview:</small>
                <div id="dc-prompt-preview" style="font-size:0.75em;max-height:40px;overflow-y:auto;padding:3px;background:var(--SmartThemeBlurTintColor);border-radius:3px;"></div>
            </div>
        </div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);

        const $ = id => document.getElementById(id);
        $('dc-enabled').checked = settings.enabled; $('dc-enabled').onchange = e => { settings.enabled = e.target.checked; saveData(); injectPrompt(); };
        $('dc-highlight').checked = settings.highlightMode; $('dc-highlight').onchange = e => { settings.highlightMode = e.target.checked; saveData(); injectPrompt(); };
        $('dc-autoscan').checked = settings.autoScanOnLoad !== false; $('dc-autoscan').onchange = e => { settings.autoScanOnLoad = e.target.checked; saveData(); };
        $('dc-autoscan-new').checked = settings.autoScanNewMessages !== false; $('dc-autoscan-new').onchange = e => { settings.autoScanNewMessages = e.target.checked; saveData(); };
        $('dc-auto-lock').checked = settings.autoLockDetected !== false; $('dc-auto-lock').onchange = e => { settings.autoLockDetected = e.target.checked; saveData(); };
        $('dc-right-click').checked = settings.enableRightClick; $('dc-right-click').onchange = e => { settings.enableRightClick = e.target.checked; saveData(); };
        $('dc-legend').checked = settings.showLegend; $('dc-legend').onchange = e => { settings.showLegend = e.target.checked; saveData(); updateLegend(); };
        $('dc-disable-narration').checked = settings.disableNarration !== false; $('dc-disable-narration').onchange = e => { settings.disableNarration = e.target.checked; saveData(); injectPrompt(); };
        $('dc-share-global').checked = settings.shareColorsGlobally || false; $('dc-share-global').onchange = e => { settings.shareColorsGlobally = e.target.checked; saveData(); loadData(); updateCharList(); injectPrompt(); };
        $('dc-css-effects').checked = settings.cssEffects || false; $('dc-css-effects').onchange = e => { settings.cssEffects = e.target.checked; saveData(); injectPrompt(); };
        $('dc-theme').value = settings.themeMode; $('dc-theme').onchange = e => { settings.themeMode = e.target.value; invalidateThemeCache(); saveData(); injectPrompt(); };
        $('dc-palette').value = settings.colorTheme; $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); };
        $('dc-brightness').value = settings.brightness || 0; $('dc-bright-val').textContent = settings.brightness || 0;
        $('dc-brightness').oninput = e => { settings.brightness = parseInt(e.target.value); $('dc-bright-val').textContent = e.target.value; saveData(); invalidateThemeCache(); injectPrompt(); };
        $('dc-narrator').value = settings.narratorColor || '#888888'; $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); };
        $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); };
        $('dc-thought-symbols').value = settings.thoughtSymbols || '';
        $('dc-thought-symbols').oninput = e => { settings.thoughtSymbols = e.target.value; saveData(); injectPrompt(); };
        $('dc-thought-add').onclick = () => { const s = prompt('Add thought symbol (e.g., *, 「, 『):'); if (s?.trim()) { settings.thoughtSymbols = (settings.thoughtSymbols || '') + s.trim(); $('dc-thought-symbols').value = settings.thoughtSymbols; saveData(); injectPrompt(); document.querySelectorAll('.mes').forEach(m => colorThoughts(m)); } };
        $('dc-thought-clear').onclick = () => { settings.thoughtSymbols = ''; $('dc-thought-symbols').value = ''; saveData(); injectPrompt(); };
        $('dc-scan').onclick = scanAllMessages;
        $('dc-clear').onclick = () => { characterColors = {}; saveHistory(); saveData(); injectPrompt(); updateCharList(); };
        $('dc-stats').onclick = showStatsPopup;
        $('dc-fix-conflicts').onclick = autoResolveConflicts;
        $('dc-regen').onclick = regenerateAllColors;
        $('dc-save-preset').onclick = saveColorPreset;
        $('dc-load-preset').onclick = loadColorPreset;
        $('dc-card').onclick = autoAssignFromCard;
        $('dc-avatar-color').onclick = async () => {
            try {
                const ctx = getContext();
                const char = ctx?.characters?.[ctx?.characterId];
                if (!char?.avatar) { toastr?.info?.('No avatar found'); return; }
                const avatarUrl = `/characters/${encodeURIComponent(char.avatar)}`;
                const color = await extractAvatarColor(avatarUrl);
                if (color) {
                    const key = char.name.toLowerCase();
                    if (characterColors[key]) {
                        characterColors[key].color = color;
                    } else {
                        characterColors[key] = { color, name: char.name, locked: false, aliases: [], style: '', dialogueCount: 0 };
                    }
                    saveHistory(); saveData(); updateCharList(); injectPrompt();
                    toastr?.success?.(`Set ${char.name} to ${color}`);
                } else {
                    toastr?.error?.('Could not extract color');
                }
            } catch (e) { toastr?.error?.('Failed to extract avatar color'); }
        };
        $('dc-save-card').onclick = saveToCard;
        $('dc-load-card').onclick = loadFromCard;
        $('dc-undo').onclick = undo; $('dc-redo').onclick = redo;
        $('dc-export').onclick = exportColors;
        $('dc-import').onclick = () => $('dc-import-file').click();
        $('dc-export-png').onclick = exportLegendPng;
        $('dc-import-file').onchange = e => { if (e.target.files[0]) importColors(e.target.files[0]); };
        $('dc-del-locked').onclick = () => { let count = 0; Object.keys(characterColors).forEach(k => { if (characterColors[k].locked) { delete characterColors[k]; count++; } }); saveHistory(); saveData(); injectPrompt(); updateCharList(); toastr?.info?.(`Deleted ${count} locked characters`); };
        $('dc-del-unlocked').onclick = () => { let count = 0; Object.keys(characterColors).forEach(k => { if (!characterColors[k].locked) { delete characterColors[k]; count++; } }); saveHistory(); saveData(); injectPrompt(); updateCharList(); toastr?.info?.(`Deleted ${count} unlocked characters`); };
        $('dc-reset').onclick = () => { if (confirm('Reset all colors?')) { Object.values(characterColors).forEach(c => { if (!c.locked) c.color = getNextColor(); }); saveHistory(); saveData(); updateCharList(); injectPrompt(); } };
        $('dc-search').oninput = e => { searchTerm = e.target.value; updateCharList(); };
        $('dc-sort').onchange = e => { sortMode = e.target.value; updateCharList(); };
        $('dc-add-btn').onclick = () => { addCharacter($('dc-add-name').value); $('dc-add-name').value = ''; };
        $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };
        
        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); redo(); }
        });
        
        updateCharList();
        injectPrompt();
    }

    globalThis.DialogueColorsInterceptor = async function(chat, contextSize, abort, type) { if (type !== 'quiet' && settings.enabled) injectPrompt(); };

    console.log('Dialogue Colors: Initializing...');
    
    function init() {
        loadData(); 
        // Delay regex import to ensure extension_settings is ready
        setTimeout(() => ensureRegexScript(), 1000);
        setupContextMenu();
        
        let waitAttempts = 0;
        const waitUI = setInterval(() => { 
            waitAttempts++;
            if (document.getElementById('extensions_settings')) { 
                clearInterval(waitUI); 
                createUI(); 
                injectPrompt(); 
            } else if (waitAttempts > 60) {
                clearInterval(waitUI);
            }
        }, 500);
    }
    
    setTimeout(init, 100);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => injectPrompt());
    eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const currentCharKey = getCharKey();
        if (currentCharKey !== lastCharKey) {
            loadData();
            if (!Object.keys(characterColors).length) tryLoadFromCard();
            lastCharKey = currentCharKey;
            // Sync UI with loaded settings
            const $ = id => document.getElementById(id);
            if ($('dc-thought-symbols')) $('dc-thought-symbols').value = settings.thoughtSymbols || '';
            if ($('dc-narrator')) $('dc-narrator').value = settings.narratorColor || '#888888';
            if ($('dc-brightness')) { $('dc-brightness').value = settings.brightness || 0; $('dc-bright-val').textContent = settings.brightness || 0; }
            if ($('dc-enabled')) $('dc-enabled').checked = settings.enabled;
            if ($('dc-palette')) $('dc-palette').value = settings.colorTheme;
            if ($('dc-theme')) $('dc-theme').value = settings.themeMode;
        }
        updateCharList();
        injectPrompt();
        if (settings.autoScanOnLoad !== false && !Object.keys(characterColors).length) {
            setTimeout(() => { if (document.querySelectorAll('.mes').length) scanAllMessages(); }, 1000);
        }
    });
    console.log('Dialogue Colors: Ready!');
})();
