// ============================================
// Background Service Worker — Smart Hybrid v5.0
// Poll Firebase → API วิเคราะห์รูป → เปิด Gemini Gem → API parse response → เปิด Flow
// + Manual per-scene control
// ============================================

importScripts('gemini-helper.js');

// ★ Override model list — gemini-2.0-flash quota เต็ม, บังคับใช้ 2.5-flash
try { HELPER_MODELS.length = 0; HELPER_MODELS.push("gemini-2.5-flash"); } catch(e) {}

const DEFAULT_GEM_URL = 'https://gemini.google.com/gem/823f453339b7';

async function getGemUrl() {
    return new Promise(resolve => {
        chrome.storage.local.get(['gemUrl'], data => {
            resolve(data.gemUrl || DEFAULT_GEM_URL);
        });
    });
}

const DB_URL = 'https://affiliate-bot-ee9a2-default-rtdb.firebaseio.com';
const ALARM_NAME = "poll-firebase";

// ===== Startup =====
chrome.runtime.onInstalled.addListener(() => {
    console.log('[Bot] Smart Hybrid v6.1 installed');
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.33 });
    addLog('🟢 Extension v6.1 (2.5-flash) ติดตั้งแล้ว');

    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
        .catch(err => console.log('[Bot] sidePanel behavior error:', err));
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.33 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) await pollForTasks();
});

pollForTasks();


// ===== Poll Firebase =====
async function pollForTasks() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try {
        // อ่าน machineId จาก settings
        const machineSettings = await new Promise(r => chrome.storage.local.get(['machineId'], r));
        const myId = (machineSettings.machineId || '').trim();
        
        const resp = await fetch(`${DB_URL}/V2_Tasks.json`, { cache: 'no-store' });
        const data = await resp.json();

        if (!data || typeof data !== 'object') return;

        // Loop through ALL tasks, skip/delete junk, process first valid one
        let taskId = null;
        let task = null;
        let imgPath = null;

        for (const [id, entry] of Object.entries(data)) {
            if (!entry || typeof entry !== 'object') {
                console.log('[Bot] Deleting junk entry:', id);
                await fetch(`${DB_URL}/V2_Tasks/${id}.json`, { method: 'DELETE' });
                continue;
            }
            // ถ้าตั้ง machineId → รับเฉพาะงานที่ส่งมาให้เครื่องนี้ (หรืองานที่ไม่ระบุเครื่อง)
            if (myId && entry.machineId && entry.machineId !== myId) continue;
            const img = entry.image || entry.productImage;
            if (!entry.productName && !img) {
                console.log('[Bot] Deleting invalid task:', id);
                await fetch(`${DB_URL}/V2_Tasks/${id}.json`, { method: 'DELETE' });
                continue;
            }
            taskId = id;
            task = entry;
            imgPath = img;
            if (imgPath) task.image = imgPath;
            break;
        }

        if (!taskId || !task) return;

        console.log(`[Bot] Got V2 task: ${task.productName || '(image only)'}${myId ? ' [Machine: '+myId+']' : ''}`);
        addLog(`📦 รับงาน V2: ${task.productName || '(มีรูปอย่างเดียว)'}${myId ? ' [🖥️ '+myId+']' : ''}`);

        // บันทึกประวัติงาน
        chrome.storage.local.set({ currentJobId: taskId, currentJobName: task.productName || '(ไม่มีชื่อ)' });
        firebaseLogJob(taskId, { productName: task.productName || '(ไม่มีชื่อ)', machineId: myId || 'ไม่ระบุ', status: '🔄 กำลังทำ', startedAt: Date.now() });

        await fetch(`${DB_URL}/V2_Tasks/${taskId}.json`, { method: 'DELETE' });
        await updateStatus('working', 'กำลังเตรียมข้อมูล...');

        // ===== ขั้นตอน 1: API วิเคราะห์รูปสินค้า (ถ้ามี) =====
        let imageAnalysis = null;
        if (imgPath) {
            addLog('🔍 API กำลังวิเคราะห์รูปสินค้า...');
            await updateStatus('working', '🔍 API กำลังวิเคราะห์รูปสินค้า...');
            imageAnalysis = await analyzeProductImage(imgPath);
            if (imageAnalysis) {
                addLog(`✅ วิเคราะห์รูปเสร็จ: ${imageAnalysis.substring(0, 80)}...`);
            } else {
                addLog('⚠️ วิเคราะห์รูปไม่สำเร็จ (ใช้ข้อมูลจาก form แทน)');
            }
        }

        // ===== ขั้นตอน 2: ตรวจสอบตัวละครจากผู้ใช้ (รองรับหลายตัว) =====
        const userChars = task.characters || [];
        const hasAnyCharImage = userChars.some(c => c.image);
        task._hasCharImage = hasAnyCharImage;
        
        if (userChars.length > 0) {
            const withImg = userChars.filter(c => c.image).length;
            const withPrompt = userChars.filter(c => c.prompt).length;
            addLog(`👤 ตัวละคร ${userChars.length} ตัว (มีรูป ${withImg}, มี prompt ${withPrompt})`);
        } else {
            addLog('👤 ไม่มีตัวละคร — Gemini จะสร้าง prompt ให้');
        }

        // ===== ขั้นตอน 3: สร้าง Smart Prompt =====
        const settings = await new Promise(r => chrome.storage.local.get(['systemPrompt'], r));
        task.systemPrompt = task.systemPrompt || settings.systemPrompt;
        const smartPrompt = buildSmartPrompt(task, imageAnalysis);
        addLog('📝 สร้าง Smart Prompt แล้ว');

        // ===== ขั้นตอน 4: เรียก Gemini API เขียนสคริปต์ (V2 แบ็คกราวด์ 100%) =====
        addLog('🧠 กำลังประมวลผลสคริปต์ด้วย Gemini API (V2)...');
        await updateStatus('working', '🧠 กำลังประมวลผลสคริปต์ด้วย Gemini API (V2)...');
        
        const requestParts = [];
        if (imgPath) {
            const base64Data = imgPath.replace(/^data:image\/\w+;base64,/, '');
            requestParts.push({
                inline_data: { mime_type: "image/jpeg", data: base64Data }
            });
        }
        requestParts.push({ text: smartPrompt });

        const rawResponse = await callGeminiAPI({
            contents: [{ parts: requestParts }],
            generationConfig: { temperature: 0.7 }
        });

        addLog('📨 ได้รับสคริปต์แล้ว กำลังจัดโครงสร้าง JSON...');
        const scriptData = await fixAndParseJSON(rawResponse);
        
        if (!scriptData) {
            throw new Error('ไม่สามารถแปลงสคริปต์เป็น JSON ได้');
        }

        const validRes = validateScript(scriptData);
        if (!validRes.valid) {
            throw new Error('สคริปต์ที่ได้ไม่ครบถ้วน: ' + validRes.errors.join(', '));
        }

        // รวมตัวละคร: จากผู้ใช้ (รูป) + จาก Gemini (prompt)
        const mergedChars = [];
        const scriptChars = validRes.script.characters || [];
        const maxChars = Math.max(userChars.length, scriptChars.length, 1);
        
        for (let i = 0; i < maxChars; i++) {
            const uc = userChars[i] || {};
            const sc = scriptChars[i] || {};
            mergedChars.push({
                index: i + 1,
                promptEN: sc.promptEN || uc.prompt || validRes.script.characterPrompt || '',
                image: uc.image || null,
                hasImage: !!uc.image
            });
        }

        // เซฟสคริปต์ลง Storage พร้อมรูปตัวละคร (ถ้ามี)
        validRes.script.characters = mergedChars;
        validRes.script.characterPrompt = validRes.script.characterPrompt 
            || mergedChars[0]?.promptEN 
            || '1girl, Thai woman, 25 years old, long black hair, casual clothing, smiling, portrait photo, 9:16';
        
        await chrome.storage.local.set({ 
            currentScript: validRes.script, 
            pendingImage: imgPath || null,
            pendingCharImages: mergedChars.filter(c => c.image).map(c => c.image)
        });
        addLog(`✨ สคริปต์พร้อมแล้ว! "${validRes.script.title}"`);
        
        mergedChars.forEach((c, i) => {
            if (c.hasImage) {
                addLog(`👤 ตัวละคร ${i+1}: ใช้รูปที่อัพ`);
            } else if (c.promptEN) {
                addLog(`👤 ตัวละคร ${i+1}: ${c.promptEN?.substring(0, 50) || '-'}...`);
            }
        });

        // ===== ขั้นตอน 5: เปิด Google Flow =====
        addLog('🎬 กำลังเปิด Google Flow...');
        updateStatus('working', '🎬 กำลังเปิด Google Flow...');
        
        const flowTab = await chrome.tabs.create({
            url: 'https://labs.google/fx/tools/flow',
            active: true
        });
        addLog(`🎬 Flow tab created (id:${flowTab.id})`);

        // รอ Flow โหลดเสร็จ (timeout 60 วินาที)
        await Promise.race([
            new Promise(resolve => {
                chrome.tabs.onUpdated.addListener(function flowListener(tabId, info) {
                    if (tabId !== flowTab.id || info.status !== 'complete') return;
                    chrome.tabs.onUpdated.removeListener(flowListener);
                    resolve();
                });
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Flow load timeout (60s)')), 60000))
        ]);
        addLog('🎬 Flow โหลดเสร็จ → กด New project...');
        await sleep(8000); // รอ Flow UI โหลดครบ

        // กด New Project (ลองซ้ำ 3 ครั้ง ถ้ายังไม่เข้า /project/)
        let entered = false;
        for (let attempt = 1; attempt <= 3 && !entered; attempt++) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: flowTab.id },
                    func: clickNewProjectButton
                });
                addLog(`✅ กด New project ครั้งที่ ${attempt}`);
            } catch (err) {
                addLog('⚠️ กด New project ไม่ได้: ' + err.message);
            }

            // รอเข้าหน้า /project/ (30 วินาที)
            for (let i = 0; i < 30; i++) {
                const t = await chrome.tabs.get(flowTab.id).catch(() => null);
                if (t && t.url && t.url.includes('/project/')) {
                    entered = true;
                    break;
                }
                await sleep(1000);
            }
            if (!entered && attempt < 3) {
                addLog(`⚠️ ยังไม่เข้า project → ลองกดอีกครั้ง (${attempt + 1}/3)...`);
                await sleep(3000);
            }
        }

        if (!entered) {
            addLog('❌ ไม่ได้เข้าหน้า project หลังลอง 3 ครั้ง — ลองรัน Auto Pipeline ด้วยตัวเอง');
        } else {
            addLog('📂 เข้าหน้า project แล้ว!');
        }
        
        await sleep(3000);
        updateStatus('working', `🚀 เริ่ม Auto Pipeline — "${validRes.script.title}"`);
        addLog('🚀 เริ่ม Full Auto Pipeline อัตโนมัติ...');

        handleFullPipeline({
            charPrompt: mergedChars[0]?.promptEN || validRes.script.characterPrompt || '',
            charImage: mergedChars[0]?.image || null,
            characters: mergedChars,
            productImageUrl: imgPath || '',
            scenes: validRes.script.scenes,
            aspectRatio: validRes.script.aspectRatio || task.aspectRatio || "9:16",
            delay: 2000
        });

    } catch (err) {
        console.log('[Bot] Error:', err.message);
        addLog('❌ Error: ' + err.message);
    }
}


// ===== ฟังก์ชัน inject รูปเข้า Gemini (MAIN world) =====
function pasteImageIntoGemini(base64Data) {
    (async function () {
        try {
            console.log('[BotMain] Starting image paste...');
            const res = await fetch(base64Data);
            const blob = await res.blob();
            const file = new File([blob], 'product.jpg', { type: 'image/jpeg' });

            const fileInputs = document.querySelectorAll('input[type="file"]');
            for (const input of fileInputs) {
                try {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log('[BotMain] ✅ Set file via input');
                    return;
                } catch (e) {
                    console.log('[BotMain] File input failed:', e.message);
                }
            }

            const editor = document.querySelector('.ql-editor[contenteditable="true"]')
                || document.querySelector('[role="textbox"][contenteditable="true"]')
                || document.querySelector('[aria-label*="prompt"]');

            if (editor) {
                editor.focus();
                const dt = new DataTransfer();
                dt.items.add(file);
                const pasteEvt = new ClipboardEvent('paste', {
                    bubbles: true, cancelable: true, clipboardData: dt
                });
                editor.dispatchEvent(pasteEvt);
                console.log('[BotMain] Paste event dispatched');
            }

            await new Promise(r => setTimeout(r, 1500));
            try {
                const item = new ClipboardItem({ [blob.type]: blob });
                await navigator.clipboard.write([item]);
                console.log('[BotMain] ✅ Written to clipboard');
            } catch (e) {
                console.log('[BotMain] Clipboard write failed:', e.message);
            }

        } catch (err) {
            console.error('[BotMain] Error:', err);
        }
    })();
}


// ===== กดปุ่ม New project บน Flow homepage =====
function clickNewProjectButton() {
    console.log('[Bot-Flow] Looking for New project button...');

    const all = document.querySelectorAll('button, a, [role="button"], div, span, mat-button, mdc-button');
    for (const el of all) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t.includes('new project') && t.length < 30) {
            console.log('[Bot-Flow] ✅ Found by text:', el.tagName, t);
            el.click();
            return 'clicked-text';
        }
    }

    const ariaEls = document.querySelectorAll('[aria-label*="new" i][aria-label*="project" i], [aria-label*="New" i][aria-label*="Project" i]');
    if (ariaEls.length > 0) {
        console.log('[Bot-Flow] ✅ Found by aria-label');
        ariaEls[0].click();
        return 'clicked-aria';
    }

    document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
            el.shadowRoot.querySelectorAll('button, a, [role="button"]').forEach(btn => {
                const t = (btn.textContent || '').trim().toLowerCase();
                if (t.includes('new project') && t.length < 30) {
                    console.log('[Bot-Flow] ✅ Found in Shadow DOM');
                    btn.click();
                    return;
                }
            });
        }
    });

    console.log('[Bot-Flow] Trying coordinate click...');
    const positions = [
        { x: window.innerWidth / 2, y: window.innerHeight / 2 + 50 },
        { x: window.innerWidth / 2, y: window.innerHeight - 100 },
        { x: window.innerWidth / 2, y: window.innerHeight * 0.55 },
    ];

    for (const pos of positions) {
        const target = document.elementFromPoint(pos.x, pos.y);
        if (target) {
            const t = (target.textContent || '').trim().toLowerCase();
            console.log('[Bot-Flow] Element at', pos.x, pos.y, '→', target.tagName, t.substring(0, 30));
            if (t.includes('new project') || t.includes('new') || target.tagName === 'BUTTON') {
                target.click();
                target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                console.log('[Bot-Flow] ✅ Clicked at coordinates');
                return 'clicked-coords';
            }
        }
    }

    console.log('[Bot-Flow] Last resort: simulating mouse events');
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2 + 50;
    ['mousedown', 'mouseup', 'click'].forEach(evtType => {
        document.elementFromPoint(cx, cy)?.dispatchEvent(
            new MouseEvent(evtType, { bubbles: true, cancelable: true, clientX: cx, clientY: cy })
        );
    });

    return 'tried-simulate';
}


// ===== รับข้อความจาก content scripts / side panel =====

// ===== Full Auto Pipeline =====
let pipelineAborted = false;
let pipelinePaused = false;

// รอจนกว่า unpause
async function waitWhilePaused() {
    while (pipelinePaused && !pipelineAborted) {
        await new Promise(r => setTimeout(r, 500));
    }
}

// ล็อคหน้าจอ Flow — overlay ใสกันกดเว็บ
async function injectScreenLock(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId }, func: () => {
                if (document.getElementById('__pipeline_lock__')) return;
                const overlay = document.createElement('div');
                overlay.id = '__pipeline_lock__';
                overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;background:transparent;cursor:not-allowed;';
                // แถบบอกสถานะ
                const bar = document.createElement('div');
                bar.id = '__pipeline_lock_bar__';
                bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:1000000;background:linear-gradient(90deg,#f59e0b,#ef4444);color:#fff;text-align:center;font:bold 13px sans-serif;padding:6px 0;letter-spacing:0.5px;';
                bar.textContent = '🔒 ระบบ Auto กำลังทำงาน — ห้ามกดหน้าเว็บ';
                document.body.appendChild(overlay);
                document.body.appendChild(bar);
            }
        });
    } catch(e) {}
}

// ปลดล็อคหน้าจอ Flow
async function removeScreenLock(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId }, func: () => {
                document.getElementById('__pipeline_lock__')?.remove();
                document.getElementById('__pipeline_lock_bar__')?.remove();
            }
        });
    } catch(e) {}
}

