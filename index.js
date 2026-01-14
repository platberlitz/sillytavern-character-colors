(async function() {
    'use strict';
    
    const { extension_settings, saveSettingsDebounced, getContext } = await import('../../../extensions.js');
    const { eventSource, event_types, setExtensionPrompt } = await import('../../../../script.js');

    const MODULE_NAME = 'dialogue-colors';
    let characterColors = {};
    let currentChatId = null;
    let settings = { enabled: true, themeMode: 'auto', narratorColor: '', colorTheme: 'pastel' };

    const COLOR_THEMES = {
        pastel: [[340,70,75],[200,70,75],[120,50,70],[45,80,70],[280,60,75],[170,60,70],[20,80,75],[240,60,75]],
        neon: [[320,100,60],[180,100,50],[90,100,50],[45,100,55],[270,100,60],[150,100,45],[0,100,60],[210,100,55]],
        earth: [[25,50,55],[45,40,50],[90,30,45],[150,35,45],[180,30,50],[30,60,60],[60,35,55],[120,25,50]],
        jewel: [[340,70,45],[200,80,40],[150,70,40],[45,80,50],[280,70,45],[170,70,40],[0,75,50],[220,75,45]],
        muted: [[350,30,60],[200,30,55],[120,25,55],[45,35,60],[280,25,55],[170,30,55],[20,35,60],[240,25,55]]
    };

    function hslToHex(h, s, l) {
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
        let r = parseInt(hex.slice(1,3), 16) / 255;
        let g = parseInt(hex.slice(3,5), 16) / 255;
        let b = parseInt(hex.slice(5,7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) { h = s = 0; }
        else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
                case g: h = ((b - r) / d + 2) * 60; break;
                case b: h = ((r - g) / d + 4) * 60; break;
            }
        }
        return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
    }

    function getNextColor() {
        const theme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES.pastel;
        const usedColors = Object.values(characterColors).map(c => c.color);
        const isDark = detectTheme() === 'dark';
        
        for (const [h, s, l] of theme) {
            const adjustedL = isDark ? Math.min(l + 15, 85) : Math.max(l - 15, 35);
            const color = hslToHex(h, s, adjustedL);
            if (!usedColors.includes(color)) return color;
        }
        // Fallback: random color
        const [h, s, l] = theme[Math.floor(Math.random() * theme.length)];
        const adjustedL = isDark ? Math.min(l + 15, 85) : Math.max(l - 15, 35);
        return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, adjustedL);
    }

    function checkColorConflicts() {
        const colors = Object.entries(characterColors);
        const conflicts = [];
        for (let i = 0; i < colors.length; i++) {
            for (let j = i + 1; j < colors.length; j++) {
                const [h1, s1, l1] = hexToHsl(colors[i][1].color);
                const [h2, s2, l2] = hexToHsl(colors[j][1].color);
                const hDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
                if (hDiff < 25 && Math.abs(l1 - l2) < 15) {
                    conflicts.push([colors[i][1].name, colors[j][1].name]);
                }
            }
        }
        return conflicts;
    }

    function detectTheme() {
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = bg.match(/\d+/g);
        if (m) {
            const brightness = (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000;
            return brightness < 128 ? 'dark' : 'light';
        }
        return 'dark';
    }

    function getStorageKey() { return `dc_${currentChatId}`; }

    function saveData() {
        if (currentChatId) localStorage.setItem(getStorageKey(), JSON.stringify({ colors: characterColors, settings }));
    }

    function loadData() {
        characterColors = {};
        if (currentChatId) {
            try {
                const data = JSON.parse(localStorage.getItem(getStorageKey()));
                if (data?.colors) characterColors = data.colors;
                if (data?.settings) Object.assign(settings, data.settings);
            } catch (e) {}
        }
    }

    function exportColors() {
        const data = JSON.stringify({ colors: characterColors, settings }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dialogue-colors-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importColors(file) {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.colors) characterColors = data.colors;
                if (data.settings) Object.assign(settings, data.settings);
                saveData();
                updateCharList();
                injectPrompt();
                toastr?.success?.('Colors imported!');
            } catch { toastr?.error?.('Invalid file'); }
        };
        reader.readAsText(file);
    }

    function getChatId() {
        try {
            const ctx = getContext();
            return ctx?.chatId || ctx?.chatID || null;
        } catch { return null; }
    }

    function ensureRegexScript() {
        const SCRIPT_NAME = 'Trim Font Colors';
        if (!extension_settings) return;
        if (!Array.isArray(extension_settings.regex)) extension_settings.regex = [];
        if (extension_settings.regex.some(r => r.scriptName === SCRIPT_NAME)) return;
        
        extension_settings.regex.push({
            id: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            }),
            scriptName: SCRIPT_NAME,
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
        saveSettingsDebounced();
    }

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark' ? 'Use light pastel colors (#RRGGBB with high lightness).' : 'Use dark muted colors (#RRGGBB with low lightness).';
        const colorList = Object.entries(characterColors).length > 0
            ? `ASSIGNED COLORS (use exactly): ${Object.entries(characterColors).map(([k, v]) => `${v.name}=${v.color}`).join(', ')}. `
            : '';
        const narratorHint = settings.narratorColor ? `Use ${settings.narratorColor} for narrator/action text (*asterisks*). ` : '';
        return `[Font Color Rule: Wrap ALL dialogue in <font color=#RRGGBB> tags. Includes: "quotes", 'single', 「Japanese」, 『brackets』, «guillemets», *thoughts*. ${themeHint} ${colorList}${narratorHint}Each character has ONE consistent color. New characters get new unique colors.]`;
    }

    function injectPrompt() {
        const prompt = settings.enabled ? buildPromptInstruction() : '';
        setExtensionPrompt(MODULE_NAME, prompt, 1, 0);
        updatePromptPreview(prompt);
    }

    function updatePromptPreview(prompt) {
        const preview = document.getElementById('dc-prompt-preview');
        if (preview) preview.textContent = prompt || '(disabled)';
    }

    function scanForColors(element) {
        const mesText = element.querySelector ? element.querySelector('.mes_text') : element;
        if (!mesText) return false;
        
        const blocklist = new Set(['she','he','they','it','i','you','we','her','him','them','his','hers','its','their','theirs','one','someone','anyone','everyone','nobody','somebody','anybody','everybody','the','a','an','this','that','these','those','what','who','where','when','why','how','something','nothing','everything','anything','dark','light','through','between','around','behind','before','after','during','and','but','or','nor','for','yet','so','if','then','than','because','while','your','my','our','their','some','any','no','every','each','all','both','few','many','most','other','another','such','only','own','same','well','much','more','less','first','last','next','new','old','good','great','little','big','small','long','short','high','low','right','left','hand','hands','eyes','face','head','voice','door','room','way','time','day','night','world','man','woman','people','thing','place','despite','still','just','even','also','very','too','quite','rather','really','almost','already','always','never','often','sometimes','here','there','now','today','soon','later','again','back','away','down','out','off','let','secret','papers','three','two','being','look','want','need','know','think','see','come','go','get','make','take','give','find','tell','ask','use','seem','leave','call','keep','put','mean','become','begin','feel','try','start','show','hear','play','run','move','live','believe','hold','bring','happen','write','sit','stand','lose','pay','meet','include','continue','set','learn','change','lead','understand','watch','follow','stop','create','speak','read','spend','grow','open','walk','win','teach','offer','remember','consider','appear','buy','wait','serve','die','send','build','stay','fall','cut','reach','kill','remain','suggest','raise','pass','sell','require','report','decide','pull','unlike','personally','actually','obviously','apparently','certainly','probably','possibly','maybe','perhaps','definitely','clearly','simply','basically','essentially','generally','usually','typically','normally','finally','eventually','suddenly','immediately','quickly','slowly','carefully','exactly','completely','entirely','absolutely','totally','fully','partly','mostly','nearly','hardly','barely','merely','only','just','even','still','already','yet','soon','once','twice','often','always','never','sometimes','usually','rarely','seldom','frequently','occasionally','constantly','continuously','repeatedly','gradually','increasingly','slightly','somewhat','rather','quite','pretty','very','too','enough','almost','nearly','about','around','approximately','exactly','precisely','specifically','particularly','especially','mainly','primarily','largely','mostly','partly','half','both','either','neither','each','every','any','some','no','none','all','whole','entire','total','full','empty','single','double','triple','multiple','various','several','few','many','much','more','most','less','least','little','big','small','large','huge','tiny','long','short','tall','wide','narrow','deep','shallow','thick','thin','heavy','light','hard','soft','hot','cold','warm','cool','dry','wet','clean','dirty','clear','dark','bright','loud','quiet','fast','slow','high','low','strong','weak','young','old','new','fresh','early','late','easy','difficult','simple','complex','important','necessary','possible','impossible','certain','sure','true','false','real','fake','right','wrong','good','bad','best','worst','better','worse','same','different','similar','other','another','next','last','first','second','third','final','previous','following','current','present','past','future','recent','ancient','modern','traditional','original','special','general','common','rare','usual','unusual','normal','strange','familiar','foreign','local','national','international','public','private','personal','social','political','economic','financial','legal','official','professional','technical','scientific','medical','military','religious','cultural','natural','physical','mental','emotional','spiritual','moral','ethical','practical','theoretical','basic','advanced','main','major','minor','central','key','critical','essential','vital','crucial','significant','serious','severe','minor','slight','obvious','apparent','evident','visible','hidden','secret','mysterious','unknown','famous','popular','successful','powerful','wealthy','poor','rich','beautiful','ugly','pretty','handsome','cute','lovely','wonderful','amazing','incredible','fantastic','terrible','horrible','awful','dreadful','pleasant','unpleasant','comfortable','uncomfortable','convenient','inconvenient','useful','useless','helpful','harmful','safe','dangerous','healthy','sick','alive','dead','awake','asleep','aware','unaware','conscious','unconscious','careful','careless','patient','impatient','polite','rude','kind','cruel','gentle','rough','calm','nervous','angry','happy','sad','excited','bored','interested','surprised','confused','worried','afraid','proud','ashamed','guilty','innocent','honest','dishonest','loyal','faithful','brave','cowardly','wise','foolish','smart','stupid','clever','dumb','talented','skilled','experienced','qualified','capable','unable','willing','unwilling','ready','prepared','busy','free','available','unavailable','open','closed','empty','full','complete','incomplete','perfect','imperfect','correct','incorrect','accurate','inaccurate','exact','approximate','precise','vague','clear','unclear','obvious','obscure','plain','fancy','simple','complicated','easy','hard','difficult','impossible','possible','probable','unlikely','certain','uncertain','sure','unsure','confident','doubtful','hopeful','hopeless','optimistic','pessimistic','realistic','idealistic','practical','impractical','reasonable','unreasonable','logical','illogical','rational','irrational','sensible','foolish','wise','unwise','fair','unfair','just','unjust','equal','unequal','balanced','unbalanced','stable','unstable','steady','unsteady','secure','insecure','permanent','temporary','constant','variable','regular','irregular','consistent','inconsistent','uniform','diverse','standard','custom','typical','atypical','ordinary','extraordinary','average','exceptional','normal','abnormal','natural','unnatural','artificial','genuine','authentic','fake','real','imaginary','actual','potential','virtual','physical','mental','emotional','spiritual','material','immaterial','tangible','intangible','visible','invisible','audible','inaudible','edible','inedible','readable','unreadable','believable','unbelievable','acceptable','unacceptable','tolerable','intolerable','bearable','unbearable','manageable','unmanageable','controllable','uncontrollable','predictable','unpredictable','reliable','unreliable','dependable','undependable','trustworthy','untrustworthy','responsible','irresponsible','accountable','unaccountable','answerable','unanswerable','questionable','unquestionable','debatable','undebatable','arguable','unarguable','disputable','indisputable','contestable','incontestable','deniable','undeniable','refutable','irrefutable','provable','unprovable','verifiable','unverifiable','testable','untestable','measurable','immeasurable','countable','uncountable','calculable','incalculable','estimable','inestimable','valuable','invaluable','worthless','priceless','costly','cheap','expensive','affordable','unaffordable','economical','uneconomical','profitable','unprofitable','productive','unproductive','efficient','inefficient','effective','ineffective','successful','unsuccessful','fruitful','fruitless','rewarding','unrewarding','satisfying','unsatisfying','fulfilling','unfulfilling','meaningful','meaningless','purposeful','purposeless','intentional','unintentional','deliberate','accidental','voluntary','involuntary','willing','unwilling','eager','reluctant','enthusiastic','unenthusiastic','motivated','unmotivated','inspired','uninspired','creative','uncreative','imaginative','unimaginative','innovative','conventional','original','unoriginal','unique','common','rare','frequent','occasional','periodic','sporadic','continuous','discontinuous','constant','intermittent','regular','irregular','steady','unsteady','stable','unstable','fixed','variable','permanent','temporary','lasting','fleeting','enduring','transient','eternal','mortal','infinite','finite','unlimited','limited','boundless','bounded','endless','ending','beginning','middle','end','start','finish','opening','closing','introduction','conclusion','summary','detail','overview','outline','draft','final','preliminary','definitive','tentative','provisional','conditional','unconditional','absolute','relative','total','partial','complete','incomplete','whole','part','full','empty','maximum','minimum','optimal','suboptimal','ideal','real','perfect','imperfect','exact','approximate','precise','rough','accurate','inaccurate','correct','incorrect','right','wrong','true','false','valid','invalid','legitimate','illegitimate','legal','illegal','lawful','unlawful','official','unofficial','formal','informal','proper','improper','appropriate','inappropriate','suitable','unsuitable','fitting','unfitting','becoming','unbecoming','seemly','unseemly','decent','indecent','modest','immodest','humble','proud','arrogant','modest','bold','timid','brave','cowardly','courageous','fearful','confident','insecure','assured','doubtful','certain','uncertain','positive','negative','optimistic','pessimistic','hopeful','hopeless','cheerful','gloomy','bright','dark','sunny','cloudy','clear','foggy','warm','cold','hot','cool','mild','extreme','moderate','severe','gentle','harsh','soft','hard','smooth','rough','even','uneven','flat','bumpy','straight','curved','round','square','circular','rectangular','triangular','spherical','cylindrical','conical','pyramidal','cubic','linear','angular','parallel','perpendicular','horizontal','vertical','diagonal','oblique','acute','obtuse','right','left','front','back','top','bottom','upper','lower','inner','outer','central','peripheral','internal','external','interior','exterior','inside','outside','indoor','outdoor','underground','aboveground','underwater','above']);
        
        const html = mesText.innerHTML;
        const fontRegex = /<font\s+color=["']?#([a-fA-F0-9]{6})["']?[^>]*>([\s\S]*?)<\/font>/gi;
        let match, foundNew = false;
        
        while ((match = fontRegex.exec(html)) !== null) {
            const color = '#' + match[1];
            const tagStart = match.index;
            const tagEnd = match.index + match[0].length;
            
            // Get text before, strip HTML tags for cleaner parsing
            const beforeHtml = html.substring(Math.max(0, tagStart - 400), tagStart);
            const beforeText = beforeHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            const afterHtml = html.substring(tagEnd, Math.min(html.length, tagEnd + 150));
            const afterText = afterHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            
            let speaker = null;
            
            // Method 1: "Name said," pattern before dialogue
            const beforeVerb = beforeText.match(/([A-Z][a-z]{2,})\s+(?:said|says|replied|replies|asked|asks|whispered|whispers|yelled|yells|shouted|shouts|exclaimed|exclaims|murmured|murmurs|muttered|mutters|answered|answers|called|calls|cried|cries|chirped|chirps|purred|purrs|announced|announces|spoke|speaks|stated|states|remarked|remarks|commented|comments|explained|explains|declared|declares|demanded|demands|warned|warns|laughed|laughs|sighed|sighs|groaned|groans|growled|growls|hissed|hisses|snapped|snaps|screamed|screams|mumbled|mumbles|breathed|breathes|gasped|gasps|huffed|huffs|scoffed|scoffs|offers|offered|adds|added|notes|noted|continues|continued)[,.:]*\s*["'"「『«]?\s*$/i);
            if (beforeVerb) speaker = beforeVerb[1];
            
            // Method 2: "..." Name said pattern after dialogue
            if (!speaker) {
                const afterVerb = afterText.match(/^["'"」』»]?\s*([A-Z][a-z]{2,})\s+(?:said|says|replied|replies|asked|asks|whispered|whispers|yelled|yells|shouted|shouts|exclaimed|exclaims|murmured|murmurs|muttered|mutters|answered|answers|called|calls|cried|cries|chirped|chirps|purred|purrs|announced|announces|spoke|speaks|stated|states|remarked|remarks|commented|comments|explained|explains|declared|declares|demanded|demands|warned|warns|laughed|laughs|sighed|sighs|groaned|groans|growled|growls|hissed|hisses|snapped|snaps|screamed|screams|mumbled|mumbles|breathed|breathes|gasped|gasps|huffed|huffs|scoffed|scoffs|offers|offered|adds|added|notes|noted|continues|continued)/i);
                if (afterVerb) speaker = afterVerb[1];
            }
            
            // Method 3: Find Name at start of recent sentence (last 2 sentences before dialogue)
            if (!speaker) {
                const sentences = beforeText.split(/[.!?]+\s*/);
                for (let i = sentences.length - 1; i >= Math.max(0, sentences.length - 2); i--) {
                    const s = sentences[i].trim();
                    const nameMatch = s.match(/^([A-Z][a-z]{2,})\b/);
                    if (nameMatch && !blocklist.has(nameMatch[1].toLowerCase())) {
                        speaker = nameMatch[1];
                        break;
                    }
                }
            }
            
            if (speaker && !blocklist.has(speaker.toLowerCase())) {
                const key = speaker.toLowerCase();
                if (!characterColors[key]) {
                    characterColors[key] = { color, name: speaker };
                    foundNew = true;
                    console.log('Dialogue Colors: Found', speaker, color);
                }
            }
        }
        return foundNew;
    }

    function scanAllMessages() {
        document.querySelectorAll('.mes').forEach(m => scanForColors(m));
        saveData();
        updateCharList();
        injectPrompt();
        
        const conflicts = checkColorConflicts();
        if (conflicts.length > 0) {
            toastr?.warning?.(`Similar colors: ${conflicts.map(c => c.join(' & ')).join(', ')}`);
        }
        toastr?.info?.(`Found ${Object.keys(characterColors).length} characters`);
    }

    function onNewMessage() {
        if (!settings.enabled) return;
        setTimeout(() => {
            const messages = document.querySelectorAll('.mes');
            if (messages.length === 0) return;
            const foundNew = scanForColors(messages[messages.length - 1]);
            saveData();
            updateCharList();
            injectPrompt();
            if (foundNew) console.log('Dialogue Colors: New character detected');
        }, 600);
    }

    function addCharacter(name, color) {
        if (!name.trim()) return;
        const key = name.trim().toLowerCase();
        characterColors[key] = { color: color || getNextColor(), name: name.trim() };
        saveData();
        updateCharList();
        injectPrompt();
    }

    function updateCharList() {
        const list = document.getElementById('dc-char-list');
        if (!list) return;
        const entries = Object.entries(characterColors);
        
        list.innerHTML = entries.length ? entries.map(([k, v]) =>
            `<div style="display:flex;align-items:center;gap:5px;margin:3px 0;">
                <span style="width:8px;height:8px;border-radius:50%;background:${v.color};flex-shrink:0;"></span>
                <input type="color" value="${v.color}" data-key="${k}" style="width:20px;height:20px;padding:0;border:none;cursor:pointer;">
                <span style="flex:1;color:${v.color};font-size:0.9em;">${v.name}</span>
                <button class="dc-del menu_button" data-key="${k}" style="padding:2px 6px;font-size:0.7em;">×</button>
            </div>`
        ).join('') : '<small style="opacity:0.6;">No characters yet</small>';

        list.querySelectorAll('input[type="color"]').forEach(i => {
            i.oninput = () => {
                characterColors[i.dataset.key].color = i.value;
                saveData();
                injectPrompt();
                updateCharList();
            };
        });
        list.querySelectorAll('.dc-del').forEach(btn => {
            btn.onclick = () => {
                delete characterColors[btn.dataset.key];
                saveData();
                injectPrompt();
                updateCharList();
            };
        });
    }

    function createUI() {
        if (document.getElementById('dc-ext')) return;
        const html = `
        <div id="dc-ext" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Dialogue Colors</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;display:flex;flex-direction:column;gap:8px;">
                <label class="checkbox_label"><input type="checkbox" id="dc-enabled"><span>Enable</span></label>
                
                <div style="display:flex;gap:5px;align-items:center;">
                    <label style="flex-shrink:0;">Theme:</label>
                    <select id="dc-theme" style="flex:1;"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
                </div>
                
                <div style="display:flex;gap:5px;align-items:center;">
                    <label style="flex-shrink:0;">Palette:</label>
                    <select id="dc-palette" style="flex:1;">
                        <option value="pastel">Pastel</option>
                        <option value="neon">Neon</option>
                        <option value="earth">Earth</option>
                        <option value="jewel">Jewel</option>
                        <option value="muted">Muted</option>
                    </select>
                </div>
                
                <div style="display:flex;gap:5px;align-items:center;">
                    <label style="flex-shrink:0;">Narrator:</label>
                    <input type="color" id="dc-narrator" value="#888888" style="width:30px;height:24px;padding:0;border:none;">
                    <button id="dc-narrator-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button>
                </div>
                
                <hr style="margin:4px 0;opacity:0.3;">
                
                <div style="display:flex;gap:5px;">
                    <button id="dc-scan" class="menu_button" style="flex:1;">Scan All</button>
                    <button id="dc-clear" class="menu_button" style="flex:1;">Clear</button>
                </div>
                
                <div style="display:flex;gap:5px;">
                    <input type="text" id="dc-add-name" placeholder="Add character..." style="flex:1;padding:4px;border:1px solid var(--SmartThemeBorderColor);background:var(--SmartThemeBlurTintColor);color:var(--SmartThemeBodyColor);border-radius:4px;">
                    <button id="dc-add-btn" class="menu_button" style="padding:4px 8px;">+</button>
                </div>
                
                <small>Characters:</small>
                <div id="dc-char-list" style="max-height:120px;overflow-y:auto;"></div>
                
                <hr style="margin:4px 0;opacity:0.3;">
                
                <div style="display:flex;gap:5px;">
                    <button id="dc-export" class="menu_button" style="flex:1;font-size:0.85em;">Export</button>
                    <button id="dc-import" class="menu_button" style="flex:1;font-size:0.85em;">Import</button>
                </div>
                <input type="file" id="dc-import-file" accept=".json" style="display:none;">
                
                <hr style="margin:4px 0;opacity:0.3;">
                <small>Prompt:</small>
                <div id="dc-prompt-preview" style="font-size:0.7em;max-height:50px;overflow-y:auto;padding:4px;background:var(--SmartThemeBlurTintColor);border-radius:4px;opacity:0.8;"></div>
            </div>
        </div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);

        // Event handlers
        const $ = id => document.getElementById(id);
        
        $('dc-enabled').checked = settings.enabled;
        $('dc-enabled').onchange = e => { settings.enabled = e.target.checked; saveData(); injectPrompt(); };
        
        $('dc-theme').value = settings.themeMode;
        $('dc-theme').onchange = e => { settings.themeMode = e.target.value; saveData(); injectPrompt(); };
        
        $('dc-palette').value = settings.colorTheme || 'pastel';
        $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); };
        
        $('dc-narrator').value = settings.narratorColor || '#888888';
        $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); };
        $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); };
        
        $('dc-scan').onclick = scanAllMessages;
        $('dc-clear').onclick = () => { characterColors = {}; saveData(); injectPrompt(); updateCharList(); };
        
        $('dc-add-btn').onclick = () => {
            const input = $('dc-add-name');
            addCharacter(input.value);
            input.value = '';
        };
        $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };
        
        $('dc-export').onclick = exportColors;
        $('dc-import').onclick = () => $('dc-import-file').click();
        $('dc-import-file').onchange = e => { if (e.target.files[0]) importColors(e.target.files[0]); };
        
        updateCharList();
        updatePromptPreview(buildPromptInstruction());
    }

    globalThis.DialogueColorsInterceptor = async function(chat, contextSize, abort, type) {
        if (type === 'quiet' || !settings.enabled) return;
        injectPrompt();
    };

    // Initialize
    console.log('Dialogue Colors: Initializing...');
    currentChatId = getChatId();
    loadData();
    ensureRegexScript();

    const waitForUI = setInterval(() => {
        if (document.getElementById('extensions_settings')) {
            clearInterval(waitForUI);
            createUI();
            injectPrompt();
        }
    }, 500);

    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => injectPrompt());
    eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        currentChatId = getChatId();
        loadData();
        updateCharList();
        injectPrompt();
    });
    
    console.log('Dialogue Colors: Ready!');
})();