async function handleFullPipeline(pipelineData) {
    pipelineAborted = false;
    pipelinePaused = false;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const delay = pipelineData.delay || 2000;
    
    function pipeLog(msg) {
        chrome.runtime.sendMessage({ type: 'PIPELINE_LOG', message: msg }).catch(() => {});
        // ส่ง log ไป Firebase ด้วย
        firebasePipelineUpdate({ log: msg, done: false });
    }
    function pipePhase(phase, status) {
        chrome.runtime.sendMessage({ type: 'PIPELINE_PHASE', phase, status }).catch(() => {});
        // ส่ง phase ไป Firebase ด้วย
        const phaseNames = { character: '🎭 ตัวละคร', product: '📦 สินค้า', images: '🖼️ ภาพซีน', videos: '🎬 วิดีโอ' };
        const statusNames = { active: 'กำลังทำ', done: 'เสร็จ', pending: 'รอ' };
        firebasePipelineUpdate({ step: `${phaseNames[phase] || phase}: ${statusNames[status] || status}`, phase, phaseStatus: status, done: false });
    }
    
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('ไม่เจอ tab');
        const tabId = tab.id;
        
        const { characters, productImageUrl, scenes } = pipelineData;
        const totalScenes = scenes.length;
        
        // 🔒 ล็อคหน้าจอตั้งแต่เริ่ม
        await injectScreenLock(tabId);
        
        // ============ Phase 1: สร้างตัวละคร ============
        await waitWhilePaused();
        if (pipelineAborted) throw new Error('aborted');
        pipePhase('character', 'active');
        pipeLog(`🎭 === Phase 1: สร้างตัวละคร (${characters ? characters.length : 0} ตัว) ===`);
        
        if (characters && characters.length > 0) {
            for (let j = 0; j < characters.length; j++) {
                const char = characters[j];
                const charName = `ตัวละคร${char.index || (j+1)}`;
                pipeLog(`🎭 [${j+1}/${characters.length}] กำลังจัดการ ${charName}...`);
                
                if (char.image) {
                    await chrome.storage.local.set({ pendingImage: char.image });
                    const charSteps = [
                        'CLICK_ADD_MEDIA', 'CLICK_CREATE_COLLECTION', 'CLICK_NEW_COLLECTION',
                        'WAIT_COLLECTION_URL', 'CLICK_TITLE', 'SELECT_ALL_DELETE',
                        'TYPE_NAME', 'CLICK_DONE', 'PASTE_IMAGE', 'GO_BACK'
                    ];
                    await runWorkflowAndWait(charSteps, charName, delay, '', '');
                    // ★ บันทึก prompt จริงที่ใช้สร้างตัวละคร → ให้ content-flow.js ใช้ค้นหาเรฟ
                    await chrome.storage.local.set({ actualCharPrompt: charName });
                    pipeLog(`✅ อัพโหลดรูป ${charName} โฟลเดอร์เสร็จแล้ว`);
                } else {
                    const cPrompt = char.promptEN || char.prompt || `A character`;
                    const charSteps = [
                        'CLICK_ADD_MEDIA', 'CLICK_CREATE_COLLECTION', 'CLICK_NEW_COLLECTION',
                        'WAIT_COLLECTION_URL', 'CLICK_TITLE', 'SELECT_ALL_DELETE',
                        'TYPE_NAME', 'CLICK_DONE', 'CREATE_IMAGE', 'GO_BACK'
                    ];
                    await runWorkflowAndWait(charSteps, charName, delay, cPrompt, '');
                    // ★ บันทึก prompt จริงที่ใช้สร้างตัวละคร → ให้ content-flow.js ใช้ค้นหาเรฟ
                    await chrome.storage.local.set({ actualCharPrompt: cPrompt });
                    pipeLog(`✅ วาดสร้างตัวละคร ${charName} เสร็จแล้ว`);
                }
                await sleep(2000);
            }
        } else {
             pipeLog('🎭 ไม่มีการตั้งค่าตัวละคร ข้าม...');
        }
        pipePhase('character', 'done');
        
        // ============ Phase 2: สร้างสินค้า ============
        await waitWhilePaused();
        if (pipelineAborted) throw new Error('aborted');
        pipePhase('product', 'active');
        
        if (productImageUrl) {
            pipeLog('📦 === Phase 2: สร้างสินค้า ===');
            await chrome.storage.local.set({ pendingImage: productImageUrl });
            const prodSteps = [
                'CLICK_ADD_MEDIA', 'CLICK_CREATE_COLLECTION', 'CLICK_NEW_COLLECTION',
                'WAIT_COLLECTION_URL', 'CLICK_TITLE', 'SELECT_ALL_DELETE',
                'TYPE_NAME', 'CLICK_DONE', 'PASTE_IMAGE', 'GO_BACK'
            ];
            await runWorkflowAndWait(prodSteps, 'product', delay, '', '');
            pipeLog('✅ สร้างโฟลเดอร์รวบรวมสินค้า (product) เสร็จ');
            await sleep(2000);
        } else {
            pipeLog('📦 ไม่มีรูปสินค้าหลัก (ข้าม Phase 2)');
        }
        pipePhase('product', 'done');
        
        // ============ Phase 3: สร้างภาพทุกซีน ============
        await waitWhilePaused();
        if (pipelineAborted) throw new Error('aborted');
        pipePhase('images', 'active');
        pipeLog(`🖼️ === Phase 3: สร้างภาพ ${totalScenes} ซีน ===`);
        
        const imgSteps = [
            'CLICK_ADD_MEDIA', 'CLICK_CREATE_COLLECTION', 'CLICK_NEW_COLLECTION',
            'WAIT_COLLECTION_URL', 'CLICK_TITLE', 'SELECT_ALL_DELETE',
            'TYPE_NAME', 'CLICK_DONE', 'CREATE_SCENE_IMAGE', 'GO_BACK'
        ];
        
        const collectionUrls = [];
        const sceneImagePrompts = []; // ★ เก็บ prompt ภาพแต่ละซีนไว้ใช้ตอนสร้างวิดีโอ
        for (let i = 0; i < totalScenes; i++) {
            await waitWhilePaused();
            if (pipelineAborted) throw new Error('aborted');
            const scene = scenes[i];
            const sn = scene.sceneNumber || (i + 1);
            const sceneName = `ซีน${sn}`;
            const imgPrompt = scene.imagePromptEN || scene.imagePromptTH || scene.imagePrompt || scene.prompt || '';
            const needsCharacter = scene.hasCharacter !== false; // default true
            const needsProduct = scene.hasProduct !== false;   // default true
            
            pipeLog(`🖼️ [${i+1}/${totalScenes}] สร้างภาพ ${sceneName}${needsCharacter ? ' +ตัวละคร' : ''}${needsProduct ? ' +สินค้า' : ''}...`);
            
            const colUrl = await runWorkflowAndWait(imgSteps, sceneName, delay, imgPrompt, '', {
                hasCharacter: needsCharacter,
                hasProduct: needsProduct,
                charPrompt: pipelineData.charPrompt || '' // ★ ส่ง prompt ตัวละครจริง → ใช้ค้นหาเรฟ
            });
            
            collectionUrls.push(colUrl || '');
            sceneImagePrompts.push(imgPrompt); // ★ เก็บ prompt ภาพไว้
            chrome.runtime.sendMessage({ 
                type: 'PIPELINE_SCENE_URL', 
                sceneIndex: i, 
                url: colUrl || '' 
            }).catch(() => {});
            
            pipeLog(`✅ ภาพ ${sceneName} เสร็จ${colUrl ? ' (URL: ' + colUrl.substring(0, 50) + '...)' : ''}`);
            await sleep(3000);
        }
        
        pipePhase('images', 'done');
        pipeLog(`✅ สร้างภาพทุกซีนเสร็จ (${totalScenes} ซีน)`);
        await sleep(3000);
        
        // ============ Phase 4: สร้างวิดีโอทุกซีน ============
        await waitWhilePaused();
        if (pipelineAborted) throw new Error('aborted');
        pipePhase('videos', 'active');
        pipeLog(`🎬 === Phase 4: สร้างวิดีโอ ${totalScenes} ซีน ===`);
        
        const vidSteps = ['OPEN_COLLECTION_URL', 'CREATE_SCENE_VIDEO'];
        
        for (let i = 0; i < totalScenes; i++) {
            await waitWhilePaused();
            if (pipelineAborted) throw new Error('aborted');
            const scene = scenes[i];
            const sn = scene.sceneNumber || (i + 1);
            const sceneName = `ซีน${sn}`;
            const imgPrompt = scene.imagePromptEN || scene.imagePromptTH || scene.imagePrompt || scene.prompt || '';
            const vidPrompt = (scene.videoPromptEN || scene.videoPromptTH || scene.videoPrompt || '') + 
                (scene.dialogue ? '\n\nบทพูด: ' + scene.dialogue : '');
            const collUrl = collectionUrls[i] || '';
            
            if (!collUrl) {
                pipeLog(`⚠️ [${i+1}/${totalScenes}] ${sceneName} ไม่มี Collection URL — ข้าม`);
                continue;
            }
            
            pipeLog(`🎬 [${i+1}/${totalScenes}] สร้างวิดีโอ ${sceneName} — ค้นเรฟด้วย: "${(sceneImagePrompts[i] || imgPrompt).substring(0, 40)}..."`);
            
            await runWorkflowAndWait(vidSteps, sceneName, delay, imgPrompt, vidPrompt, {
                characters: characters,
                hasCharacter: true,
                hasProduct: scene.hasProduct !== false,
                collectionUrl: collUrl,
                aspectRatio: pipelineData.aspectRatio || '9:16',
                imgPromptForSearch: sceneImagePrompts[i] || imgPrompt // ★ prompt ภาพของซีนนี้
            });
            
            pipeLog(`✅ วิดีโอ ${sceneName} เสร็จ`);
            await sleep(3000);
        }
        
        pipePhase('videos', 'done');
        pipeLog(`🎉 === Pipeline เสร็จสมบูรณ์! ===`);
        
        // 🔓 ปลดล็อคหน้าจอ
        await removeScreenLock(tabId);
        chrome.runtime.sendMessage({ type: 'FULL_PIPELINE_DONE', success: true }).catch(() => {});
        
    } catch (err) {
        const msg = err.message === 'aborted' ? '⏹️ หยุดโดยผู้ใช้' : '❌ ' + err.message;
        pipeLog(msg);
        // 🔓 ปลดล็อคหน้าจอ
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) await removeScreenLock(tab.id);
        } catch(e) {}
        chrome.runtime.sendMessage({ type: 'FULL_PIPELINE_DONE', success: false, error: msg }).catch(() => {});
    }
}

// Helper: รัน workflow แล้วรอให้เสร็จ — return collection URL ถ้ามี
// ⚠️ ใช้ direct await แทน messaging เพราะ background.js รับ message ตัวเองไม่ได้
async function runWorkflowAndWait(steps, name, delay, imagePrompt, videoPrompt, sceneOptions) {
    return await handleCustomWorkflow(steps, name, delay, imagePrompt, videoPrompt, sceneOptions);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // === Gemini Gem ส่ง raw response กลับมา → ใช้ API ช่วย parse ===
    if (msg.type === 'GEM_RAW_RESPONSE') {
        console.log('[Bot] Got raw response from Gem, length:', msg.text?.length);
        addLog('📨 ได้ response จาก Gem — กำลัง parse...');
        handleGemResponse(msg.text).then(result => {
            sendResponse(result);
        });
        return true;
    }

    // === Script พร้อมแล้ว (parse สำเร็จ) ===
    if (msg.type === 'SCRIPT_READY') {
        handleScriptReady(msg.script, sender);
    }

    // === เดิม: content script ขอข้อมูล ===
    if (msg.type === 'GET_SCRIPT') {
        chrome.storage.local.get(['currentScript', 'currentSceneIndex', 'currentPhase'], (data) => {
            sendResponse(data);
        });
        return true;
    }

    // === Step update จาก content-flow.js ===
    if (msg.type === 'STEP_UPDATE') {
        chrome.storage.local.set({
            currentStep: msg.step,
            stepDetail: msg.detail,
            stepTimestamp: Date.now()
        });
        addLog(`📍 ${msg.detail}`);
    }

    if (msg.type === 'SCENE_IMAGE_DONE') {
        chrome.storage.local.set({ currentPhase: 'video' });
        updateStatus('working', `ซีน ${msg.sceneNumber}: สร้างภาพเสร็จ → กำลังสร้างวิดีโอ...`);
        addLog(`🖼️ ซีน ${msg.sceneNumber}: ภาพเสร็จ`);
    }

    if (msg.type === 'SCENE_VIDEO_DONE') {
        chrome.storage.local.get(['currentScript', 'currentSceneIndex'], (data) => {
            const nextIndex = data.currentSceneIndex + 1;
            if (nextIndex < data.currentScript.scenes.length) {
                chrome.storage.local.set({ currentSceneIndex: nextIndex, currentPhase: 'image' });
                updateStatus('working', `ซีน ${msg.sceneNumber} เสร็จ → เริ่มซีนที่ ${nextIndex + 1}...`);
                addLog(`🎬 ซีน ${msg.sceneNumber}: วิดีโอเสร็จ → ไปซีน ${nextIndex + 1}`);
            } else {
                updateStatus('done', `🎉 ครบ ${data.currentScript.scenes.length} ซีนแล้ว!`);
                addLog('🎉 สร้างวิดีโอครบทุกซีนแล้ว!');
                chrome.storage.local.remove(['currentScript', 'currentSceneIndex', 'currentPhase']);
            }
        });
    }

    if (msg.type === 'ALL_DONE') {
        updateStatus('done', '🎉 สร้างวิดีโอครบทุกซีนแล้ว!');
        addLog('🎉 จบงานทั้งหมด!');
        chrome.storage.local.set({ pipelineStep: 'done' });
        // บันทึกประวัติ: สำเร็จ
        chrome.storage.local.get(['currentJobId', 'currentJobName'], (d) => {
            if (d.currentJobId) {
                firebaseLogJob(d.currentJobId, { status: '✅ สำเร็จ', completedAt: Date.now() });
            }
        });
    }

    if (msg.type === 'CHARACTER_DONE') {
        addLog('👤 สร้างตัวละครเสร็จ!');
        updateStatus('working', '👤 สร้างตัวละครเสร็จ → กำลังเตรียมรูปสินค้า...');
    }

    if (msg.type === 'PRODUCT_IMAGE_DONE') {
        addLog('📷 เตรียมรูปสินค้าเสร็จ!');
        updateStatus('working', '📷 รูปสินค้าพร้อม → เริ่มสร้างซีน...');
    }

    // ===== Flow Error Retry: รีเฟรช (ครั้งที่1) / เปิดแท็บใหม่ (ครั้งที่2+) =====
    if (msg.type === 'FLOW_ERROR_RETRY') {
        const { retryCount, sceneNumber } = msg;
        addLog(`⚠️ Flow Error ซีน ${sceneNumber} — retry ครั้งที่ ${retryCount}`);
        
        if (retryCount > 3) {
            addLog(`❌ ซีน ${sceneNumber}: error เกิน 3 ครั้ง — ข้ามซีน`);
            updateStatus('working', `⏭️ ข้ามซีน ${sceneNumber} → ไปซีนถัดไป`);
            // เลื่อน scene index ไปซีนถัดไป
            chrome.storage.local.get(['currentSceneIndex'], (d) => {
                chrome.storage.local.set({ currentSceneIndex: (d.currentSceneIndex || 0) + 1, currentPhase: 'image' });
            });
            return;
        }

        (async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return;

            if (retryCount <= 1) {
                // ครั้งที่ 1: รีเฟรชหน้าเดิม
                addLog('🔄 วิธี 1: รีเฟรชหน้า...');
                updateStatus('working', `🔄 รีเฟรชหน้า → ซีน ${sceneNumber}...`);
                await chrome.tabs.reload(tab.id);
            } else {
                // ครั้งที่ 2+: เปิดแท็บใหม่
                addLog('🆕 วิธี 2: เปิดแท็บใหม่...');
                updateStatus('working', `🆕 เปิดแท็บใหม่ → ซีน ${sceneNumber}...`);
                await chrome.tabs.remove(tab.id);
                await sleep(2000);
                await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: true });
            }
            // content-flow.js จะ inject อัตโนมัติ → อ่าน currentSceneIndex → resume จากซีนที่ค้าง
        })();
    }

    // === CREATE_COLLECTIONS: สั่งสร้าง collections จาก side panel ===
    if (msg.type === 'CREATE_COLLECTIONS') {
        const names = msg.names || [];
        addLog(`📁 สั่งสร้าง ${names.length} collections: ${names.join(', ')}`);
        handleCreateCollections(names);
    }

    // === RENAME_COLLECTION: เปลี่ยนชื่อ collection ตัวเดียว ===
    if (msg.type === 'RENAME_COLLECTION') {
        addLog(`✏️ เปลี่ยนชื่อ collection #${msg.index + 1} → "${msg.name}"`);
        handleRenameCollection(msg.index, msg.name);
    }

    // === TEST_ACTION: ทดสอบทีละ step ===
    if (msg.type === 'TEST_ACTION') {
        handleTestAction(msg, sendResponse);
        return true; // async response
    }

    // === TEST_WORKFLOW: รันทุก step ===
    if (msg.type === 'TEST_WORKFLOW') {
        workflowAborted = false;
        handleTestWorkflow(msg.name, msg.delay);
    }
    if (msg.type === 'TEST_WORKFLOW_STOP') {
        workflowAborted = true;
    }

    // === TEST_CUSTOM_WORKFLOW: รันตามลำดับที่เลือก ===
    if (msg.type === 'TEST_CUSTOM_WORKFLOW') {
        workflowAborted = false;
        handleCustomWorkflow(msg.steps, msg.name, msg.delay, msg.imagePrompt, msg.videoPrompt, msg.sceneOptions);
    }
    if (msg.type === 'TEST_CUSTOM_WORKFLOW_STOP') {
        workflowAborted = true;
    }

    // === FULL_PIPELINE: Auto ทั้งหมด (ตัวละคร → สินค้า → ภาพ → วิดีโอ) ===
    if (msg.type === 'FULL_PIPELINE') {
        pipelineAborted = false;
        workflowAborted = false;
        handleFullPipeline(msg.data);
    }
    if (msg.type === 'FULL_PIPELINE_STOP') {
        pipelineAborted = true;
        workflowAborted = true;
    }
    if (msg.type === 'FULL_PIPELINE_PAUSE') {
        pipelinePaused = true;
        // ปลดล็อคหน้าจอเพื่อให้ user ใช้เว็บได้
        (async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) await removeScreenLock(tab.id);
        })();
    }
    if (msg.type === 'FULL_PIPELINE_RESUME') {
        pipelinePaused = false;
        // ล็อคหน้าจอกลับ
        (async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) await injectScreenLock(tab.id);
        })();
    }

    // === 🧪 TEST_PASTE_SCENE: ทดสอบ fetch+paste รูปซีนลง textbox ===
    if (msg.type === 'TEST_PASTE_SCENE') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab) { sendResponse({ error: 'ไม่เจอ tab' }); return; }
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id }, func: async () => {
                        try {
                            const sleep = ms => new Promise(r => setTimeout(r, ms));
                            let imgSrc = null;
                            const imgs = document.querySelectorAll('img[src*="getMediaUrlRedirect"], img[src*="lh3.google"], img[src*="generated"]');
                            for (const img of imgs) {
                                const rect = img.getBoundingClientRect();
                                if (rect.width > 50 && rect.height > 50 && rect.y > 40) { imgSrc = img.src; break; }
                            }
                            if (!imgSrc) {
                                for (const img of document.querySelectorAll('img')) {
                                    const rect = img.getBoundingClientRect();
                                    if (rect.width > 80 && rect.height > 80 && img.src && !img.src.includes('data:')) { imgSrc = img.src; break; }
                                }
                            }
                            if (!imgSrc) return { error: 'ไม่เจอรูปในหน้านี้' };
                            
                            const resp = await fetch(imgSrc);
                            const blob = await resp.blob();
                            const file = new File([blob], 'scene_image.png', { type: blob.type || 'image/png' });
                            
                            const tb = document.querySelector('div[role="textbox"][contenteditable="true"]');
                            if (!tb) return { error: 'ไม่เจอ textbox' };
                            tb.focus();
                            await sleep(300);
                            
                            const dt = new DataTransfer();
                            dt.items.add(file);
                            tb.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
                            
                            return { success: true, imgSrc: imgSrc.substring(0, 80) };
                        } catch(e) { return { error: e.message }; }
                    }
                });
                sendResponse(result?.result || { error: 'ไม่มีผลลัพธ์' });
            } catch(e) { sendResponse({ error: e.message }); }
        })();
        return true; // async sendResponse
    }

    // === 🧪 TEST_MORE_VERT: ทดสอบ more_vert + Add to Prompt ===
    if (msg.type === 'TEST_MORE_VERT') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab) { sendResponse({ error: 'ไม่เจอ tab' }); return; }
                const sleep = ms => new Promise(r => setTimeout(r, ms));
                
                // กด more_vert
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id }, func: async () => {
                        function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                        const sl = ms => new Promise(r => setTimeout(r, ms));
                        // hover + find more_vert
                        const imgs = document.querySelectorAll('img[src*="getMediaUrlRedirect"], img[src*="lh3.google"]');
                        if (imgs.length > 0) {
                            const c = imgs[0].parentElement?.parentElement;
                            if (c) { c.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); c.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); }
                        }
                        await sl(500);
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (!icon || icon.textContent.trim() !== 'more_vert') continue;
                            const rect = btn.getBoundingClientRect();
                            if (rect.y > 50 && rect.width > 0) { rc(btn); return true; }
                        }
                        return false;
                    }
                });
                await sleep(1500);
                
                // กด Add to Prompt
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id }, func: () => {
                        function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                        for (const el of document.querySelectorAll('[role="menuitem"], button')) {
                            if ((el.textContent||'').includes('Add to Prompt')) { rc(el); return { success: true }; }
                        }
                        return { error: 'ไม่เจอเมนู Add to Prompt' };
                    }
                });
                sendResponse(result?.result || { error: 'ไม่มีผลลัพธ์' });
            } catch(e) { sendResponse({ error: e.message }); }
        })();
        return true;
    }

    // === BATCH_WORKFLOW: สร้างหลาย collection ===
    if (msg.type === 'BATCH_WORKFLOW') {
        workflowAborted = false;
        handleBatchWorkflow(msg.names, msg.delay);
    }

    // === CREATE_IMAGE: สร้างภาพใน collection ===
    if (msg.type === 'CREATE_IMAGE') {
        handleCreateImage(msg.prompt, msg.name, msg.settings);
    }

    // === PIPELINE: ระบบออโต้ ===
    if (msg.type === 'RUN_PIPELINE') {
        workflowAborted = false;
        handlePipeline(msg.config);
    }
    if (msg.type === 'STOP_PIPELINE') {
        workflowAborted = true;
    }
    // === AUTO PIPELINE จาก Script Data ===
    if (msg.type === 'AUTO_PIPELINE_FROM_SCRIPT') {
        chrome.storage.local.get(['currentScript', 'pendingImage'], async (data) => {
            if (!data.currentScript) {
                addLog('❌ ไม่มีข้อมูลสคริปต์');
                return;
            }
            const script = data.currentScript;
            addLog(`🚀 Auto Pipeline: "${script.title}" — ${script.scenes?.length} ซีน`);
            pipelineAborted = false;
            workflowAborted = false;
            
            handleFullPipeline({
                charPrompt: script.characterPrompt || '',
                productImageUrl: data.pendingImage || '',
                scenes: script.scenes,
                delay: 2000
            });
        });
    }

    // === COLLECTIONS_DONE ===
    if (msg.type === 'COLLECTIONS_DONE') {
        addLog(`📁 สร้าง ${msg.count} collections เสร็จ: ${msg.names?.join(', ')}`);
        updateStatus('done', `📁 สร้าง ${msg.count} collections เสร็จ!`);
    }




    // === Popup ขอหยุด + เคลียร์ ===
    if (msg.type === 'STOP_AND_CLEAR') {
        console.log('[Bot] 🛑 Stop & Clear requested');
        addLog('🛑 หยุดทำงานแล้ว — เคลียร์ทุกอย่าง');
        chrome.alarms.clear(ALARM_NAME, () => {
            setTimeout(() => {
                chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.33 });
                console.log('[Bot] Alarm restarted — ready for new tasks');
            }, 3000);
        });
    }

    // === ขอ logs ===
    if (msg.type === 'GET_LOGS') {
        chrome.storage.local.get(['botLogs'], (data) => {
            sendResponse(data.botLogs || []);
        });
        return true;
    }
});


// ===== Run Scene: เปิด Flow + inject content-flow พร้อมซีนที่กำหนด =====




// ===== CDP Helper: พิมพ์ข้อความจริงผ่าน Chrome Debugger Protocol =====
async function cdpTypeText(tabId, text) {
    const target = { tabId };
    
    // attach debugger
    await chrome.debugger.attach(target, '1.3');
    
    try {
        // Ctrl+A (select all)
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2
        });
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2
        });
        await new Promise(r => setTimeout(r, 100));
        
        // Backspace (ลบข้อความที่ select)
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
        });
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
        });
        await new Promise(r => setTimeout(r, 100));
        
        // ใส่ข้อความทั้งหมดในครั้งเดียว (ไม่ซ้ำ!)
        await chrome.debugger.sendCommand(target, 'Input.insertText', {
            text: text
        });
    } finally {
        try { await chrome.debugger.detach(target); } catch(e) {}
    }
}

// ===== Workflow Runner =====
let workflowAborted = false;

function sendStepUpdate(step, status, message) {
    chrome.runtime.sendMessage({ type: 'WORKFLOW_STEP_UPDATE', step, status, message }).catch(() => {});
}

async function handleTestWorkflow(name, delay) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    
    // หา active tab
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let flowTab = activeTabs[0] || null;
    if (!flowTab?.url?.includes('labs.google')) {
        const allTabs = await chrome.tabs.query({});
        flowTab = allTabs.find(t => t.url?.includes('labs.google') && (t.url?.includes('/project/') || t.url?.includes('/collection/'))) || null;
    }
    if (!flowTab) {
        sendStepUpdate(1, 'error', '❌ ไม่พบ Flow tab');
        chrome.runtime.sendMessage({ type: 'WORKFLOW_DONE', success: false }).catch(() => {});
        return;
    }

    const tabId = flowTab.id;

    const REAL_CLICK_INJECT = `
        function realClick(el) {
            const rect = el.getBoundingClientRect();
            const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
            const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
            el.dispatchEvent(new PointerEvent('pointerdown', o));
            el.dispatchEvent(new MouseEvent('mousedown', o));
            el.dispatchEvent(new PointerEvent('pointerup', o));
            el.dispatchEvent(new MouseEvent('mouseup', o));
            el.dispatchEvent(new MouseEvent('click', o));
        }
    `;

    try {
        // === Step 1: กด Add Media ===
        if (workflowAborted) throw new Error('aborted');
        sendStepUpdate(1, 'active', '1️⃣ กด Add Media...');
        const r1 = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                for (const btn of document.querySelectorAll('button')) {
                    const icon = btn.querySelector('i');
                    if (icon && icon.textContent.trim() === 'add') {
                        const r = btn.getBoundingClientRect();
                        if (r.width > 0 && r.y < 80) { realClick(btn); return true; }
                    }
                }
                return false;
            }
        });
        if (!r1?.[0]?.result) throw new Error('Add Media ไม่เจอ');
        sendStepUpdate(1, 'done', '✅ Add Media');
        await sleep(delay);

        // === Step 2: กด Create Collection ===
        if (workflowAborted) throw new Error('aborted');
        sendStepUpdate(2, 'active', '2️⃣ กด Create Collection...');
        const r2 = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                for (const item of document.querySelectorAll('[role="menuitem"]')) {
                    if ((item.textContent || '').includes('Collection')) { realClick(item); return true; }
                }
                return false;
            }
        });
        if (!r2?.[0]?.result) throw new Error('Create Collection ไม่เจอ');
        sendStepUpdate(2, 'done', '✅ Create Collection');
        await sleep(delay);

        // === Step 3: คลิกเข้า Collection ===
        if (workflowAborted) throw new Error('aborted');
        sendStepUpdate(3, 'active', '3️⃣ คลิกเข้า Collection...');
        const r3 = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                const links = document.querySelectorAll('a[href*="/collection/"]');
                if (links.length > 0) { realClick(links[links.length - 1]); return true; }
                return false;
            }
        });
        if (!r3?.[0]?.result) throw new Error('Collection card ไม่เจอ');
        sendStepUpdate(3, 'done', '✅ คลิกเข้า Collection');
        await sleep(delay);

        // === Step 4: รอ URL /collection/ ===
        if (workflowAborted) throw new Error('aborted');
        sendStepUpdate(4, 'active', '4️⃣ รอ URL /collection/...');
        const entered = await waitForUrl(tabId, url => url.includes('/collection/'), 20);
        if (!entered) throw new Error('ไม่ได้เข้า collection');
        sendStepUpdate(4, 'done', '✅ เข้า Collection แล้ว');
        await sleep(delay);

        // === Step 5: คลิก Title Input ===
        if (workflowAborted) throw new Error('aborted');
        sendStepUpdate(5, 'active', '5️⃣ คลิก Title...');
        const r5 = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                for (const inp of document.querySelectorAll('input[aria-label="Editable text"]')) {
                    const r = inp.getBoundingClientRect();
                    if (r.y < 60 && r.width > 0) { realClick(inp); inp.focus(); return true; }
                }
                return false;
            }
        });
        if (!r5?.[0]?.result) throw new Error('Title input ไม่เจอ');
        sendStepUpdate(5, 'done', '✅ คลิก Title');
        await sleep(500);

        // === Step 6: CDP พิมพ์ชื่อ ===
        if (workflowAborted) throw new Error('aborted');
        sendStepUpdate(6, 'active', '6️⃣ CDP พิมพ์: "' + name + '"');
        await cdpTypeText(tabId, name);
        sendStepUpdate(6, 'done', '✅ พิมพ์: "' + name + '"');
        await sleep(delay);

        // === Step 7: กด Done ===
        if (workflowAborted) throw new Error('aborted');
        sendStepUpdate(7, 'active', '7️⃣ กด Done ✓...');
        const r7 = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                for (const btn of document.querySelectorAll('button')) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && r.y < 60) {
                        const icon = btn.querySelector('i');
                        const iconText = icon ? icon.textContent.trim() : '';
                        if (iconText === 'done' || iconText === 'check') { realClick(btn); return true; }
                    }
                }
                return false;
            }
        });
        if (!r7?.[0]?.result) {
            sendStepUpdate(7, 'error', '⚠️ Done ไม่เจอ (อาจ save อัตโนมัติ)');
        } else {
            sendStepUpdate(7, 'done', '✅ กด Done สำเร็จ');
        }
        await sleep(delay);

        // === Step 8: กลับหน้า Project ===
        if (workflowAborted) throw new Error('aborted');
        sendStepUpdate(8, 'active', '8️⃣ กลับหน้า Project...');
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => { window.history.back(); }
        });
        await waitForUrl(tabId, url => !url.includes('/collection/'), 20);
        sendStepUpdate(8, 'done', '✅ กลับหน้า Project');

        chrome.runtime.sendMessage({ type: 'WORKFLOW_DONE', success: true }).catch(() => {});
    } catch (err) {
        const msg = err.message === 'aborted' ? '⏹️ หยุดโดยผู้ใช้' : '❌ ' + err.message;
        chrome.runtime.sendMessage({ type: 'WORKFLOW_DONE', success: false }).catch(() => {});
        console.log('[Workflow] Error:', err.message);
    }
}

// ===== Global: รอ URL เปลี่ยน =====
async function waitForUrl(tabId, condition, timeoutSec = 30) {
    for (let i = 0; i < timeoutSec; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const tab = await chrome.tabs.get(tabId);
            if (condition(tab.url)) return true;
        } catch (e) { return false; }
    }
    return false;
}

// ===== Custom Workflow Runner: รัน step ตามลำดับที่เลือก =====
async function handleCustomWorkflow(steps, name, delay, imagePrompt, videoPrompt, sceneOptions) {
    const hasCharacter = sceneOptions?.hasCharacter !== false; // default true
    const hasProduct = sceneOptions?.hasProduct === true; // default false
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let capturedCollectionUrl = '';
    
    // หา Flow tab แบบ dynamic — ไม่ fail ถ้ายังไม่มี (OPEN_FLOW จะสร้างให้)
    let tabId = null;
    
    async function findAndSetFlowTab() {
        const allTabs = await chrome.tabs.query({});
        const ft = allTabs.find(t => t.url?.includes('labs.google') && (t.url?.includes('/project/') || t.url?.includes('/collection/') || t.url?.includes('/flow/')));
        if (ft) tabId = ft.id;
        return !!ft;
    }
    
    await findAndSetFlowTab(); // ลองหาก่อน ถ้ามี

    // Action executors
    const actionMap = {
        OPEN_FLOW: async () => {
            const allTabs = await chrome.tabs.query({});
            let ft = allTabs.find(t => t.url?.includes('labs.google') && t.url?.includes('/flow/'));
            if (ft) {
                await chrome.tabs.update(ft.id, { active: true });
                tabId = ft.id;
            } else {
                const newTab = await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: true });
                tabId = newTab.id;
            }
            await sleep(4000);
            // หลังจากเปิดแล้ว ค้นหาอีกที (URL อาจ redirect)
            await findAndSetFlowTab();
        },
        NEW_PROJECT: async () => {
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        if ((btn.textContent||'').includes('New project')) { rc(btn); return; }
                    }
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && icon.textContent.trim() === 'add') { rc(btn); return; }
                    }
                }
            });
            await sleep(3000);
        },
        CLICK_ADD_MEDIA: async () => {
            const r = await chrome.scripting.executeScript({
                target: { tabId }, func: async () => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (let retry = 0; retry < 15; retry++) {
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'add' && btn.getBoundingClientRect().y < 80) {
                                rc(btn); return true;
                            }
                        }
                        await sleep(800);
                    }
                    return false;
                }
            });
            if (!r?.[0]?.result) throw new Error('Add Media ไม่เจอ');
            await sleep(1000);
        },
        CLICK_CREATE_COLLECTION: async () => {
            const r = await chrome.scripting.executeScript({
                target: { tabId }, func: async () => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (let retry = 0; retry < 15; retry++) {
                        for (const item of document.querySelectorAll('[role="menuitem"]')) {
                            if ((item.textContent||'').includes('Collection')) { rc(item); return true; }
                        }
                        await sleep(800);
                    }
                    return false;
                }
            });
            if (!r?.[0]?.result) throw new Error('Create Collection ไม่เจอ');
            await sleep(2000);
        },
        CLICK_NEW_COLLECTION: async () => {
            const r = await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    const links = document.querySelectorAll('a[href*="/collection/"]');
                    if (links.length > 0) { rc(links[0]); return true; }
                    return false;
                }
            });
            if (!r?.[0]?.result) throw new Error('Collection link ไม่เจอ');
        },
        WAIT_COLLECTION_URL: async () => {
            await waitForUrl(tabId, url => url.includes('/collection/'), 20);
            // เก็บ collectionUrl ไว้ให้ pipeline ใช้
            try {
                const t = await chrome.tabs.get(tabId);
                if (t?.url) capturedCollectionUrl = t.url;
            } catch(e) {}
            await sleep(2000);
        },
        CREATE_AND_ENTER_COLL: async () => {
            // เดิม: สร้าง + เข้า Collection ใน 1 step
            const r = await chrome.scripting.executeScript({
                target: { tabId },
                func: async () => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    function realClick(el) {
                        const rect = el.getBoundingClientRect();
                        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
                        const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                        el.dispatchEvent(new PointerEvent('pointerdown', o));
                        el.dispatchEvent(new MouseEvent('mousedown', o));
                        el.dispatchEvent(new PointerEvent('pointerup', o));
                        el.dispatchEvent(new MouseEvent('mouseup', o));
                        el.dispatchEvent(new MouseEvent('click', o));
                    }
                    const oldHrefs = new Set([...document.querySelectorAll('a[href*="/collection/"]')].map(a => a.href));
                    // 1) กด Add Media
                    let addBtn = null;
                    for (let r = 0; r < 15; r++) {
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'add') {
                                const rect = btn.getBoundingClientRect();
                                if (rect.width > 0 && rect.y < 80) { addBtn = btn; break; }
                            }
                        }
                        if (addBtn) break;
                        await sleep(800);
                    }
                    if (!addBtn) return { ok: false, error: 'Add Media ไม่เจอ' };
                    realClick(addBtn);
                    await sleep(2000);
                    // 2) กด Create Collection
                    let ccItem = null;
                    for (let r = 0; r < 15; r++) {
                        for (const item of document.querySelectorAll('[role="menuitem"]')) {
                            if ((item.textContent || '').includes('Collection')) { ccItem = item; break; }
                        }
                        if (ccItem) break;
                        await sleep(800);
                    }
                    if (!ccItem) return { ok: false, error: 'Create Collection ไม่เจอ' };
                    realClick(ccItem);
                    await sleep(3000);
                    // 3) คลิกเข้า collection ใหม่
                    let clicked = false;
                    for (let r = 0; r < 15; r++) {
                        const links = [...document.querySelectorAll('a[href*="/collection/"]')];
                        const newLink = links.find(a => !oldHrefs.has(a.href));
                        if (newLink) { realClick(newLink); clicked = true; break; }
                        if (links.length > oldHrefs.size) { realClick(links[links.length - 1]); clicked = true; break; }
                        await sleep(1000);
                    }
                    return { ok: true, clicked };
                }
            });
            const result = r?.[0]?.result;
            if (!result?.ok) throw new Error(result?.error || 'สร้าง Collection ล้มเหลว');
            await waitForUrl(tabId, url => url.includes('/collection/'), 20);
        },
        CLICK_TITLE: async () => {
            const r = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const inp of document.querySelectorAll('input[aria-label="Editable text"]')) {
                        const r = inp.getBoundingClientRect();
                        if (r.y < 60 && r.width > 0) { realClick(inp); inp.focus(); inp.select(); return true; }
                    }
                    return false;
                }
            });
            if (!r?.[0]?.result) throw new Error('Title input ไม่เจอ');
        },
        SELECT_ALL_DELETE: async () => {
            const target = { tabId };
            try { await chrome.debugger.attach(target, '1.3'); } catch(e) {}
            await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
                type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65
            });
            await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
                type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65
            });
            await sleep(200);
            await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
                type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
            });
            await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
                type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
            });
            await sleep(300);
            try { await chrome.debugger.detach(target); } catch(e) {}
        },
        TYPE_NAME: async () => {
            await cdpTypeText(tabId, name);
        },
        CLICK_DONE: async () => {
            const r = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        const r = btn.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0 && r.y < 60) {
                            const icon = btn.querySelector('i');
                            const iconText = icon ? icon.textContent.trim() : '';
                            if (iconText === 'done' || iconText === 'check') { realClick(btn); return true; }
                        }
                    }
                    return false;
                }
            });
        },
        GO_BACK: async () => {
            // หา tab ใหม่ (กรณี tabId เป็น null)
            if (!tabId) await findAndSetFlowTab();
            if (!tabId) {
                // fallback: ใช้ active tab
                const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                if (activeTab) tabId = activeTab.id;
            }
            if (!tabId) throw new Error('ไม่เจอ Flow tab');
            
            await chrome.tabs.goBack(tabId);
            await sleep(3000);
        },
        ENTER_COLLECTION: async () => {
            const r = await chrome.scripting.executeScript({
                target: { tabId }, args: [name],
                func: (n) => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const a of document.querySelectorAll('a[href*="/collection/"]')) {
                        if ((a.textContent||'').trim().toLowerCase().includes(n.toLowerCase())) { rc(a); return true; }
                    }
                    return false;
                }
            });
            if (!r?.[0]?.result) throw new Error(`ไม่เจอ Collection "${name}"`);
            await waitForUrl(tabId, url => url.includes('/collection/'), 15);
            await sleep(2000);
        },
        PASTE_IMAGE: async () => {
            // อ่าน pendingImage จาก storage
            const data = await chrome.storage.local.get(['pendingImage']);
            const imageUrl = data.pendingImage;
            if (!imageUrl) throw new Error('ไม่มีรูปสินค้าใน storage');
            
            // Inject รูปเข้า Flow textbox โดยตรงผ่าน paste event
            const [result] = await chrome.scripting.executeScript({
                target: { tabId },
                func: async (imgDataUrl) => {
                    try {
                        // หา textbox
                        const tb = document.querySelector('div[role="textbox"][contenteditable="true"]');
                        if (!tb) return { error: 'หา textbox ไม่เจอ' };
                        tb.focus();
                        
                        // แปลง data URL เป็น Blob
                        const resp = await fetch(imgDataUrl);
                        const blob = await resp.blob();
                        const file = new File([blob], 'product.png', { type: blob.type || 'image/png' });
                        
                        // สร้าง DataTransfer + paste event
                        const dt = new DataTransfer();
                        dt.items.add(file);
                        
                        const pasteEvent = new ClipboardEvent('paste', {
                            bubbles: true,
                            cancelable: true,
                            clipboardData: dt
                        });
                        tb.dispatchEvent(pasteEvent);
                        
                        return { success: true };
                    } catch(e) {
                        return { error: e.message };
                    }
                },
                args: [imageUrl]
            });
            
            if (result?.result?.error) throw new Error(result.result.error);
            await sleep(3000);
        },
        REFRESH_PAGE: async () => {
            await chrome.tabs.reload(tabId);
            // รอ tab โหลดเสร็จ
            await new Promise(resolve => {
                chrome.tabs.onUpdated.addListener(function listener(tid, info) {
                    if (tid !== tabId || info.status !== 'complete') return;
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                });
            });
            await sleep(3000);
        },
        CREATE_IMAGE: async () => {
            const prompt = imagePrompt || name;
            
            // Step 1-2: Focus & Click textbox
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    const tb = document.querySelector('div[role="textbox"][contenteditable="true"]');
                    if (tb) { rc(tb); tb.focus(); return true; }
                    const ta = document.querySelector('textarea');
                    if (ta) { rc(ta); ta.focus(); return true; }
                    return false;
                }
            });
            await sleep(500);
            
            // Step 3: Type prompt via CDP
            await cdpTypeText(tabId, prompt);
            await sleep(500);
            
            // Step 4: Click settings dropdown (button with "Video" or "Image" + "crop_9_16")
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    // หาปุ่ม dropdown ที่มี icon crop_9_16 หรือข้อความ Video/Image
                    for (const btn of document.querySelectorAll('button')) {
                        const text = btn.textContent || '';
                        const icon = btn.querySelector('i');
                        const iconText = icon ? icon.textContent.trim() : '';
                        if (iconText === 'crop_9_16' || text.includes('crop_9_16') || text.includes('crop_16_9')) {
                            rc(btn); return true;
                        }
                    }
                    return false;
                }
            });
            await sleep(800);
            
            // Step 5: Click "Image" tab
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').includes('Image')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(800);
            
            // Step 7: Select model "Nano Banana Pro"
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        if ((btn.textContent||'').includes('Nano Banana')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(500);
            
            // Step 8: Select "x1"
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').trim() === 'x1') { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(500);
            
            // Step 9: Click settings dropdown again to close
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        const text = btn.textContent || '';
                        if (text.includes('Nano Banana') && text.includes('crop_9_16')) {
                            rc(btn); return true;
                        }
                    }
                    // fallback: คลิก body เพื่อปิด
                    document.body.click();
                    return false;
                }
            });
            await sleep(500);
            
            // Step 10: Click "Create" button (arrow_forward)
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && (icon.textContent.trim() === 'arrow_forward' || icon.textContent.trim() === 'send')) { 
                            rc(btn); return true; 
                        }
                    }
                    return false;
                }
            });
            await sleep(5000);
        },
        CREATE_SCENE_IMAGE: async () => {
            const prompt = imagePrompt || name;
            
            // === Helper: เพิ่ม reference — คลิก list item (div.fxjqav) + CDP search + CDP mouse click ===
            async function addReferenceBySearch(searchText) {
                console.log(`[SceneImage] Adding reference: "${searchText}"`);
                
                // ย้ายเคอร์เซอร์ไปท้ายสุดก่อน
                await chrome.scripting.executeScript({
                    target: { tabId }, func: () => {
                        const tb = document.querySelector('div[role="textbox"][contenteditable="true"]');
                        if (tb) {
                            tb.focus();
                            const sel = window.getSelection();
                            if (sel.rangeCount > 0) sel.collapseToEnd();
                        }
                    }
                });
                await sleep(300);
                
                // Step A: กด add_2 เปิด Asset Drawer
                await chrome.scripting.executeScript({
                    target: { tabId }, func: () => {
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'add_2') {
                                btn.click();
                                return true;
                            }
                        }
                        return false;
                    }
                });
                await sleep(2000);
                
                // Step B: หาช่อง search → focus
                const [searchResult] = await chrome.scripting.executeScript({
                    target: { tabId }, func: () => {
                        const searchInput = document.querySelector('input[placeholder*="Search"], input[type="search"], input[aria-label*="Search"]');
                        if (searchInput) { 
                            searchInput.focus();
                            searchInput.click();
                            return true; 
                        }
                        return false;
                    }
                });
                await sleep(500);
                
                if (searchResult && searchResult.result === true) {
                    // Step C: ล้างช่อง + พิมพ์ด้วย CDP (Safety: เช็ค focus ก่อน)
                    const [focusCheck] = await chrome.scripting.executeScript({
                        target: { tabId }, func: () => {
                            const active = document.activeElement;
                            if (!active) return 'none';
                            if (active.tagName === 'INPUT') return 'INPUT_OK';
                            return active.tagName + '.' + (active.getAttribute('role') || '');
                        }
                    });
                    
                    const activeIs = focusCheck?.result || 'unknown';
                    if (activeIs === 'INPUT_OK') {
                        try {
                            const target = { tabId };
                            await chrome.debugger.attach(target, '1.3').catch(() => {});
                            for (let x = 0; x < 30; x++) {
                                await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }).catch(()=>{});
                                await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }).catch(()=>{});
                            }
                            await chrome.debugger.detach(target).catch(() => {});
                        } catch(e) {}
                        await sleep(300);
                    } else {
                        console.log(`[SceneImage] ⚠️ SKIP BACKSPACE — focus=${activeIs}`);
                    }
                    
                    await cdpTypeText(tabId, searchText);
                    await sleep(2500);
                    
                    // Step D: คลิก list item — ใช้ JS click + PointerEvent ตรงๆ (ไม่ใช่ CDP)
                    const [clickResult] = await chrome.scripting.executeScript({
                        target: { tabId }, func: () => {
                            function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                            
                            // วิธี 0 (ดีที่สุด): div[role="button"] ใน asset drawer (class sc-bf04f0d9-0)
                            for (const el of document.querySelectorAll('div[role="button"]')) {
                                const r = el.getBoundingClientRect();
                                if (r.height > 30 && r.height < 250 && r.width > 60 && r.y > 40) {
                                    rc(el); return 'role-button-div';
                                }
                            }
                            // วิธี 1: div.fxjqav
                            for (const el of document.querySelectorAll('div.fxjqav, [class*="fxjqav"]')) {
                                rc(el); return 'fxjqav';
                            }
                            // วิธี 2: div ที่มี img[getMediaUrlRedirect]
                            for (const div of document.querySelectorAll('div')) {
                                const r = div.getBoundingClientRect();
                                if (r.height > 30 && r.height < 150 && r.width > 100 && r.y > 40) {
                                    if (div.querySelector('img[src*="getMediaUrlRedirect"], img[src*="media"]')) {
                                        rc(div); return 'media-div';
                                    }
                                }
                            }
                            // วิธี 3: role=option / listitem / button ที่มีรูป
                            for (const el of document.querySelectorAll('[role="option"], [role="listitem"], [role="button"], li')) {
                                const r = el.getBoundingClientRect();
                                if (r.height > 30 && r.height < 200 && r.width > 60 && r.y > 40 && el.querySelector('img')) {
                                    rc(el); return 'role-item';
                                }
                            }
                            // วิธี 4: img ที่อยู่ในบริเวณ drawer
                            for (const img of document.querySelectorAll('img')) {
                                const r = img.getBoundingClientRect();
                                if (r.width > 40 && r.width < 300 && r.height > 40 && r.height < 300 && r.y > 100) {
                                    const parent = img.closest('div') || img;
                                    rc(parent); return 'img-parent';
                                }
                            }
                            return null;
                        }
                    });
                    
                    if (clickResult?.result) {
                        console.log(`[SceneImage] ✅ Clicked ref: ${clickResult.result}`);
                    } else {
                        console.log(`[SceneImage] ❌ No media list item found`);
                    }
                    
                    await sleep(2000);
                } else {
                    console.log(`[SceneImage] ⚠️ Search not found`);
                }
            }
            
            // Step 4.5: เคลียร์กล่องข้อความ + พิมพ์พ้อมก่อน (เหมือน NoAPI)
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    const tb = document.querySelector('div[role="textbox"][contenteditable="true"]');
                    if (tb) { 
                        tb.focus();
                        document.execCommand('selectAll', false, null);
                        document.execCommand('delete', false, null);
                    }
                }
            });
            await sleep(500);
            
            // พิมพ์พ้อมก่อน (สำคัญ: NoAPI พิมพ์ text ก่อนแล้วค่อยใส่ refs)
            await cdpTypeText(tabId, prompt);
            await sleep(1500);

            // === เพิ่ม refs — ไม่มี logic พิเศษระหว่างเรฟ ===
            if (hasCharacter) {
                if (sceneOptions?.characters && sceneOptions.characters.length > 0) {
                    for (let j = 0; j < sceneOptions.characters.length; j++) {
                        const charName = `ตัวละคร${sceneOptions.characters[j].index || (j+1)}`;
                        await addReferenceBySearch(charName);
                        await sleep(1500);
                    }
                } else {
                    await addReferenceBySearch(sceneOptions?.charPrompt || imagePrompt || 'ตัวละคร');
                    await sleep(1500);
                }
            }
            if (sceneOptions?.hasProduct) {
                await addReferenceBySearch('product');
                await sleep(1500);
            }
            
            // Step 6: Open settings dropdown
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        const text = btn.textContent || '';
                        const icon = btn.querySelector('i');
                        const iconText = icon ? icon.textContent.trim() : '';
                        if (iconText === 'crop_9_16' || text.includes('crop_9_16') || text.includes('crop_16_9') || text.includes('Nano Banana')) {
                            rc(btn); return true;
                        }
                    }
                    return false;
                }
            });
            await sleep(800);
            
            // Step 7: Click "Image" tab
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').includes('Image')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(800);
            
            // Step 8: Click Aspect Ratio
            const targetRatio = sceneOptions?.aspectRatio || '9:16';
            await chrome.scripting.executeScript({
                target: { tabId }, func: (ratio) => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').includes(ratio)) { rc(btn); return true; }
                    }
                    return false;
                },
                args: [targetRatio]
            });
            await sleep(500);
            
            // Step 9: Click "x1"
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').trim() === 'x1') { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(500);
            
            // Step 10: Select model "Nano Banana Pro"
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        if ((btn.textContent||'').includes('Nano Banana')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(500);
            
            // Step 11: Close settings dropdown
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    document.body.click();
                }
            });
            await sleep(500);
            
            // Step 12: Click "Create" button (arrow_forward)
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && (icon.textContent.trim() === 'arrow_forward' || icon.textContent.trim() === 'send')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(5000);
        },
        CREATE_VIDEO: async () => {
            const prompt = videoPrompt || name; // ใช้ค่าจาก wfVideoPrompt
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    const ta = document.querySelector('textarea') || document.querySelector('[contenteditable]');
                    if (ta) { rc(ta); ta.focus(); }
                }
            });
            await sleep(500);
            await cdpTypeText(tabId, prompt);
            await sleep(500);
            // กด Video mode
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        if ((btn.textContent||'').trim() === 'Video') { rc(btn); break; }
                    }
                }
            });
            await sleep(500);
            // กด Send
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el) { const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && (icon.textContent.trim() === 'arrow_forward' || icon.textContent.trim() === 'send')) { rc(btn); return; }
                    }
                }
            });
            await sleep(5000);
        },
        OPEN_COLLECTION_URL: async () => {
            // เปิด collection URL ที่บันทึกไว้
            const collUrl = sceneOptions?.collectionUrl;
            if (!collUrl) throw new Error('ไม่มี Collection URL — กรุณาสร้างซีนก่อน');
            await chrome.tabs.update(tabId, { url: collUrl, active: true });
            // รอ tab โหลดเสร็จ
            await new Promise(resolve => {
                chrome.tabs.onUpdated.addListener(function listener(tid, info) {
                    if (tid !== tabId || info.status !== 'complete') return;
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                });
            });
            await sleep(3000);
        },
        CREATE_SCENE_VIDEO: async () => {
            const prompt = videoPrompt || name;
            const RC = `function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}`;
            
            // Step 0: Focus textbox + Type video prompt (First step to avoid selecting/wiping reference chips later)
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    const tb = document.querySelector('div[role="textbox"][contenteditable="true"]');
                    if (tb) { 
                        rc(tb); tb.focus(); 
                        document.execCommand('selectAll'); document.execCommand('delete');
                        return true; 
                    }
                    return false;
                }
            });
            await sleep(500);
            await cdpTypeText(tabId, prompt);
            await sleep(1000);

            // Step 1: กด add_2 เปิด reference panel
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && icon.textContent.trim() === 'add_2') { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(1500);
            
            // Step 2: พิมพ์ค้นหาในช่อง Search for Assets ด้วย prompt ภาพของซีนนี้
            // ★ ใช้ imgPromptForSearch (prompt ภาพของซีนตัวเอง) ไม่ใช่ imagePrompt ทั่วไป
            const searchQuery = (sceneOptions?.imgPromptForSearch || imagePrompt || name || '').substring(0, 100);
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    // หาช่อง search และคลิกเพื่อ focus
                    const searchInput = document.querySelector('input[placeholder*="Search"], input[type="search"], input[aria-label*="Search"]');
                    if (searchInput) { 
                        rc(searchInput); 
                        searchInput.focus(); 
                        return true; 
                    }
                    return false;
                }
            });
            await sleep(500);
            
            // ล้างช่องค้นหาเก่าแบบปลอดภัยสุดด้วย CDP Backspace 30 ครั้ง
            try {
                const target = { tabId };
                await chrome.debugger.attach(target, '1.3').catch(() => {});
                for (let x = 0; x < 30; x++) {
                    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }).catch(()=>{});
                    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }).catch(()=>{});
                }
                await chrome.debugger.detach(target).catch(() => {});
            } catch(e) {}
            await sleep(300);
            
            await cdpTypeText(tabId, searchQuery);
            await sleep(2500);
            
            // Step 3: เลือกรูปแรกจากผลค้นหา
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    // เลือก media item แรกในผลค้นหา
                    const items = document.querySelectorAll('div.TcDAb, [class*="TcDAb"]');
                    if (items.length > 0) { rc(items[0]); return true; }
                    const mediaImgs = document.querySelectorAll('div > img[src*="getMediaUrlRedirect"]');
                    if (mediaImgs.length > 0) { rc(mediaImgs[0].parentElement || mediaImgs[0]); return true; }
                    return false;
                }
            });
            await sleep(1500);


            
            // Step 4: Open settings dropdown (click Nano Banana Pro button)
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button')) {
                        if ((btn.textContent||'').includes('crop_9_16') || (btn.textContent||'').includes('crop_16_9') || (btn.textContent||'').includes('Nano Banana')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(800);
            
            // Step 5: Click "Video" tab
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').includes('Video') && !btn.textContent.includes('Ingredients')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(800);
            
            // Step 6: Click "Ingredients" tab
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').includes('Ingredients')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(800);
            
            // Step 7: Click Aspect Ratio
            const targetRatioV = sceneOptions?.aspectRatio || '9:16';
            await chrome.scripting.executeScript({
                target: { tabId }, func: (ratio) => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').includes(ratio)) { rc(btn); return true; }
                    }
                    return false;
                },
                args: [targetRatioV]
            });
            await sleep(500);
            
            // Step 8: Click "x1"
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button[role="tab"]')) {
                        if ((btn.textContent||'').trim() === 'x1') { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(500);
            
            // Step 9: Dismiss settings (click body)
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => { document.body.click(); }
            });
            await sleep(500);
            
            // Step 10: Select Veo 3.1 model (click model dropdown then select)
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    // หาปุ่ม model dropdown ด้านล่าง
                    for (const btn of document.querySelectorAll('button')) {
                        if ((btn.textContent||'').includes('Nano Banana') || (btn.textContent||'').includes('Veo')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(800);
            
            // Step 11: Select "Veo 3.1" from dropdown
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button, [role="menuitem"] button, [role="menuitem"]')) {
                        if ((btn.textContent||'').includes('Veo 3.1')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(1000);
            
            // Step 12: Click Create (arrow_forward)
            await chrome.scripting.executeScript({
                target: { tabId }, func: () => {
                    function rc(el){const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && (icon.textContent.trim() === 'arrow_forward' || icon.textContent.trim() === 'send')) { rc(btn); return true; }
                    }
                    return false;
                }
            });
            await sleep(5000);
        },
        WAIT_SECONDS: async () => {
            await sleep(delay);
        }
    };

    const actionLabels = {
        OPEN_FLOW: '🌐 เปิดหน้า Flow',
        NEW_PROJECT: '📁 สร้าง Project ใหม่',
        CLICK_ADD_MEDIA: '➕ กด Add Media',
        CLICK_CREATE_COLLECTION: '📁 กด Create Collection',
        CLICK_NEW_COLLECTION: '📂 คลิกเข้า Collection ใหม่',
        WAIT_COLLECTION_URL: '⏳ รอ URL /collection/',
        CREATE_AND_ENTER_COLL: '📁 สร้าง + เข้า Collection',
        CLICK_TITLE: '🖱️ คลิก Title Input',
        SELECT_ALL_DELETE: '🗑️ Ctrl+A → ลบข้อความเดิม',
        TYPE_NAME: '⌨️ พิมพ์: "' + name + '"',
        CLICK_DONE: '✅ กด Done',
        GO_BACK: '⬅️ history.back()',
        ENTER_COLLECTION: '📂 เข้า Collection "' + name + '"',
        CREATE_IMAGE: '🎨 สร้างภาพ',
        CREATE_SCENE_IMAGE: '🎨 สร้างภาพซีน (+ ตัวละคร + สินค้า)',
        PASTE_IMAGE: '📋 วางรูปจาก clipboard',
        REFRESH_PAGE: '🔄 รีเฟรชหน้า',
        OPEN_COLLECTION_URL: '🔗 เปิด Collection URL',
        CREATE_SCENE_VIDEO: '🎬 สร้างวิดีโอซีน (more_vert → Video → Veo)',
        CREATE_VIDEO: '🎬 สร้างวิดีโอ',
        WAIT_SECONDS: '⏱️ รอ ' + (delay/1000) + ' วินาที'
    };

    try {
        for (let i = 0; i < steps.length; i++) {
            if (workflowAborted) throw new Error('aborted');
            const action = steps[i];
            const label = actionLabels[action] || action;
            
            chrome.runtime.sendMessage({ type: 'CUSTOM_STEP_UPDATE', action, status: 'running', message: `${i+1}/${steps.length} ${label}...` }).catch(() => {});
            
            const executor = actionMap[action];
            if (!executor) throw new Error('Unknown action: ' + action);
            
            // ถ้า tabId ยังเป็น null ลองหาอีกครั้ง
            if (!tabId && action !== 'OPEN_FLOW') {
                await findAndSetFlowTab();
                if (!tabId) throw new Error('หา Flow tab ไม่เจอ — กรุณาเปิด Flow ก่อน');
            }
            
            await executor();
            
            chrome.runtime.sendMessage({ type: 'CUSTOM_STEP_UPDATE', action, status: 'done', message: `✅ ${label}` }).catch(() => {});
            
            if (i < steps.length - 1) await sleep(delay);
        }
        chrome.runtime.sendMessage({ type: 'CUSTOM_WORKFLOW_DONE', success: true, collectionUrl: capturedCollectionUrl }).catch(() => {});
        return capturedCollectionUrl; // ส่งค่ากลับให้ runWorkflowAndWait
    } catch (err) {
        chrome.runtime.sendMessage({ type: 'CUSTOM_WORKFLOW_DONE', success: false, error: err.message }).catch(() => {});
        console.log('[CustomWorkflow] Error:', err.message);
        throw err; // ส่ง error กลับให้ runWorkflowAndWait
    }
}

// ===== Batch Workflow: สร้างหลาย collection ทีละตัว =====
async function handleBatchWorkflow(names, delay) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let flowTab = activeTabs[0] || null;
    if (!flowTab?.url?.includes('labs.google')) {
        const allTabs = await chrome.tabs.query({});
        flowTab = allTabs.find(t => t.url?.includes('labs.google') && t.url?.includes('/project/')) || null;
    }
    if (!flowTab) {
        chrome.runtime.sendMessage({ type: 'BATCH_WORKFLOW_DONE', success: false, error: 'ไม่พบ Flow tab' }).catch(() => {});
        return;
    }
    
    const tabId = flowTab.id;
    let completed = 0;
    
    try {
        for (let i = 0; i < names.length; i++) {
            if (workflowAborted) throw new Error('หยุดโดยผู้ใช้');
            const name = names[i];
            
            chrome.runtime.sendMessage({ type: 'BATCH_STEP_UPDATE', message: `📁 ${i+1}/${names.length} กำลังสร้าง "${name}"...` }).catch(() => {});
            
            // === Step 1: สร้าง + เข้า collection (single injection) ===
            const r = await chrome.scripting.executeScript({
                target: { tabId },
                func: async () => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    function realClick(el) {
                        const rect = el.getBoundingClientRect();
                        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
                        const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                        el.dispatchEvent(new PointerEvent('pointerdown', o));
                        el.dispatchEvent(new MouseEvent('mousedown', o));
                        el.dispatchEvent(new PointerEvent('pointerup', o));
                        el.dispatchEvent(new MouseEvent('mouseup', o));
                        el.dispatchEvent(new MouseEvent('click', o));
                    }
                    const oldHrefs = new Set([...document.querySelectorAll('a[href*="/collection/"]')].map(a => a.href));
                    
                    // Add Media
                    let addBtn = null;
                    for (let r = 0; r < 15; r++) {
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'add') {
                                const rect = btn.getBoundingClientRect();
                                if (rect.width > 0 && rect.y < 80) { addBtn = btn; break; }
                            }
                        }
                        if (addBtn) break;
                        await sleep(800);
                    }
                    if (!addBtn) return { ok: false, error: 'Add Media ไม่เจอ' };
                    realClick(addBtn);
                    await sleep(2000);
                    
                    // Create Collection
                    let ccItem = null;
                    for (let r = 0; r < 15; r++) {
                        for (const item of document.querySelectorAll('[role="menuitem"]')) {
                            if ((item.textContent || '').includes('Collection')) { ccItem = item; break; }
                        }
                        if (ccItem) break;
                        await sleep(800);
                    }
                    if (!ccItem) return { ok: false, error: 'Create Collection ไม่เจอ' };
                    realClick(ccItem);
                    await sleep(3000);
                    
                    // Click NEW collection
                    for (let r = 0; r < 15; r++) {
                        const links = [...document.querySelectorAll('a[href*="/collection/"]')];
                        const newLink = links.find(a => !oldHrefs.has(a.href));
                        if (newLink) { realClick(newLink); return { ok: true }; }
                        if (links.length > oldHrefs.size) { realClick(links[0]); return { ok: true }; }
                        await sleep(1000);
                    }
                    return { ok: false, error: 'ไม่พบ collection ใหม่' };
                }
            });
            
            const result = r?.[0]?.result;
            if (!result?.ok) throw new Error(`"${name}": ${result?.error || 'สร้าง collection ล้มเหลว'}`);
            
            // รอเข้า collection page
            const entered = await waitForUrl(tabId, url => url.includes('/collection/'), 20);
            if (!entered) throw new Error(`"${name}": ไม่ได้เข้า collection`);
            await sleep(2000);
            
            // === Step 2: คลิก title ===
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const inp of document.querySelectorAll('input[aria-label="Editable text"]')) {
                        const r = inp.getBoundingClientRect();
                        if (r.y < 60 && r.width > 0) { realClick(inp); inp.focus(); return; }
                    }
                }
            });
            await sleep(500);
            
            // === Step 3: พิมพ์ชื่อ ===
            await cdpTypeText(tabId, name);
            await sleep(500);
            
            // === Step 4: กด Done ===
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        const r = btn.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0 && r.y < 60) {
                            const icon = btn.querySelector('i');
                            if (icon && (icon.textContent.trim() === 'done' || icon.textContent.trim() === 'check')) { realClick(btn); return; }
                        }
                    }
                }
            });
            await sleep(1000);
            
            // === Step 5: Back ===
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => { window.history.back(); }
            });
            await waitForUrl(tabId, url => !url.includes('/collection/'), 20);
            
            completed++;
            chrome.runtime.sendMessage({ type: 'BATCH_STEP_UPDATE', message: `✅ ${i+1}/${names.length} "${name}" สำเร็จ!` }).catch(() => {});
            
            // delay ก่อนรอบถัดไป
            if (i < names.length - 1) await sleep(delay);
        }
        
        chrome.runtime.sendMessage({ type: 'BATCH_WORKFLOW_DONE', success: true, count: completed }).catch(() => {});
    } catch (err) {
        chrome.runtime.sendMessage({ type: 'BATCH_WORKFLOW_DONE', success: false, error: err.message, count: completed }).catch(() => {});
        console.log('[BatchWorkflow] Error:', err.message);
    }
}

// ===== Create Image: สร้างภาพใน Collection =====
async function handleCreateImage(prompt, name, settings) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let flowTab = activeTabs[0] || null;
    if (!flowTab?.url?.includes('labs.google')) {
        const allTabs = await chrome.tabs.query({});
        flowTab = allTabs.find(t => t.url?.includes('labs.google') && t.url?.includes('/collection/')) || null;
    }
    if (!flowTab) {
        chrome.runtime.sendMessage({ type: 'CREATE_IMAGE_DONE', success: false, error: 'ไม่พบ Flow collection tab' }).catch(() => {});
        return;
    }
    
    const tabId = flowTab.id;
    
    try {
        // Step 1: คลิก Prompt Box
        addLog('🎨 Step 1: คลิก Prompt Box...');
        const s1 = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                function realClick(el) {
                    const r = el.getBoundingClientRect();
                    const x = r.x + r.width / 2, y = r.y + r.height / 2;
                    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                    el.dispatchEvent(new PointerEvent('pointerdown', o));
                    el.dispatchEvent(new MouseEvent('mousedown', o));
                    el.dispatchEvent(new PointerEvent('pointerup', o));
                    el.dispatchEvent(new MouseEvent('mouseup', o));
                    el.dispatchEvent(new MouseEvent('click', o));
                }
                const box = document.querySelector('div[role="textbox"][contenteditable="true"]');
                if (box) { realClick(box); box.focus(); return true; }
                return false;
            }
        });
        if (!s1?.[0]?.result) throw new Error('Prompt Box ไม่เจอ');
        await sleep(500);
        
        // Step 2: พิมพ์ prompt ผ่าน CDP
        addLog('🎨 Step 2: พิมพ์ prompt...');
        await cdpTypeText(tabId, prompt);
        await sleep(1000);
        
        // Step 3: คลิก Image tab + 9:16 + x1 + Create
        addLog('🎨 Step 3: เลือก Image / 9:16 / x1 แล้วกด Create...');
        const s3 = await chrome.scripting.executeScript({
            target: { tabId },
            func: async () => {
                const sleep = ms => new Promise(r => setTimeout(r, ms));
                function realClick(el) {
                    const r = el.getBoundingClientRect();
                    const x = r.x + r.width / 2, y = r.y + r.height / 2;
                    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                    el.dispatchEvent(new PointerEvent('pointerdown', o));
                    el.dispatchEvent(new MouseEvent('mousedown', o));
                    el.dispatchEvent(new PointerEvent('pointerup', o));
                    el.dispatchEvent(new MouseEvent('mouseup', o));
                    el.dispatchEvent(new MouseEvent('click', o));
                }
                
                const steps = [];
                
                // เปิดแถบตั้งค่า (คลิกปุ่ม "🍌 Nano Banana Pro" ด้านล่าง)
                for (const btn of document.querySelectorAll('button')) {
                    if ((btn.textContent || '').includes('Banana') && btn.getBoundingClientRect().y > 700) {
                        realClick(btn);
                        steps.push('เปิดตั้งค่า');
                        break;
                    }
                }
                await sleep(800);
                
                // คลิก Image tab (หา button ที่มี icon "image")
                for (const btn of document.querySelectorAll('button[role="tab"]')) {
                    const icon = btn.querySelector('i');
                    if (icon && icon.textContent.trim() === 'image') {
                        realClick(btn);
                        steps.push('Image tab');
                        break;
                    }
                }
                await sleep(500);
                
                // คลิก 9:16 (หา button ที่มี icon "crop_9_16")
                for (const btn of document.querySelectorAll('button[role="tab"]')) {
                    const icon = btn.querySelector('i');
                    if (icon && icon.textContent.trim() === 'crop_9_16') {
                        realClick(btn);
                        steps.push('9:16');
                        break;
                    }
                }
                await sleep(500);
                
                // คลิก x1
                for (const btn of document.querySelectorAll('button[role="tab"]')) {
                    if (btn.textContent.trim() === 'x1') {
                        realClick(btn);
                        steps.push('x1');
                        break;
                    }
                }
                await sleep(500);
                
                // คลิก Create (หา button ที่มี icon "arrow_forward")
                for (const btn of document.querySelectorAll('button')) {
                    const icon = btn.querySelector('i');
                    if (icon && icon.textContent.trim() === 'arrow_forward') {
                        realClick(btn);
                        steps.push('Create');
                        break;
                    }
                }
                
                return { ok: steps.length >= 1, steps };
            }
        });
        
        const result = s3?.[0]?.result;
        addLog(`🎨 สำเร็จ: ${result?.steps?.join(' → ') || 'ไม่มี step'}`);
        
        // Step 4: ตั้งชื่อรูปภาพ (ถ้ามี name)
        if (name && name.trim()) {
            addLog(`🎨 Step 4: ตั้งชื่อ "${name}"...`);
            await sleep(3000); // รอ creation card ปรากฏ
            
            // คลิก title input
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const inp of document.querySelectorAll('input[aria-label="Editable text"]')) {
                        const r = inp.getBoundingClientRect();
                        if (r.width > 0) { realClick(inp); inp.focus(); return true; }
                    }
                    return false;
                }
            });
            await sleep(500);
            
            // พิมพ์ชื่อ
            await cdpTypeText(tabId, name);
            await sleep(500);
            
            // กด Done (✓)
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && (icon.textContent.trim() === 'done' || icon.textContent.trim() === 'check')) {
                            const r = btn.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) { realClick(btn); return true; }
                        }
                    }
                    return false;
                }
            });
            addLog(`✅ ตั้งชื่อ "${name}" สำเร็จ`);
        }
        
        chrome.runtime.sendMessage({ type: 'CREATE_IMAGE_DONE', success: true, steps: result?.steps, name }).catch(() => {});
        
    } catch (err) {
        addLog(`❌ สร้างภาพล้มเหลว: ${err.message}`);
        chrome.runtime.sendMessage({ type: 'CREATE_IMAGE_DONE', success: false, error: err.message }).catch(() => {});
    }
}

// ===== Convert Script Data → Pipeline Config =====
function scriptToPipelineConfig(script, pendingImage) {
    const config = [];
    
    // ตัวละคร
    if (script.characterPrompt) {
        config.push({ name: 'ตัวละคร', type: 'image', imagePrompt: script.characterPrompt, videoPrompt: '' });
    } else {
        config.push({ name: 'ตัวละคร', type: 'skip', imagePrompt: '', videoPrompt: '' });
    }
    
    // สินค้า
    if (pendingImage && pendingImage.startsWith('http')) {
        config.push({ name: 'สินค้า', type: 'upload', imagePrompt: pendingImage, videoPrompt: '' });
    } else {
        config.push({ name: 'สินค้า', type: 'skip', imagePrompt: '', videoPrompt: '' });
    }
    
    // ซีนต่างๆ
    if (script.scenes && Array.isArray(script.scenes)) {
        script.scenes.forEach((scene, i) => {
            const imgPrompt = scene.imagePromptEN || scene.imagePrompt || '';
            const vidPrompt = scene.videoPromptEN || scene.videoPrompt || '';
            const dialogue = scene.dialogue || '';
            const fullVideoPrompt = vidPrompt + (dialogue ? ' บทพูด: ' + dialogue : '');
            
            let type = 'skip';
            if (imgPrompt && fullVideoPrompt) type = 'image+video';
            else if (imgPrompt) type = 'image';
            else if (fullVideoPrompt) type = 'video';
            
            config.push({
                name: `ซีน${i + 1}`,
                type,
                imagePrompt: imgPrompt,
                videoPrompt: fullVideoPrompt
            });
        });
    }
    
    return config;
}

// ===== Batch Workflow: สร้างหลาย collections =====
async function handleBatchWorkflow(names, delay = 3000) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const send = (type, data) => chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
    
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let flowTab = activeTabs[0] || null;
    if (!flowTab?.url?.includes('labs.google')) {
        const allTabs = await chrome.tabs.query({});
        flowTab = allTabs.find(t => t.url?.includes('labs.google') && t.url?.includes('/project/')) || null;
    }
    if (!flowTab) {
        send('BATCH_WORKFLOW_DONE', { success: false, error: 'ไม่พบ Flow project tab' });
        return;
    }
    const tabId = flowTab.id;
    
    for (let i = 0; i < names.length; i++) {
        if (workflowAborted) {
            send('BATCH_WORKFLOW_DONE', { success: false, error: 'หยุดโดยผู้ใช้', count: i });
            return;
        }
        
        const name = names[i];
        send('BATCH_STEP_UPDATE', { message: `📁 ${i+1}/${names.length} กำลังสร้าง "${name}"...` });
        addLog(`📁 Batch ${i+1}/${names.length}: สร้าง "${name}"...`);
        
        try {
            // สร้าง collection ใน single injection
            const beforeHrefs = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => Array.from(document.querySelectorAll('a[href*="/collection/"]')).map(a => a.href)
            });
            const hrefsBefore = beforeHrefs?.[0]?.result || [];
            
            // คลิก Add Media + Create Collection
            await chrome.scripting.executeScript({
                target: { tabId },
                func: async () => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    
                    // กด Add Media (ปุ่ม + ด้านบน)
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && icon.textContent.trim() === 'add' && btn.getBoundingClientRect().y < 80) {
                            realClick(btn); break;
                        }
                    }
                    await sleep(1000);
                    
                    // กด Create Collection
                    for (const item of document.querySelectorAll('[role="menuitem"]')) {
                        if ((item.textContent || '').includes('Collection')) {
                            realClick(item); break;
                        }
                    }
                }
            });
            await sleep(3000);
            
            // หา collection ใหม่
            const afterHrefs = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => Array.from(document.querySelectorAll('a[href*="/collection/"]')).map(a => a.href)
            });
            const hrefsAfter = afterHrefs?.[0]?.result || [];
            const newHref = hrefsAfter.find(h => !hrefsBefore.includes(h));
            
            if (newHref) {
                // Navigate เข้า collection ใหม่
                await chrome.tabs.update(tabId, { url: newHref });
                await waitForUrl(tabId, url => url.includes('/collection/'), 20);
                await sleep(2000);
                
                // คลิก title + เลือกทั้งหมด + ลบ + พิมพ์ชื่อใหม่
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                        for (const inp of document.querySelectorAll('input[aria-label="Editable text"]')) {
                            const r = inp.getBoundingClientRect();
                            if (r.width > 0) { 
                                realClick(inp); 
                                inp.focus(); 
                                inp.select(); // เลือกข้อความทั้งหมด
                                return true; 
                            }
                        }
                        return false;
                    }
                });
                await sleep(500);
                
                // ลบข้อความเดิมด้วย Ctrl+A แล้ว Delete
                const debugTarget = { targetId: tabId };
                try {
                    await chrome.debugger.attach(debugTarget, '1.3');
                } catch(e) { /* อาจ attach อยู่แล้ว */ }
                // Select All
                await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                    type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65
                });
                await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                    type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65
                });
                await sleep(200);
                // Delete
                await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                    type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
                });
                await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                    type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
                });
                await sleep(300);
                
                // พิมพ์ชื่อใหม่
                await cdpTypeText(tabId, name);
                await sleep(500);
                
                // กด Done
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && (icon.textContent.trim() === 'done' || icon.textContent.trim() === 'check')) {
                                const r = btn.getBoundingClientRect();
                                if (r.width > 0) { realClick(btn); return true; }
                            }
                        }
                        return false;
                    }
                });
                await sleep(500);
                
                // กลับหน้า project
                await chrome.scripting.executeScript({ target: { tabId }, func: () => window.history.back() });
                await waitForUrl(tabId, url => !url.includes('/collection/'), 20);
                await sleep(delay);
                
                addLog(`✅ สร้าง "${name}" สำเร็จ!`);
            } else {
                addLog(`⚠️ ไม่เจอ collection ใหม่สำหรับ "${name}"`);
            }
        } catch (err) {
            addLog(`❌ สร้าง "${name}" ล้มเหลว: ${err.message}`);
        }
    }
    
    send('BATCH_WORKFLOW_DONE', { success: true, count: names.length });
    addLog(`✅ Batch เสร็จ! สร้าง ${names.length} collections`);
}

// ===== Firebase REST Helper for Pipeline =====
const FIREBASE_DB_URL = 'https://affiliate-bot-ee9a2-default-rtdb.firebaseio.com';

// ===== Firebase Job History Logger =====
function firebaseLogJob(jobId, data) {
    fetch(`${FIREBASE_DB_URL}/jobHistory/${jobId}.json`, {
        method: 'PATCH',
        body: JSON.stringify({ ...data, updatedAt: Date.now() })
    }).catch(() => {});
}

function firebasePipelineUpdate(data) {
    // อัพเดท pipeline หลัก
    fetch(`${FIREBASE_DB_URL}/pipeline.json`, {
        method: 'PUT',
        body: JSON.stringify({ ...data, updatedAt: Date.now() })
    }).catch(() => {});
    
    // อัพเดทสถานะเครื่องนี้ (ถ้ามี machineId)
    chrome.storage.local.get(['machineId'], (s) => {
        const mid = (s.machineId || '').trim();
        if (mid) {
            fetch(`${FIREBASE_DB_URL}/machines/${encodeURIComponent(mid)}.json`, {
                method: 'PATCH',
                body: JSON.stringify({ status: data.step || (data.done ? '✅ เสร็จ' : '🔄 ทำงาน'), updatedAt: Date.now() })
            }).catch(() => {});
        }
    });
}

// ===== Machine Heartbeat (ส่งสัญญาณทุก 30 วินาที) =====
setInterval(() => {
    chrome.storage.local.get(['machineId'], (s) => {
        const mid = (s.machineId || '').trim();
        if (mid) {
            fetch(`${FIREBASE_DB_URL}/machines/${encodeURIComponent(mid)}.json`, {
                method: 'PATCH',
                body: JSON.stringify({ online: true, lastSeen: Date.now() })
            }).catch(() => {});
        }
    });
}, 30000); // ทุก 30 วินาที

// ===== Listen for commands from web app =====
setInterval(async () => {
    try {
        const res = await fetch(`${FIREBASE_DB_URL}/commands.json`);
        const cmd = await res.json();
        if (cmd && cmd.type) {
            if (cmd.type === 'STOP_PIPELINE' || cmd.type === 'STOP_FULL_PIPELINE') {
                pipelineAborted = true;
                workflowAborted = true;
                addLog('⏹️ หยุดจากเว็บ');
                firebasePipelineUpdate({ step: '⏹️ หยุดโดยผู้ใช้', done: true, success: false });
                updateStatus('idle', 'หยุดแล้ว');
            }
            if (cmd.type === 'PAUSE_PIPELINE') {
                pipelinePaused = true;
                addLog('⏸️ พักจากเว็บ');
                firebasePipelineUpdate({ step: '⏸️ พัก...', paused: true, done: false });
                updateStatus('working', '⏸️ พักอยู่...');
            }
            if (cmd.type === 'RESUME_PIPELINE') {
                pipelinePaused = false;
                addLog('▶️ ทำต่อจากเว็บ');
                firebasePipelineUpdate({ step: '▶️ ทำต่อ...', paused: false, done: false });
                updateStatus('working', '▶️ กำลังทำต่อ...');
            }
            if (cmd.type === 'RESTART_PIPELINE') {
                workflowAborted = false;
                pipelineAborted = false;
                chrome.storage.local.get(['currentScript', 'pendingImage'], async (data) => {
                    if (data.currentScript) {
                        const config = scriptToPipelineConfig(data.currentScript, data.pendingImage);
                        handlePipeline(config);
                    }
                });
            }
            // ล้าง command
            fetch(`${FIREBASE_DB_URL}/commands.json`, { method: 'DELETE' }).catch(() => {});
        }
    } catch (e) { }
}, 5000);

// ===== Pipeline Auto System =====
async function handlePipeline(config) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const send = (type, data) => {
        chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
        // ส่งไป Firebase ด้วย
        if (type === 'PIPELINE_UPDATE') {
            firebasePipelineUpdate({ step: data.step, log: data.log, done: false });
        }
        if (type === 'PIPELINE_DONE') {
            firebasePipelineUpdate({ step: data.success ? '✅ เสร็จ!' : '❌ ' + data.error, log: data.success ? '✅ Pipeline เสร็จ!' : '❌ ' + data.error, done: true, success: data.success });
        }
    };
    
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let flowTab = activeTabs[0] || null;
    if (!flowTab?.url?.includes('labs.google')) {
        const allTabs = await chrome.tabs.query({});
        flowTab = allTabs.find(t => t.url?.includes('labs.google') && t.url?.includes('/project/')) || null;
    }
    if (!flowTab) {
        send('PIPELINE_DONE', { success: false, error: 'ไม่พบ Flow project tab' });
        return;
    }
    
    const tabId = flowTab.id;
    let completed = 0;
    
    try {
        // ===== ขั้นตอน 0: สร้าง Collections ก่อน =====
        const collectionNames = config.map(c => c.name).filter(n => n && n.trim().length > 0);
        if (collectionNames.length > 0) {
            send('PIPELINE_UPDATE', { step: `📁 กำลังสร้าง ${collectionNames.length} Collections...`, log: `📁 เริ่มสร้าง Collections: ${collectionNames.join(', ')}` });
            
            // ตรวจสอบว่ามี Collection อยู่แล้วหรือไม่
            const existingCheck = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const links = document.querySelectorAll('a[href*="/collection/"]');
                    return Array.from(links).map(a => (a.textContent || '').trim().toLowerCase());
                }
            });
            const existingNames = existingCheck?.[0]?.result || [];
            const namesToCreate = collectionNames.filter(name => 
                !existingNames.some(e => e.includes(name.toLowerCase()))
            );
            
            if (namesToCreate.length > 0) {
                send('PIPELINE_UPDATE', { step: `📁 สร้าง ${namesToCreate.length} Collections ใหม่...`, log: `📁 ต้องสร้างใหม่: ${namesToCreate.join(', ')}` });
                await handleBatchWorkflow(namesToCreate, 3000);
                await sleep(2000);
                send('PIPELINE_UPDATE', { step: `✅ สร้าง Collections เสร็จ!`, log: `✅ สร้าง ${namesToCreate.length} Collections เสร็จ!` });
            } else {
                send('PIPELINE_UPDATE', { step: `✅ Collections มีอยู่แล้วครบ`, log: `✅ Collections มีครบแล้ว ข้ามขั้นตอนนี้` });
            }
            
            if (workflowAborted) throw new Error('หยุดโดยผู้ใช้');
            await sleep(1000);
        }
        
        // ===== ขั้นตอนหลัก: ทำงานแต่ละ Collection =====
        for (let i = 0; i < config.length; i++) {
            if (workflowAborted) throw new Error('หยุดโดยผู้ใช้');
            const item = config[i];
            
            if (item.type === 'skip') {
                send('PIPELINE_UPDATE', { step: `⏭️ ${i+1}/${config.length} ข้าม "${item.name}"`, log: `⏭️ ข้าม "${item.name}"` });
                completed++;
                continue;
            }
            
            // === Upload: ดึงรูปจาก URL → paste เข้า collection ===
            if (item.type === 'upload') {
                send('PIPELINE_UPDATE', { step: `📤 ${i+1}/${config.length} อัพโหลดรูป "${item.name}"...`, log: `📤 อัพโหลดรูปเข้า "${item.name}"...` });
                
                // เข้า collection ก่อน
                const upClick = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (collName) => {
                        function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                        for (const el of document.querySelectorAll('a[href*="/collection/"]')) {
                            if ((el.textContent || '').includes(collName)) { realClick(el); return { ok: true }; }
                        }
                        return { ok: false };
                    },
                    args: [item.name]
                });
                if (!upClick?.[0]?.result?.ok) throw new Error(`ไม่เจอ collection "${item.name}"`);
                await waitForUrl(tabId, url => url.includes('/collection/'), 20);
                await sleep(2000);
                
                // ดึงรูปจาก URL → แปลงเป็น base64
                const imageUrl = item.imagePrompt || '';
                if (imageUrl && imageUrl.startsWith('http')) {
                    try {
                        const response = await fetch(imageUrl);
                        const blob = await response.blob();
                        const reader = new FileReader();
                        const base64 = await new Promise((resolve, reject) => {
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        
                        // Paste รูปเข้า prompt box ผ่าน synthetic paste event
                        await chrome.scripting.executeScript({
                            target: { tabId },
                            func: async (b64Data) => {
                                function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                                
                                // คลิก prompt box
                                const box = document.querySelector('div[role="textbox"][contenteditable="true"]');
                                if (box) { realClick(box); box.focus(); }
                                await new Promise(r => setTimeout(r, 500));
                                
                                // แปลง base64 → blob → File
                                const resp = await fetch(b64Data);
                                const blob = await resp.blob();
                                const file = new File([blob], 'product.png', { type: blob.type || 'image/png' });
                                
                                // สร้าง synthetic paste event
                                const dt = new DataTransfer();
                                dt.items.add(file);
                                const pasteEvent = new ClipboardEvent('paste', {
                                    bubbles: true,
                                    cancelable: true,
                                    clipboardData: dt
                                });
                                (box || document).dispatchEvent(pasteEvent);
                            },
                            args: [base64]
                        });
                        
                        send('PIPELINE_UPDATE', { log: `✅ วางรูปเข้า prompt box แล้ว` });
                        await sleep(3000);
                    } catch (fetchErr) {
                        send('PIPELINE_UPDATE', { log: `⚠️ ดึงรูปไม่ได้: ${fetchErr.message}` });
                    }
                } else {
                    send('PIPELINE_UPDATE', { log: `⚠️ ไม่มี URL รูป — ข้าม` });
                }
                
                // กลับหน้า project
                await chrome.scripting.executeScript({ target: { tabId }, func: () => window.history.back() });
                await waitForUrl(tabId, url => !url.includes('/collection/'), 20);
                await sleep(2000);
                
                completed++;
                send('PIPELINE_UPDATE', { step: `✅ ${i+1}/${config.length} "${item.name}" เสร็จ`, log: `✅ "${item.name}" เสร็จ!` });
                continue;
            }
            
            // === เข้า Collection ===
            send('PIPELINE_UPDATE', { step: `📁 ${i+1}/${config.length} เข้า "${item.name}"...`, log: `📁 เข้า "${item.name}"...` });
            
            const clickResult = await chrome.scripting.executeScript({
                target: { tabId },
                func: (collName) => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    // หา collection card ที่มีชื่อตรง
                    for (const el of document.querySelectorAll('a[href*="/collection/"]')) {
                        if ((el.textContent || '').includes(collName)) {
                            realClick(el);
                            return { ok: true, href: el.href };
                        }
                    }
                    return { ok: false };
                },
                args: [item.name]
            });
            
            if (!clickResult?.[0]?.result?.ok) throw new Error(`ไม่เจอ collection "${item.name}"`);
            
            const entered = await waitForUrl(tabId, url => url.includes('/collection/'), 20);
            if (!entered) throw new Error(`ไม่ได้เข้า collection "${item.name}"`);
            await sleep(2000);
            
            // === สร้างภาพ (ถ้า type มี image) ===
            if (item.type.includes('image') && item.imagePrompt) {
                send('PIPELINE_UPDATE', { step: `🎨 ${i+1}/${config.length} สร้างภาพ "${item.name}"...`, log: `🎨 สร้างภาพ: ${item.imagePrompt.substring(0, 40)}...` });
                
                // คลิก Prompt Box + พิมพ์
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                        const box = document.querySelector('div[role="textbox"][contenteditable="true"]');
                        if (box) { realClick(box); box.focus(); }
                    }
                });
                await sleep(500);
                await cdpTypeText(tabId, item.imagePrompt);
                await sleep(1000);
                
                // ตั้งค่า + Create
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: async () => {
                        const sleep = ms => new Promise(r => setTimeout(r, ms));
                        function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                        
                        // เปิดตั้งค่า
                        for (const btn of document.querySelectorAll('button')) {
                            if ((btn.textContent || '').includes('Banana') && btn.getBoundingClientRect().y > 700) { realClick(btn); break; }
                        }
                        await sleep(800);
                        // Image tab
                        for (const btn of document.querySelectorAll('button[role="tab"]')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'image') { realClick(btn); break; }
                        }
                        await sleep(300);
                        // 9:16
                        for (const btn of document.querySelectorAll('button[role="tab"]')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'crop_9_16') { realClick(btn); break; }
                        }
                        await sleep(300);
                        // x1
                        for (const btn of document.querySelectorAll('button[role="tab"]')) {
                            if (btn.textContent.trim() === 'x1') { realClick(btn); break; }
                        }
                        await sleep(300);
                        // Create
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'arrow_forward') { realClick(btn); break; }
                        }
                    }
                });
                await sleep(2000);
                send('PIPELINE_UPDATE', { log: `✅ กด Create สร้างภาพแล้ว` });
            }
            
            // === สร้างวิดีโอ (ถ้า type มี video) ===
            if (item.type.includes('video') && item.videoPrompt) {
                // ถ้าสร้างภาพด้วย ต้องรอเสร็จก่อน
                if (item.type.includes('image')) {
                    send('PIPELINE_UPDATE', { step: `⏳ ${i+1}/${config.length} รอภาพ "${item.name}" generate...`, log: `⏳ รอภาพ generate...` });
                    // TODO: poll % progress จนเสร็จ (ต้อง implement ภายหลัง)
                    await sleep(60000); // ชั่วคราว: รอ 60 วินาที
                    send('PIPELINE_UPDATE', { log: `✅ (รอครบ 60 วิ)` });
                }
                
                send('PIPELINE_UPDATE', { step: `🎬 ${i+1}/${config.length} สร้างวิดีโอ "${item.name}"...`, log: `🎬 สร้างวิดีโอ: ${item.videoPrompt.substring(0, 40)}...` });
                
                // คลิก Prompt Box + พิมพ์ video prompt
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                        const boxes = document.querySelectorAll('div[role="textbox"][contenteditable="true"]');
                        const box = boxes[boxes.length - 1]; // prompt box ล่าสุด
                        if (box) { realClick(box); box.focus(); }
                    }
                });
                await sleep(500);
                await cdpTypeText(tabId, item.videoPrompt);
                await sleep(1000);
                
                // ตั้งค่า Video + Create
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: async () => {
                        const sleep = ms => new Promise(r => setTimeout(r, ms));
                        function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                        
                        // เปิดตั้งค่า
                        for (const btn of document.querySelectorAll('button')) {
                            if ((btn.textContent || '').includes('Banana') && btn.getBoundingClientRect().y > 700) { realClick(btn); break; }
                        }
                        await sleep(800);
                        // Video tab
                        for (const btn of document.querySelectorAll('button[role="tab"]')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'videocam') { realClick(btn); break; }
                        }
                        await sleep(300);
                        // Ingredients
                        for (const btn of document.querySelectorAll('button[role="tab"]')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'chrome_extension') { realClick(btn); break; }
                        }
                        await sleep(300);
                        // 9:16
                        for (const btn of document.querySelectorAll('button[role="tab"]')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'crop_9_16') { realClick(btn); break; }
                        }
                        await sleep(300);
                        // x1
                        for (const btn of document.querySelectorAll('button[role="tab"]')) {
                            if (btn.textContent.trim() === 'x1') { realClick(btn); break; }
                        }
                        await sleep(300);
                        // Veo 3.1 model
                        // ปิด dropdown ก่อน
                        document.documentElement.click();
                        await sleep(300);
                        // TODO: เลือก Veo 3.1 (ต้อง implement selector ที่ถูกต้อง)
                        // Create
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'arrow_forward') { realClick(btn); break; }
                        }
                    }
                });
                await sleep(2000);
                send('PIPELINE_UPDATE', { log: `✅ กด Create สร้างวิดีโอแล้ว` });
            }
            
            // === กลับหน้า project ===
            await chrome.scripting.executeScript({ target: { tabId }, func: () => window.history.back() });
            await waitForUrl(tabId, url => !url.includes('/collection/'), 20);
            await sleep(2000);
            
            completed++;
            send('PIPELINE_UPDATE', { step: `✅ ${i+1}/${config.length} "${item.name}" เสร็จ`, log: `✅ "${item.name}" เสร็จ!` });
        }
        
        send('PIPELINE_DONE', { success: true, count: completed });
    } catch (err) {
        send('PIPELINE_DONE', { success: false, error: err.message, count: completed });
        console.log('[Pipeline] Error:', err.message);
    }
}

// ===== Create Collections: แยก inject ทีละ step (แก้ปัญหา context ถูกทำลายเมื่อ navigate) =====
async function handleCreateCollections(names) {
    updateStatus('working', `📁 กำลังสร้าง ${names.length} collections...`);

    // ใช้ tab ที่ active อยู่ (รองรับหลาย tab)
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let flowTab = activeTabs[0] || null;
    // fallback: ถ้า active tab ไม่ใช่ Flow → หาจากทุก tab
    if (!flowTab?.url?.includes('labs.google')) {
        const allTabs = await chrome.tabs.query({});
        flowTab = allTabs.find(t => t.url?.includes('labs.google') && t.url?.includes('/project/')) || null;
    }

    if (!flowTab) {
        addLog('❌ ไม่พบ Flow tab!');
        updateStatus('error', '❌ เปิด Flow project ก่อน');
        return;
    }

    addLog(`📂 พบ Flow tab (id:${flowTab.id})`);

    // === Helper: inject realClick function ===
    const REAL_CLICK_CODE = `
        function realClick(el) {
            const rect = el.getBoundingClientRect();
            const x = rect.x + rect.width / 2;
            const y = rect.y + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
        }
    `;

    // === Helper: รอ URL เปลี่ยน ===
    async function waitForUrl(tabId, condition, timeoutSec = 30) {
        for (let i = 0; i < timeoutSec; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const tab = await chrome.tabs.get(tabId);
                if (condition(tab.url)) return true;
            } catch (e) { return false; }
        }
        return false;
    }

    try {
        for (let i = 0; i < names.length; i++) {
            addLog(`📁 สร้าง ${i + 1}/${names.length}: "${names[i]}"...`);

            // ====== Step A: สร้าง Collection + คลิกเข้าไป ======
            const stepA = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: async () => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    function realClick(el) {
                        const rect = el.getBoundingClientRect();
                        const x = rect.x + rect.width / 2;
                        const y = rect.y + rect.height / 2;
                        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                        el.dispatchEvent(new PointerEvent('pointerdown', opts));
                        el.dispatchEvent(new MouseEvent('mousedown', opts));
                        el.dispatchEvent(new PointerEvent('pointerup', opts));
                        el.dispatchEvent(new MouseEvent('mouseup', opts));
                        el.dispatchEvent(new MouseEvent('click', opts));
                    }

                    // หา Add Media
                    let addBtn = null;
                    for (let r = 0; r < 15; r++) {
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'add') {
                                const rect = btn.getBoundingClientRect();
                                if (rect.width > 0 && rect.y < 80) { addBtn = btn; break; }
                            }
                        }
                        if (addBtn) break;
                        await sleep(800);
                    }
                    if (!addBtn) return { ok: false, error: 'หา Add Media ไม่เจอ' };

                    realClick(addBtn);
                    await sleep(2000);

                    // หา Create Collection
                    let ccItem = null;
                    for (let r = 0; r < 15; r++) {
                        for (const item of document.querySelectorAll('[role="menuitem"]')) {
                            if ((item.textContent || '').includes('Collection')) { ccItem = item; break; }
                        }
                        if (ccItem) break;
                        await sleep(800);
                    }
                    if (!ccItem) return { ok: false, error: 'หา Create Collection ไม่เจอ' };

                    realClick(ccItem);
                    await sleep(3000);

                    // คลิกเข้าไปใน collection ที่เพิ่งสร้าง
                    let clicked = false;
                    for (let r = 0; r < 15; r++) {
                        const links = document.querySelectorAll('a[href*="/collection/"]');
                        if (links.length > 0) {
                            realClick(links[links.length - 1]);
                            clicked = true;
                            break;
                        }
                        const imgs = document.querySelectorAll('img[src*="placeholder"]');
                        if (imgs.length > 0) {
                            const card = imgs[imgs.length - 1].closest('a') || imgs[imgs.length - 1].parentElement;
                            if (card) { realClick(card); clicked = true; break; }
                        }
                        await sleep(1000);
                    }

                    return { ok: true, clicked };
                }
            });

            const resultA = stepA?.[0]?.result;
            if (!resultA?.ok) {
                addLog(`❌ Step A: ${resultA?.error || 'unknown'}`);
                updateStatus('error', `❌ ${resultA?.error}`);
                return;
            }

            // รอจน URL มี /collection/ (navigate เข้า collection แล้ว)
            const entered = await waitForUrl(flowTab.id, url => url.includes('/collection/'), 20);
            if (!entered) {
                addLog('⚠️ ไม่ได้เข้า collection — ข้ามการ rename');
            } else {
                await new Promise(r => setTimeout(r, 2000)); // รอ UI โหลด

                // ====== Step B: เปลี่ยนชื่อ ด้วย CDP Keyboard (Real events!) ======
                // B1: inject เพื่อ click + focus title input
                const stepB1 = await chrome.scripting.executeScript({
                    target: { tabId: flowTab.id },
                    func: async () => {
                        const sleep = ms => new Promise(r => setTimeout(r, ms));
                        function realClick(el) {
                            const rect = el.getBoundingClientRect();
                            const x = rect.x + rect.width / 2;
                            const y = rect.y + rect.height / 2;
                            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                            el.dispatchEvent(new PointerEvent('pointerdown', opts));
                            el.dispatchEvent(new MouseEvent('mousedown', opts));
                            el.dispatchEvent(new PointerEvent('pointerup', opts));
                            el.dispatchEvent(new MouseEvent('mouseup', opts));
                            el.dispatchEvent(new MouseEvent('click', opts));
                        }
                        let titleInput = null;
                        for (let r = 0; r < 15; r++) {
                            for (const inp of document.querySelectorAll('input[aria-label="Editable text"]')) {
                                const rect = inp.getBoundingClientRect();
                                if (rect.y < 60 && rect.width > 0) { titleInput = inp; break; }
                            }
                            if (titleInput) break;
                            await sleep(800);
                        }
                        if (!titleInput) return { ok: false, error: 'หา title input ไม่เจอ' };
                        realClick(titleInput);
                        await sleep(300);
                        titleInput.focus();
                        return { ok: true };
                    }
                });

                if (!stepB1?.[0]?.result?.ok) {
                    addLog(`⚠️ Rename B1: ${stepB1?.[0]?.result?.error || 'click failed'}`);
                } else {
                    await new Promise(r => setTimeout(r, 500));

                    // B2: ใช้ CDP พิมพ์จริง
                    try {
                        await cdpTypeText(flowTab.id, names[i]);
                        addLog(`✏️ CDP พิมพ์: "${names[i]}"`);
                    } catch (e) {
                        addLog(`⚠️ CDP type error: ${e.message}`);
                    }

                    await new Promise(r => setTimeout(r, 1000));

                    // B3: inject เพื่อกด Done
                    const stepB3 = await chrome.scripting.executeScript({
                        target: { tabId: flowTab.id },
                        func: async () => {
                            const sleep = ms => new Promise(r => setTimeout(r, ms));
                            function realClick(el) {
                                const rect = el.getBoundingClientRect();
                                const x = rect.x + rect.width / 2;
                                const y = rect.y + rect.height / 2;
                                const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                                el.dispatchEvent(new PointerEvent('pointerdown', opts));
                                el.dispatchEvent(new MouseEvent('mousedown', opts));
                                el.dispatchEvent(new PointerEvent('pointerup', opts));
                                el.dispatchEvent(new MouseEvent('mouseup', opts));
                                el.dispatchEvent(new MouseEvent('click', opts));
                            }
                            // หา Done button
                            for (let r = 0; r < 10; r++) {
                                for (const btn of document.querySelectorAll('button')) {
                                    const rect = btn.getBoundingClientRect();
                                    if (rect.width > 0 && rect.height > 0 && rect.y < 60) {
                                        const icon = btn.querySelector('i');
                                        const iconText = icon ? icon.textContent.trim() : '';
                                        if (iconText === 'done' || iconText === 'check') {
                                            realClick(btn);
                                            await sleep(500);
                                            return { ok: true, clicked: iconText };
                                        }
                                    }
                                }
                                await sleep(500);
                            }
                            return { ok: false, error: 'Done button ไม่เจอ' };
                        }
                    });
                    const b3 = stepB3?.[0]?.result;
                    if (b3?.ok) {
                        addLog(`✅ กด Done สำเร็จ!`);
                    } else {
                        addLog(`⚠️ Done: ${b3?.error || 'unknown'}`);
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }

                // ====== Step C: กลับหน้า project ======
                await chrome.scripting.executeScript({
                    target: { tabId: flowTab.id },
                    func: () => { window.history.back(); }
                });

                // รอจน URL ไม่มี /collection/
                await waitForUrl(flowTab.id, url => !url.includes('/collection/'), 20);
                await new Promise(r => setTimeout(r, 2000)); // รอ UI โหลด
            }

            addLog(`✅ ${i + 1}/${names.length}: "${names[i]}" เสร็จ!`);
        }

        addLog(`✅ สร้าง ${names.length} collections สำเร็จทั้งหมด!`);
        updateStatus('done', `📁 สร้าง ${names.length} collections เสร็จ!`);
    } catch (err) {
        addLog('❌ Error: ' + err.message);
        updateStatus('error', '❌ ' + err.message);
    }
}


// ===== Rename Collection: เปลี่ยนชื่อ collection ตัวเดียว =====
async function handleRenameCollection(index, name) {
    updateStatus('working', `✏️ กำลังเปลี่ยนชื่อ collection #${index + 1}...`);

    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let flowTab = activeTabs[0] || null;
    if (!flowTab?.url?.includes('labs.google')) {
        const allTabs = await chrome.tabs.query({});
        flowTab = allTabs.find(t => t.url?.includes('labs.google') && t.url?.includes('/project/')) || null;
    }

    if (!flowTab) {
        addLog('❌ ไม่พบ Flow project tab!');
        updateStatus('error', '❌ เปิด Flow project ก่อน');
        return;
    }

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: flowTab.id },
            func: async (targetIndex, newName) => {
                const sleep = ms => new Promise(r => setTimeout(r, ms));

                function realClick(el) {
                    const rect = el.getBoundingClientRect();
                    const x = rect.x + rect.width / 2;
                    const y = rect.y + rect.height / 2;
                    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                    el.dispatchEvent(new PointerEvent('pointerdown', opts));
                    el.dispatchEvent(new MouseEvent('mousedown', opts));
                    el.dispatchEvent(new PointerEvent('pointerup', opts));
                    el.dispatchEvent(new MouseEvent('mouseup', opts));
                    el.dispatchEvent(new MouseEvent('click', opts));
                }

                try {
                    // หา more_vert buttons
                    const moreVerts = [];
                    for (const btn of document.querySelectorAll('button')) {
                        if ((btn.textContent || '').includes('more_vert')) {
                            const r = btn.getBoundingClientRect();
                            if (r.width > 5 && r.height > 5 && r.y > 50)
                                moreVerts.push({ btn, x: r.x, y: r.y });
                        }
                    }
                    moreVerts.sort((a, b) => Math.abs(a.y - b.y) < 30 ? a.x - b.x : a.y - b.y);

                    if (moreVerts.length === 0) return { success: false, error: 'ไม่พบ more_vert' };
                    if (targetIndex >= moreVerts.length) return { success: false, error: `มี ${moreVerts.length} collections, แต่ต้องการ #${targetIndex + 1}` };

                    console.log(`[Rename] กด more_vert #${targetIndex + 1}`);
                    realClick(moreVerts[targetIndex].btn);
                    await sleep(1200);

                    // หา Rename menuitem
                    let renItem = null;
                    for (let r = 0; r < 10; r++) {
                        for (const item of document.querySelectorAll('[role="menuitem"]')) {
                            if ((item.textContent || '').includes('Rename')) { renItem = item; break; }
                        }
                        if (renItem) break;
                        await sleep(800);
                    }
                    if (!renItem) return { success: false, error: 'หา Rename ไม่เจอ' };

                    realClick(renItem);
                    await sleep(1200);

                    // หา input
                    const input = document.querySelector('input[aria-label="Editable text"]');
                    if (!input) return { success: false, error: 'หา input ไม่เจอ' };

                    input.focus();
                    await sleep(200);
                    input.select();
                    await sleep(100);

                    // พิมพ์ชื่อใหม่
                    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                    setter.call(input, newName);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    await sleep(600);

                    // กด Done
                    let doneBtn = null;
                    for (let r = 0; r < 8; r++) {
                        for (const btn of document.querySelectorAll('button')) {
                            if ((btn.textContent || '').includes('Done')) {
                                const rect = btn.getBoundingClientRect();
                                if (rect.width > 0) { doneBtn = btn; break; }
                            }
                        }
                        if (doneBtn) break;
                        await sleep(500);
                    }
                    if (doneBtn) realClick(doneBtn);
                    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

                    await sleep(1000);
                    console.log(`[Rename] ✅ เปลี่ยนชื่อเป็น "${newName}"`);
                    return { success: true, name: newName };
                } catch (err) {
                    return { success: false, error: err.message };
                }
            },
            args: [index, name]
        });

        const result = results?.[0]?.result;
        if (result?.success) {
            addLog(`✅ เปลี่ยนชื่อเป็น "${result.name}" สำเร็จ!`);
            updateStatus('done', `✏️ เปลี่ยนชื่อเสร็จ!`);
        } else {
            addLog(`❌ เปลี่ยนชื่อไม่ได้: ${result?.error || 'unknown'}`);
            updateStatus('error', `❌ ${result?.error || 'เปลี่ยนชื่อไม่ได้'}`);
        }
    } catch (err) {
        addLog('❌ Inject error: ' + err.message);
        updateStatus('error', '❌ ' + err.message);
    }
}


// ===== Script พร้อม → เก็บ + เปิด Flow + Auto Pipeline =====
async function handleScriptReady(script, sender) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    console.log('[Bot] Script ready:', script.title);
    addLog(`✅ ได้สคริปต์: "${script.title}" — ${script.scenes?.length} ซีน`);

    // เก็บข้อมูล
    await chrome.storage.local.set({
        currentScript: script,
        currentSceneIndex: 0,
        currentPhase: 'image',
        waitingForScript: false,
        pipelineStep: 'character'
    });

    updateStatus('working', `ได้สคริปต์! "${script.title}" — เริ่มสร้างใน Flow...`);

    // ปิด tab Gemini ถ้ามี
    if (sender?.tab?.id) {
        try { chrome.tabs.remove(sender.tab.id); } catch (e) { }
    }

    // เปิด Flow
    try {
        addLog('🎬 กำลังเปิด Google Flow...');
        const flowTab = await chrome.tabs.create({
            url: 'https://labs.google/fx/tools/flow',
            active: true
        });
        addLog(`🎬 Flow tab created (id:${flowTab.id})`);

        // รอ Flow โหลดเสร็จ (timeout 60 วินาที)
        await Promise.race([
            new Promise(resolve => {
                chrome.tabs.onUpdated.addListener(function flowListener(tabId, info) {
                    if (tabId !== flowTab.id || info.status !== 'complete') return;
                    chrome.tabs.onUpdated.removeListener(flowListener);
                    resolve();
                });
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Flow load timeout (60s)')), 60000))
        ]);
        addLog('🎬 Flow โหลดเสร็จ → กด New project...');
        await sleep(6000);

        // กด New Project
        try {
            await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: clickNewProjectButton
            });
            addLog('✅ กด New project แล้ว');
        } catch (err) {
            addLog('⚠️ กด New project ไม่ได้: ' + err.message);
        }

        // รอเข้าหน้า /project/
        const entered = await waitForUrl(flowTab.id, url => url.includes('/project/'), 45);
        if (!entered) {
            addLog('❌ ไม่ได้เข้าหน้า project — ลองรัน Auto Pipeline ด้วยตัวเอง');
            return;
        }
        addLog('📂 เข้าหน้า project แล้ว!');
        updateStatus('working', `🚀 เริ่ม Auto Pipeline — "${script.title}"`);
        
        // === 🚀 Auto-start Full Pipeline ===
        await sleep(3000);
        addLog('🚀 เริ่ม Full Auto Pipeline อัตโนมัติ...');
        
        const pendingData = await chrome.storage.local.get(['pendingImage']);
        
        // Fallback: ดึง characterPrompt จาก characters array ถ้าไม่มี top-level field
        const charPrompt = script.characterPrompt 
            || script.characters?.[0]?.promptEN 
            || '1girl, Thai woman, 25 years old, long black hair, casual clothing, smiling, looking at camera, studio lighting, portrait photo, 9:16';
        addLog(`👤 Character prompt: ${charPrompt.substring(0, 60)}...`);
        
        handleFullPipeline({
            charPrompt: charPrompt,
            productImageUrl: pendingData.pendingImage || '',
            scenes: script.scenes,
            delay: 2000
        });
    } catch (err) {
        console.error('[Bot] Flow open error:', err);
        addLog('❌ เปิด Flow ไม่ได้: ' + err.message);
        updateStatus('error', '❌ เปิด Flow ล้มเหลว: ' + err.message);
    }
}


// ===== ใช้ API ช่วย parse response จาก Gem =====
async function handleGemResponse(rawText) {
    try {
        const script = await fixAndParseJSON(rawText);

        if (script) {
            const validation = validateScript(script);
            if (validation.valid) {
                addLog('✅ JSON ถูกต้องครบถ้วน');
                return { success: true, script: validation.script };
            } else {
                addLog(`⚠️ JSON มีข้อมูลไม่ครบ: ${validation.errors.join(', ')}`);
                return { success: true, script: validation.script };
            }
        }

        addLog('❌ แก้ JSON ไม่สำเร็จ');
        return { success: false, error: 'Cannot parse JSON' };

    } catch (err) {
        addLog('❌ Parse error: ' + err.message);
        return { success: false, error: err.message };
    }
}


// ===== Utilities =====
async function updateStatus(state, message) {
    try {
        await fetch(`${DB_URL}/status.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state, message, updatedAt: Date.now() })
        });
    } catch (e) { }
    // ส่งไป sidepanel ด้วย
    chrome.runtime.sendMessage({ type: 'BOT_STATUS', state, message }).catch(() => {});
}

function addLog(message) {
    const entry = { time: new Date().toLocaleTimeString('th-TH'), message };
    chrome.storage.local.get(['botLogs'], (data) => {
        const logs = data.botLogs || [];
        logs.push(entry);
        while (logs.length > 100) logs.shift();
        chrome.storage.local.set({ botLogs: logs });
    });
    console.log(`[Bot] ${entry.time} ${message}`);
    // ส่ง log ไป sidepanel ด้วย
    chrome.runtime.sendMessage({ type: 'BOT_LOG', ...entry }).catch(() => {});
}

// ===== Test Actions: ทดสอบทีละ step =====
async function handleTestAction(msg, sendResponse) {
    // ใช้ tab ที่ active อยู่ → รองรับหลาย tab
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let flowTab = activeTabs[0] || null;
    if (!flowTab?.url?.includes('labs.google')) {
        const allTabs = await chrome.tabs.query({});
        flowTab = allTabs.find(t => t.url?.includes('labs.google') && (t.url?.includes('/project/') || t.url?.includes('/collection/'))) || null;
    }
    if (!flowTab) {
        sendResponse({ error: 'ไม่พบ Flow tab' });
        return;
    }

    const REAL_CLICK_FUNC = `
        function realClick(el) {
            const rect = el.getBoundingClientRect();
            const x = rect.x + rect.width / 2;
            const y = rect.y + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
        }
    `;

    try {
        let results;

        if (msg.action === 'DUMP_BUTTONS') {
            results = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: () => {
                    let out = '';
                    for (const btn of document.querySelectorAll('button')) {
                        const r = btn.getBoundingClientRect();
                        if (r.y < 60 && r.width > 0 && r.height > 0) {
                            const icon = btn.querySelector('i');
                            out += `BTN x=${r.x.toFixed(0)} y=${r.y.toFixed(0)} w=${r.width.toFixed(0)} h=${r.height.toFixed(0)} ` +
                                `text="${(btn.textContent || '').substring(0, 30).trim()}" ` +
                                `icon="${icon ? icon.textContent.trim() : 'none'}"\n`;
                        }
                    }
                    return out || '(ไม่มี button ที่ y<60)';
                }
            });
        }

        else if (msg.action === 'DUMP_INPUTS') {
            results = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: () => {
                    let out = '';
                    for (const inp of document.querySelectorAll('input')) {
                        const r = inp.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            out += `INPUT x=${r.x.toFixed(0)} y=${r.y.toFixed(0)} w=${r.width.toFixed(0)} ` +
                                `aria="${inp.getAttribute('aria-label') || ''}" val="${inp.value.substring(0, 30)}"\n`;
                        }
                    }
                    return out || '(ไม่มี input)';
                }
            });
        }

        else if (msg.action === 'CLICK_ADD_MEDIA') {
            results = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const btn of document.querySelectorAll('button')) {
                        const icon = btn.querySelector('i');
                        if (icon && icon.textContent.trim() === 'add') {
                            const r = btn.getBoundingClientRect();
                            if (r.width > 0 && r.y < 80) { realClick(btn); return 'กด Add Media ที่ x=' + r.x.toFixed(0) + ' y=' + r.y.toFixed(0); }
                        }
                    }
                    return '❌ หา Add Media ไม่เจอ';
                }
            });
        }

        else if (msg.action === 'CREATE_AND_ENTER_COLL') {
            results = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: async () => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    function realClick(el) {
                        const rect = el.getBoundingClientRect();
                        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
                        const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
                        el.dispatchEvent(new PointerEvent('pointerdown', o));
                        el.dispatchEvent(new MouseEvent('mousedown', o));
                        el.dispatchEvent(new PointerEvent('pointerup', o));
                        el.dispatchEvent(new MouseEvent('mouseup', o));
                        el.dispatchEvent(new MouseEvent('click', o));
                    }
                    // 1) Add Media
                    let addBtn = null;
                    for (let r = 0; r < 15; r++) {
                        for (const btn of document.querySelectorAll('button')) {
                            const icon = btn.querySelector('i');
                            if (icon && icon.textContent.trim() === 'add') {
                                const rect = btn.getBoundingClientRect();
                                if (rect.width > 0 && rect.y < 80) { addBtn = btn; break; }
                            }
                        }
                        if (addBtn) break;
                        await sleep(800);
                    }
                    if (!addBtn) return '❌ Add Media ไม่เจอ';
                    realClick(addBtn);
                    await sleep(2000);
                    // 2) Create Collection
                    let ccItem = null;
                    for (let r = 0; r < 15; r++) {
                        for (const item of document.querySelectorAll('[role="menuitem"]')) {
                            if ((item.textContent || '').includes('Collection')) { ccItem = item; break; }
                        }
                        if (ccItem) break;
                        await sleep(800);
                    }
                    if (!ccItem) return '❌ Create Collection ไม่เจอ';
                    realClick(ccItem);
                    await sleep(3000);
                    // 3) Click collection card
                    for (let r = 0; r < 15; r++) {
                        const links = document.querySelectorAll('a[href*="/collection/"]');
                        if (links.length > 0) {
                            realClick(links[links.length - 1]);
                            return '✅ สร้าง + คลิกเข้า collection (มี ' + links.length + ' ตัว)';
                        }
                        await sleep(1000);
                    }
                    return '⚠️ สร้างแล้ว แต่ไม่พบ collection card';
                }
            });
        }

        else if (msg.action === 'CLICK_CREATE_COLL') {
            results = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const item of document.querySelectorAll('[role="menuitem"]')) {
                        if ((item.textContent || '').includes('Collection')) { realClick(item); return 'กด Create Collection!'; }
                    }
                    return '❌ หา Create Collection ไม่เจอ (กด Add Media ก่อน)';
                }
            });
        }

        else if (msg.action === 'CLICK_NEW_COLL') {
            const hrefRes = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: () => [...document.querySelectorAll('a[href*="/collection/"]')].map(a => a.href)
            });
            const hrefs = hrefRes?.[0]?.result || [];
            if (hrefs.length > 0) {
                const href = hrefs[hrefs.length - 1];
                await chrome.tabs.update(flowTab.id, { url: href });
                results = [{ result: '🆕 navigate → ' + href.split('/').pop() }];
            } else {
                results = [{ result: '❌ ไม่พบ collection card' }];
            }
        }

        else if (msg.action === 'WAIT_COLLECTION_URL') {
            const ok = await waitForUrl(flowTab.id, url => url.includes('/collection/'), 20);
            results = [{ result: ok ? '✅ URL มี /collection/ แล้ว' : '❌ timeout — URL ไม่มี /collection/' }];
        }

        else if (msg.action === 'CLICK_TITLE') {
            results = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    for (const inp of document.querySelectorAll('input[aria-label="Editable text"]')) {
                        const r = inp.getBoundingClientRect();
                        if (r.y < 60 && r.width > 0) {
                            realClick(inp); inp.focus();
                            return 'คลิก title: "' + inp.value + '" at y=' + r.y.toFixed(0);
                        }
                    }
                    return '❌ หา title input ไม่เจอ';
                }
            });
        }

        else if (msg.action === 'TYPE_NAME') {
            try {
                await cdpTypeText(flowTab.id, msg.name || 'ตัวละคร');
                results = [{ result: '✅ CDP พิมพ์: "' + (msg.name || 'ตัวละคร') + '"' }];
            } catch(e) {
                results = [{ result: '❌ CDP error: ' + e.message }];
            }
        }

        else if (msg.action === 'CLICK_DONE') {
            results = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: () => {
                    function realClick(el) { const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o)); }
                    // log ทุก button ที่ y<60
                    let all = '';
                    for (const btn of document.querySelectorAll('button')) {
                        const r = btn.getBoundingClientRect();
                        if (r.y < 60 && r.width > 0 && r.height > 0) {
                            const icon = btn.querySelector('i');
                            const iconText = icon ? icon.textContent.trim() : '';
                            all += `[${r.x.toFixed(0)},${r.y.toFixed(0)}] "${iconText}" `;
                            if (iconText === 'done' || iconText === 'check') {
                                realClick(btn);
                                return '✅ กด Done! icon=' + iconText + ' at ' + r.x.toFixed(0) + ',' + r.y.toFixed(0) + '\nAll: ' + all;
                            }
                        }
                    }
                    return '❌ ไม่เจอ Done button\nButtons at y<60: ' + (all || 'none');
                }
            });
        }

        else if (msg.action === 'GO_BACK') {
            results = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                func: () => { window.history.back(); return 'กด history.back()'; }
            });
        }

        const result = results?.[0]?.result || 'no result';
        sendResponse({ result });
    } catch (err) {
        sendResponse({ error: err.message });
    }
}

