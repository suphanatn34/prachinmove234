// ============================================
// Content Script — Google Flow Automation v5.0
// ใช้ selector จาก Recording 132 actions + auto-retry + step reporting
// Updated: 2026-03-22
// ============================================

// ===== Guard: ป้องกันรันซ้ำ =====
if (window.__FLOW_BOT_RUNNING__) {
    console.log('[Flow] ⚠️ Already running — skip');
} else {
    window.__FLOW_BOT_RUNNING__ = true;
    runFlowAutomation();
}

// ===== ตัวแปร Global =====
var notifyRoot = null;
var lockScreenRoot = null;
var hasRefreshed = false;
const MAX_RETRY = 2;
const STOP_CHECK_URL = 'https://affiliate-bot-ee9a2-default-rtdb.firebaseio.com';
let shouldStop = false;

// เช็คคำสั่งหยุดจาก Dashboard
async function checkStopSignal() {
    try {
        const resp = await fetch(`${STOP_CHECK_URL}/stopSignal.json`, { cache: 'no-store' });
        const data = await resp.json();
        if (data && data.stop === true) {
            shouldStop = true;
            // ลบสัญญาณหยุดทิ้ง เพื่อไม่ให้ค้างรอบหน้า
            fetch(`${STOP_CHECK_URL}/stopSignal.json`, { method: 'DELETE' }).catch(() => {});
            return true;
        }
    } catch (e) { /* ignore */ }
    return false;
}

async function runFlowAutomation() {
    try {
        console.log('[Flow] ====== Content script v5.0 ======');
        console.log('[Flow] URL:', window.location.href);
        initNotify();
        showLockScreen();
        updateLockStatus('🤖 เริ่มทำงาน...', 'กำลังโหลด...');
        notify('🤖 Extension v5.0 เริ่มทำงาน...');
        stepUpdate('init', '🤖 เริ่มทำงาน...');
        await sleep(3000);

        // ===== ถ้าอยู่หน้า homepage → แจ้งแล้วจบ =====
        if (!window.location.pathname.includes('/project/')) {
            notify('📂 รอ background กด New project...');
            removeLockScreen();
            window.__FLOW_BOT_RUNNING__ = false;
            return;
        }

        // === ตั้ง observer จับ error ===
        setupPromptErrorDetector();

        // ===== โหลด script (retry) =====
        notify('📋 กำลังโหลดสคริปต์...');
        let data = null;
        for (let attempt = 0; attempt < 10; attempt++) {
            data = await new Promise(r => chrome.storage.local.get(
                ['currentScript', 'currentSceneIndex', 'currentPhase', 'pendingImage', 'pipelineStep', 'flowRetryCount'], r
            ));
            if (data?.currentScript?.scenes?.length) break;
            await sleep(2000);
        }

        if (!data?.currentScript?.scenes?.length) {
            notify('❌ ไม่พบสคริปต์! ลองส่งงานใหม่', 'error');
            removeLockScreen();
            window.__FLOW_BOT_RUNNING__ = false;
            return;
        }

        const script = data.currentScript;
        const startIndex = data.currentSceneIndex || 0;
        const flowRetryCount = data.flowRetryCount || 0;
        notify(`✅ ได้สคริปต์: "${script.title}" — ${script.scenes.length} ซีน${startIndex > 0 ? ' (เริ่มจากซีน ' + (startIndex+1) + ')' : ''}${flowRetryCount > 0 ? ' [retry ' + flowRetryCount + ']' : ''}`, 'success');
        stepUpdate('loaded', `โหลดสคริปต์: ${script.title}`);
        await sleep(2000);

        // === รอ UI พร้อม ===
        const uiReady = await waitForFlowUI(60);
        if (!uiReady) {
            notify('❌ Flow UI ไม่โหลด', 'error');
            removeLockScreen();
            window.__FLOW_BOT_RUNNING__ = false;
            return;
        }
        notify('✅ Flow พร้อม!', 'success');

        // ========================================
        // STEP 1: สร้างตัวละคร → ภาพ (Image)
        // ========================================
        if (script.characterPrompt && startIndex === 0) {
            notify('👤 STEP 1: สร้างตัวละคร (ภาพ)...');
            stepUpdate('character', '👤 กำลังสร้างตัวละคร...');
            updateLockStatus('👤 สร้างตัวละคร', `กำลังตั้งค่า Image mode...`);
            await chrome.storage.local.set({ pipelineStep: 'character' });

            await setupImageMode();
            await sleep(1000);

            await clearAndType(script.characterPrompt);
            await sleep(1500);

            await clickCreateArrow();
            const charOk = await waitForNewContent(180);

            if (charOk) {
                notify('✅ สร้างตัวละครเสร็จ! → Add to Prompt', 'success');
                chrome.runtime.sendMessage({ type: 'CHARACTER_DONE' });
                await sleep(3000);
                await clickMoreMenu();
                await sleep(1500);
                await clickMenuItem('add', 'Add to Prompt');
                await sleep(2000);
            } else {
                notify('⚠️ สร้างตัวละคร timeout', 'warning');
            }
        }

        // ========================================
        // STEP 2: สร้างซีนทั้งหมด
        // ========================================
        await chrome.storage.local.set({ pipelineStep: 'scenes' });
        updateLockStatus('🎬 สร้างซีน', `เตรียมสร้าง ${script.scenes.length} ซีน...`);
        notify(`🎬 STEP 2: สร้าง ${script.scenes.length} ซีน...`);

        for (let i = startIndex; i < script.scenes.length; i++) {
            // === เช็คคำสั่งหยุด ===
            if (await checkStopSignal()) {
                notify('⏹️ ได้รับคำสั่งหยุด! หยุดทำงาน...', 'warning');
                stepUpdate('stopped', '⏹️ หยุดทำงานตามคำสั่ง');
                removeLockScreen();
                window.__FLOW_BOT_RUNNING__ = false;
                chrome.runtime.sendMessage({ type: 'ALL_DONE' });
                return;
            }
            const scene = script.scenes[i];
            const sn = scene.sceneNumber || (i + 1);
            const total = script.scenes.length;

            await chrome.storage.local.set({ currentSceneIndex: i, currentPhase: 'image' });
            stepUpdate('scene-image', `🎨 ซีน ${sn}/${total}: สร้างภาพ...`);
            updateLockStatus(`🎨 ซีน ${sn}/${total}: สร้างภาพ`, `Image mode → พิมพ์ prompt → รอสร้าง...`, sn, total);

            // ==========================================
            // Phase A: สร้างภาพซีน (Image) + auto-retry
            // ==========================================
            let imgSuccess = false;
            for (let retry = 0; retry <= MAX_RETRY; retry++) {
                if (retry > 0) {
                    notify(`🔄 ซีน ${sn}: ลองสร้างภาพใหม่ (ครั้งที่ ${retry + 1})...`, 'warning');
                    stepUpdate('retry-image', `🔄 ซีน ${sn}: retry ครั้งที่ ${retry + 1}`);
                } else {
                    notify(`🎨 ซีน ${sn}/${total}: สร้างภาพ...`);
                }

                await setupImageMode();
                await sleep(1000);

                // ล้างและพิมพ์ข้อความก่อน เพื่อไม่ให้ไปลบเรฟภาพที่จะใส่ทีหลัง!
                const imgText = scene.imagePromptEN || scene.imagePromptTH || '';
                if (imgText) {
                    await clearAndType(imgText);
                    await sleep(1500);
                }

                if (scene.hasCharacter) {
                    if (script.characterPrompt) {
                        // ★ ใช้ prompt ตัวเดียวกับที่สร้างตัวละครจริง (บันทึกโดย background.js)
                        // ★ ถ้าไม่มี → fallback ใช้ script.characterPrompt
                        const stored = await new Promise(r => chrome.storage.local.get(['actualCharPrompt'], r));
                        const searchPrompt = stored.actualCharPrompt || script.characterPrompt;
                        notify('🔍 กำลังเลือกเรฟ: ตัวละคร...');
                        await searchAndAddReference(searchPrompt);
                        await sleep(1500);
                    }
                }

                if (scene.hasProduct) {
                    notify('🔍 กำลังเพิ่มเรฟสินค้า (ค้นหาคำว่า "product")...');
                    await searchAndAddReference("product");
                    await sleep(1500);
                }

                await clickCreateArrow();
                const imgResult = await waitForNewContent(180);

                if (imgResult === true) {
                    chrome.runtime.sendMessage({ type: 'SCENE_IMAGE_DONE', sceneNumber: sn });
                    notify(`✅ ซีน ${sn}: ภาพเสร็จ!`, 'success');
                    imgSuccess = true;
                    chrome.storage.local.set({ flowRetryCount: 0 }); // รีเซ็ต retry count
                    await sleep(3000);
                    break;
                } else if (imgResult === 'error') {
                    const newRetryCount = flowRetryCount + 1;
                    notify(`⚠️ ซีน ${sn}: Flow Error! ${newRetryCount <= 1 ? 'รีเฟรช' : 'เปิดแท็บใหม่'}...`, 'warning');
                    stepUpdate('retry-image', `⚠️ ซีน ${sn}: Flow Error → retry ${newRetryCount}`);
                    // บันทึก scene + retryCount → background.js จะ reload/new tab → content script จะ resume
                    await chrome.storage.local.set({ currentSceneIndex: i, currentPhase: 'image', flowRetryCount: newRetryCount });
                    chrome.runtime.sendMessage({ type: 'FLOW_ERROR_RETRY', retryCount: newRetryCount, sceneNumber: sn });
                    removeLockScreen();
                    window.__FLOW_BOT_RUNNING__ = false;
                    return;
                }
            }

            if (!imgSuccess) {
                notify(`❌ ซีน ${sn}: สร้างภาพไม่สำเร็จหลัง ${MAX_RETRY + 1} ครั้ง`, 'error');
                stepUpdate('error', `❌ ซีน ${sn}: สร้างภาพไม่สำเร็จ`);
                continue;
            }

            // ==========================================
            // Phase B: สร้างวิดีโอ (Video) + auto-retry
            // ==========================================
            stepUpdate('scene-video', `🎬 ซีน ${sn}/${total}: สร้างวิดีโอ...`);
            await chrome.storage.local.set({ currentPhase: 'video' });
            updateLockStatus(`🎬 ซีน ${sn}/${total}: สร้างวิดีโอ`, `Video mode → พิมพ์ prompt → รอสร้าง...`, sn, total);

            let vidSuccess = false;
            for (let retry = 0; retry <= MAX_RETRY; retry++) {
                if (retry > 0) {
                    notify(`🔄 ซีน ${sn}: ลองสร้างวิดีโอใหม่ (ครั้งที่ ${retry + 1})...`, 'warning');
                    stepUpdate('retry-video', `🔄 ซีน ${sn}: retry วิดีโอ ครั้งที่ ${retry + 1}`);
                } else {
                    notify(`🎬 ซีน ${sn}/${total}: สร้างวิดีโอ...`);
                }

                await setupVideoMode();
                await sleep(1500);

                const dialogue = scene.dialogue || scene.dialogueTH || '';
                const vidPrompt = scene.videoPromptEN || scene.videoPromptTH || '';
                const fullVideoPrompt = dialogue
                    ? `${vidPrompt}\n\nบทพูด: ${dialogue}`
                    : vidPrompt;

                // 1. พิมพ์ Text ก่อน (คำสั่งนี้จะลบของเก่าทิ้งทั้งหมด)
                await clearAndType(fullVideoPrompt);
                await sleep(1500);

                // 2. Add "Image from Phase A" to Prompt! (เป็น reference ตัวที่ 1)
                await clickMoreMenu();
                await sleep(1500);
                await clickMenuItem('add', 'Add to Prompt');
                await sleep(2000);


                await clickCreateArrow();
                const vidResult = await waitForNewContent(300);

                if (vidResult === true) {
                    chrome.runtime.sendMessage({ type: 'SCENE_VIDEO_DONE', sceneNumber: sn });
                    notify(`✅ ซีน ${sn}: วิดีโอเสร็จ!`, 'success');
                    vidSuccess = true;
                    chrome.storage.local.set({ flowRetryCount: 0 }); // รีเซ็ต retry count
                    await sleep(3000);

                    await clickMoreMenu();
                    await sleep(1500);
                    await clickMenuItem('play_movies', 'Add to Scene');
                    await sleep(2000);
                    break;
                } else if (vidResult === 'error') {
                    const newRetryCount = flowRetryCount + 1;
                    notify(`⚠️ ซีน ${sn}: Flow Error! ${newRetryCount <= 1 ? 'รีเฟรช' : 'เปิดแท็บใหม่'}...`, 'warning');
                    stepUpdate('retry-video', `⚠️ ซีน ${sn}: Flow Error → retry ${newRetryCount}`);
                    await chrome.storage.local.set({ currentSceneIndex: i, currentPhase: 'video', flowRetryCount: newRetryCount });
                    chrome.runtime.sendMessage({ type: 'FLOW_ERROR_RETRY', retryCount: newRetryCount, sceneNumber: sn });
                    removeLockScreen();
                    window.__FLOW_BOT_RUNNING__ = false;
                    return;
                }
            }

            if (!vidSuccess) {
                notify(`❌ ซีน ${sn}: สร้างวิดีโอไม่สำเร็จ`, 'error');
                stepUpdate('error', `❌ ซีน ${sn}: วิดีโอ fail`);
            }

            notify(`✅ ซีน ${sn}/${total} เสร็จ!`, 'success');
            stepUpdate('scene-done', `✅ ซีน ${sn}/${total} เสร็จแล้ว`);
            await sleep(3000);

            // กลับ Image mode สำหรับซีนถัดไป
            if (i < script.scenes.length - 1) {
                await setupImageMode();
                await sleep(1000);
            }
        }

        await chrome.storage.local.set({ pipelineStep: 'done' });
        notify('🎉 สร้างวิดีโอครบทุกซีนแล้ว!!', 'success');
        stepUpdate('done', '🎉 เสร็จทั้งหมด!');
        updateLockStatus('🎉 เสร็จแล้ว!', 'สร้างวิดีโอครบทุกซีน — ปลดล็อคอัตโนมัติใน 5 วิ...');
        chrome.runtime.sendMessage({ type: 'ALL_DONE' });
        setTimeout(() => removeLockScreen(), 5000);
        window.__FLOW_BOT_RUNNING__ = false;

    } catch (error) {
        console.error('[Flow] ❌ FATAL:', error.message, error.stack);
        notify('❌ Error: ' + error.message, 'error');
        stepUpdate('error', '❌ ' + error.message);
        updateLockStatus('❌ เกิดข้อผิดพลาด', error.message);
        setTimeout(() => removeLockScreen(), 5000);
        window.__FLOW_BOT_RUNNING__ = false;
    }
}


// ===========================================================
// Message listener — รับคำสั่งจาก background/sidepanel
// ===========================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CREATE_COLLECTIONS') {
        const names = msg.names || [];
        console.log('[Flow] Got CREATE_COLLECTIONS:', names);
        createCollections(names).then(result => {
            sendResponse(result);
        });
        return true;
    }
});


// ===========================================================
// สร้าง Collections อัตโนมัติ
// ใช้ selector จาก Recording 62 actions
// Flow: Add Media → Create Collection (×N) → Rename แต่ละตัว
// ===========================================================

async function createCollections(names) {
    if (!names || names.length === 0) {
        notify('❌ ไม่มีชื่อ collection!', 'error');
        return { success: false, error: 'No names provided' };
    }

    showLockScreen();
    updateLockStatus('📁 สร้าง Collections', `กำลังสร้าง ${names.length} collections...`);
    notify(`📁 เริ่มสร้าง ${names.length} collections...`);

    try {
        // ========================================
        // ขั้นตอน 1: สร้าง Collection ทั้งหมดก่อน
        // ========================================
        for (let i = 0; i < names.length; i++) {
            updateLockStatus(`📁 สร้าง Collection ${i + 1}/${names.length}`, `กำลังกด Add Media → Create Collection...`, i + 1, names.length);

            // กด "Add Media" button
            const addMediaOk = await clickButtonByText('add', 'Add Media', 5);
            if (!addMediaOk) {
                notify(`❌ หาปุ่ม Add Media ไม่เจอ!`, 'error');
                removeLockScreen();
                return { success: false, error: 'Add Media button not found' };
            }
            await sleep(1000);

            // กด "Create Collection" menuitem
            const createOk = await clickMenuItemByText('folder', 'Create Collection', 5);
            if (!createOk) {
                notify(`❌ หา Create Collection ไม่เจอ!`, 'error');
                removeLockScreen();
                return { success: false, error: 'Create Collection menuitem not found' };
            }
            await sleep(2000);
            notify(`✅ สร้าง Collection ${i + 1}/${names.length}`, 'success');
        }

        await sleep(2000);

        // ========================================
        // ขั้นตอน 2: Rename แต่ละ Collection
        // เริ่มจากตัวล่างสุด (สร้างล่าสุด = อยู่ล่าง)
        // ========================================
        notify('✏️ เริ่ม rename collections...');

        // หา collection cards ทั้งหมดที่มีปุ่ม more_vert
        // จากบันทึก: collection cards อยู่ใน grid, more_vert อยู่บน card
        const moreButtons = findAllMoreVertButtons();
        console.log('[Flow] Found more_vert buttons:', moreButtons.length);

        // เรียงตาม position: ขวาล่าง→ซ้ายบน (ตัวสร้างทีหลังอยู่ทางขวา/ล่าง)
        // ต้อง rename จากตัวสร้างแรก→ตัวสร้างสุดท้าย
        // Note: Flow แสดง collection ล่าสุดทางซ้าย (position) ดังนั้น sort by x ascending
        
        // แต่จริงๆ เราสร้าง N ตัวใหม่ → ต้อง rename N ตัวสุดท้าย
        // ไม่สามารถระบุได้แน่ชัดว่าตัวไหนใหม่ → ใช้วิธี rename ทีละตัว by position
        
        for (let i = 0; i < names.length; i++) {
            updateLockStatus(`✏️ Rename ${i + 1}/${names.length}`, `"${names[i]}"...`, i + 1, names.length);

            // หา more_vert ใหม่ทุกรอบ (เพราะ DOM อาจเปลี่ยน)
            const btns = findAllMoreVertButtons();
            if (btns.length === 0) {
                notify(`⚠️ หา more_vert ไม่เจอสำหรับ collection ${i + 1}`, 'warning');
                continue;
            }

            // เลือกตัวที่ i (นับจากซ้าย→ขวา, บน→ล่าง)
            // ถ้ามี collection เก่าอยู่ก่อน → ต้องข้ามตัวเก่า
            // ตอนนี้ใช้วิธี: เลือกตัวสุดท้ายที่ยังไม่ได้ rename (ตัวล่างขวาสุด→ย้อนกลับ)
            const targetIdx = Math.min(i, btns.length - 1);
            btns[targetIdx].click();
            await sleep(800);

            // กด Rename
            const renameOk = await clickMenuItemByText('whiteboard', 'Rename', 5);
            if (!renameOk) {
                notify(`⚠️ Rename ไม่เจอ collection ${i + 1}`, 'warning');
                document.body.click(); // ปิด menu
                await sleep(500);
                continue;
            }
            await sleep(800);

            // หา input field (aria-label="Editable text")
            const inputEl = document.querySelector('input[aria-label="Editable text"]');
            if (inputEl) {
                inputEl.focus();
                await sleep(300);

                // ลบข้อความเดิม
                inputEl.select();
                await sleep(100);

                // พิมพ์ชื่อใหม่
                // ใช้ native input value setter + events
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                ).set;
                nativeInputValueSetter.call(inputEl, names[i]);
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(500);

                // กด Done
                const doneOk = await clickButtonByText('done', 'Done', 5);
                if (doneOk) {
                    notify(`✅ Renamed: "${names[i]}"`, 'success');
                } else {
                    // Fallback: กด Enter
                    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                    await sleep(300);
                    notify(`✅ Renamed (Enter): "${names[i]}"`, 'success');
                }
            } else {
                notify(`⚠️ หา input rename ไม่เจอ`, 'warning');
            }

            await sleep(1500);
        }

        updateLockStatus('🎉 เสร็จ!', `สร้าง ${names.length} collections แล้ว — ปลดล็อคใน 3 วิ...`);
        notify(`🎉 สร้าง ${names.length} collections เสร็จ!`, 'success');
        chrome.runtime.sendMessage({ type: 'COLLECTIONS_DONE', count: names.length, names });
        setTimeout(() => removeLockScreen(), 3000);
        return { success: true, count: names.length };

    } catch (error) {
        console.error('[Flow] Collection error:', error);
        notify('❌ Error: ' + error.message, 'error');
        updateLockStatus('❌ เกิดข้อผิดพลาด', error.message);
        setTimeout(() => removeLockScreen(), 3000);
        return { success: false, error: error.message };
    }
}


/**
 * หา more_vert buttons ทั้งหมดที่ visible — เรียงตาม position (ซ้ายบน → ขวาล่าง)
 */
function findAllMoreVertButtons() {
    const results = [];
    for (const btn of document.querySelectorAll('button')) {
        const t = (btn.textContent || '').trim();
        if (t.includes('more_vert')) {
            const r = btn.getBoundingClientRect();
            if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < window.innerHeight) {
                results.push({ btn, x: r.x, y: r.y });
            }
        }
    }
    // เรียงตาม y ก่อน → x (บนซ้าย → ล่างขวา)
    results.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 30) return a.x - b.x;
        return a.y - b.y;
    });
    return results.map(r => r.btn);
}


/**
 * กดปุ่มที่มี text ตรง (ทั้ง icon + label) — with retry
 */
async function clickButtonByText(iconText, labelText, maxRetry) {
    for (let r = 0; r < maxRetry; r++) {
        for (const btn of document.querySelectorAll('button')) {
            const t = (btn.textContent || '').trim();
            if (t.includes(iconText) && t.includes(labelText)) {
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    btn.click();
                    console.log('[Flow] ✅ Clicked button:', labelText);
                    return true;
                }
            }
        }
        await sleep(1000);
    }
    console.log('[Flow] ⚠️ Button not found:', labelText);
    return false;
}


/**
 * กด menuitem ที่มี text ตรง — with retry
 */
async function clickMenuItemByText(iconText, labelText, maxRetry) {
    for (let r = 0; r < maxRetry; r++) {
        await sleep(500);
        // หาใน role="menuitem" ก่อน
        for (const item of document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')) {
            const t = (item.textContent || '').trim();
            if (t.includes(iconText) && t.includes(labelText)) {
                item.click();
                console.log('[Flow] ✅ MenuItem:', labelText);
                return true;
            }
        }
        // Fallback: หาแค่ label
        for (const item of document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')) {
            const t = (item.textContent || '').trim();
            if (t.includes(labelText)) {
                item.click();
                console.log('[Flow] ✅ MenuItem (label):', labelText);
                return true;
            }
        }
    }
    console.log('[Flow] ⚠️ MenuItem not found:', labelText);
    return false;
}


// ===========================================================
// Step reporting → background → side panel
// ===========================================================

function stepUpdate(step, detail) {
    try {
        chrome.runtime.sendMessage({ type: 'STEP_UPDATE', step, detail });
    } catch (e) { }
}


// ===========================================================
// Error Detection
// ===========================================================

function setupPromptErrorDetector() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                const text = (node.textContent || '').toLowerCase();
                if (text.includes('prompt must be provided') || text.includes('prompt required')) {
                    console.log('[Flow] ⚠️ "Prompt must be provided" detected!');
                    notify('⚠️ Prompt error → รีเฟรช!', 'warning');
                    if (!hasRefreshed) {
                        hasRefreshed = true;
                        setTimeout(() => window.location.reload(), 2000);
                    }
                }
                if (text.includes('something went wrong') || text.includes('try again')) {
                    console.log('[Flow] ⚠️ Error detected:', text.substring(0, 60));
                    notify('⚠️ Flow error detected', 'warning');
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[Flow] ✅ Error detector installed');
}


// ===========================================================
// Mode Setup — robust selectors
// ===========================================================

async function setupImageMode() {
    const chip = findModelChip();
    if (!chip) { console.log('[Flow] ⚠️ Model chip not found'); return; }

    chip.click();
    await sleep(1500);

    // กด Image tab — ลอง text match
    if (!clickTabByText('image')) {
        clickTabByText('Image');
    }
    await sleep(800);

    // กด 9:16
    clickTabByText('crop_9_16');
    await sleep(500);

    // กด x1
    clickTabByText('x1');
    await sleep(500);

    // ปิด dropdown
    document.body.click();
    await sleep(500);

    // เลือก Nano Banana Pro
    await selectModel('Nano Banana');
    await sleep(500);

    console.log('[Flow] ✅ Image mode set');
}

async function setupVideoMode() {
    const chip = findModelChip();
    if (!chip) { console.log('[Flow] ⚠️ Model chip not found'); return; }

    chip.click();
    await sleep(1500);

    // กด Video tab
    if (!clickTabByText('videocam')) {
        clickTabByText('Video');
    }
    await sleep(800);

    // กด Ingredients tab
    if (!clickTabByText('chrome_extension')) {
        clickTabByText('Ingredients');
    }
    await sleep(500);

    // กด 9:16
    clickTabByText('crop_9_16');
    await sleep(500);

    // กด x1
    clickTabByText('x1');
    await sleep(500);

    // ปิด dropdown
    document.body.click();
    await sleep(500);

    // เลือก Veo
    await selectModel('Veo');
    await sleep(500);

    console.log('[Flow] ✅ Video mode set');
}

/**
 * หา model chip button ด้านล่าง — robust version
 */
function findModelChip() {
    const candidates = [];
    const keywords = ['Nano', 'Banana', 'Veo', 'Imagen', 'Video', 'Image',
                       'crop_', 'x1', 'x4', 'flash', 'model'];

    for (const btn of document.querySelectorAll('button')) {
        const t = (btn.textContent || '').trim();
        const r = btn.getBoundingClientRect();

        // ปุ่มด้านล่าง viewport
        if (r.bottom > window.innerHeight - 200 && r.width > 40 && r.height > 20) {
            const matchScore = keywords.reduce((score, kw) =>
                score + (t.toLowerCase().includes(kw.toLowerCase()) ? 1 : 0), 0);

            if (matchScore > 0) {
                candidates.push({ btn, score: matchScore, y: r.y, width: r.width });
            }
        }
    }

    if (candidates.length > 0) {
        // เลือกตัวที่ match มากที่สุด + กว้างที่สุด (chip กว้างกว่าปุ่มเล็ก)
        candidates.sort((a, b) => (b.score * 100 + b.width) - (a.score * 100 + a.width));
        console.log('[Flow] Found model chip:', candidates[0].btn.textContent.substring(0, 40));
        return candidates[0].btn;
    }

    // Fallback: หาปุ่มที่อยู่ล่างที่สุดที่มี text ยาว
    for (const btn of document.querySelectorAll('button')) {
        const r = btn.getBoundingClientRect();
        const t = (btn.textContent || '').trim();
        if (r.bottom > window.innerHeight - 150 && t.length > 5 && t.length < 80) {
            console.log('[Flow] Fallback chip:', t.substring(0, 40));
            return btn;
        }
    }

    return null;
}

/**
 * กด tab — robust: ลอง flow_tab_slider_trigger ก่อน → fallback ปุ่มทั่วไป
 */
function clickTabByText(keyword) {
    const kw = keyword.toLowerCase();

    // วิธี 1: flow_tab_slider_trigger + role=tab
    for (const btn of document.querySelectorAll('.flow_tab_slider_trigger, [role="tab"]')) {
        const t = (btn.textContent || '').trim().toLowerCase();
        if (t.includes(kw)) {
            btn.click();
            console.log('[Flow] Tab:', keyword, '→', t.substring(0, 30));
            return true;
        }
    }
    // วิธี 2: ปุ่มทั่วไปในพื้นที่ settings
    for (const btn of document.querySelectorAll('button')) {
        const t = (btn.textContent || '').trim().toLowerCase();
        if (t.includes(kw) && t.length < 40) {
            btn.click();
            console.log('[Flow] Button:', keyword, '→', t.substring(0, 30));
            return true;
        }
    }
    // วิธี 3: span/div ที่ clickable
    for (const el of document.querySelectorAll('span, div')) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t === kw || (t.includes(kw) && t.length < 20)) {
            el.click();
            console.log('[Flow] Element:', keyword, '→', t.substring(0, 30));
            return true;
        }
    }
    console.log('[Flow] ⚠️ Tab not found:', keyword);
    return false;
}

/**
 * เลือก model จาก dropdown
 */
async function selectModel(keyword) {
    for (const el of document.querySelectorAll('[role="menuitem"], [role="option"], button, span')) {
        const t = (el.textContent || '').trim();
        if (t.includes(keyword) && t.length < 80) {
            el.click();
            console.log('[Flow] ✅ Model selected:', t.substring(0, 40));
            return true;
        }
    }
    return false;
}


// ===========================================================
// Input & Create — with retry + verification
// ===========================================================

async function waitForFlowUI(maxSec) {
    for (let i = 0; i < maxSec; i++) {
        const tb = document.querySelector('div[role="textbox"]');
        if (tb) {
            console.log('[Flow] ✅ UI ready — textbox found');
            notify('✅ เจอช่อง input!', 'success');
            return true;
        }
        if (i % 5 === 0) console.log('[Flow] Waiting for UI...', i, 's');
        await sleep(1000);
    }
    notify('❌ หา input ไม่เจอ!', 'error');
    return false;
}

/**
 * ล้าง + พิมพ์ข้อความ — with verification & retry
 */
async function clearAndType(text) {
    for (let attempt = 0; attempt < 3; attempt++) {
        let textbox = null;

        for (let i = 0; i < 10; i++) {
            const all = document.querySelectorAll('div[role="textbox"]');
            if (all.length > 0) {
                textbox = all[all.length - 1];
                break;
            }
            await sleep(1000);
        }

        if (!textbox) {
            console.error('[Flow] ❌ Cannot find textbox!');
            notify('❌ หาช่อง input ไม่เจอ!', 'error');
            return false;
        }

        // คลิกที่ <p> ข้างใน
        const p = textbox.querySelector('p');
        if (p) p.click();
        else textbox.click();
        await sleep(500);

        textbox.focus();
        await sleep(300);

        // ลบข้อความเดิม
        document.execCommand('selectAll', false, null);
        await sleep(100);
        document.execCommand('delete', false, null);
        await sleep(300);

        // === ใส่ข้อความใหม่ ===
        let typed = false;

        // วิธี 1: Clipboard paste
        try {
            await navigator.clipboard.writeText(text);
            await sleep(200);
            textbox.focus();
            const clipData = new DataTransfer();
            clipData.setData('text/plain', text);
            textbox.dispatchEvent(new ClipboardEvent('paste', {
                bubbles: true, cancelable: true, clipboardData: clipData
            }));
            await sleep(500);
            if (verifyTextbox(textbox, text)) {
                typed = true;
                console.log('[Flow] ✅ Paste success');
            }
        } catch (e) {
            console.log('[Flow] Paste failed:', e.message);
        }

        // วิธี 2: execCommand insertText
        if (!typed) {
            try {
                textbox.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, text);
                await sleep(300);
                if (verifyTextbox(textbox, text)) {
                    typed = true;
                    console.log('[Flow] ✅ execCommand success');
                }
            } catch (e) { }
        }

        // วิธี 3: InputEvent
        if (!typed) {
            try {
                textbox.focus();
                textbox.dispatchEvent(new InputEvent('beforeinput', {
                    inputType: 'insertText', data: text, bubbles: true, cancelable: true
                }));
                textbox.dispatchEvent(new InputEvent('input', {
                    inputType: 'insertText', data: text, bubbles: true
                }));
                await sleep(300);
                if (verifyTextbox(textbox, text)) {
                    typed = true;
                    console.log('[Flow] ✅ InputEvent success');
                }
            } catch (e) { }
        }

        // วิธี 4: innerHTML fallback
        if (!typed) {
            console.log('[Flow] ⚠️ All failed → innerHTML');
            textbox.innerHTML = `<p><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true">${text}</span></span></span></p>`;
            textbox.dispatchEvent(new Event('input', { bubbles: true }));
            typed = true;
        }

        if (typed) {
            console.log('[Flow] ✅ Typed:', text.substring(0, 60) + '...');
            notify('✏️ พิมพ์ prompt แล้ว');
            return true;
        }

        console.log(`[Flow] ⚠️ Type attempt ${attempt + 1} failed, retrying...`);
        await sleep(1000);
    }
    return false;
}

/**
 * ตรวจว่า textbox มีข้อความหรือไม่
 */
function verifyTextbox(textbox, expectedText) {
    const content = (textbox.textContent || '').trim();
    return content.length > 0 && !content.includes('What do you want');
}


// ===========================================================
// Buttons — robust with retry
// ===========================================================

async function clickCreateArrow() {
    for (let attempt = 0; attempt < 8; attempt++) {
        // หา arrow_forwardCreate
        for (const btn of document.querySelectorAll('button')) {
            const t = (btn.textContent || '').trim();
            const r = btn.getBoundingClientRect();
            if (t.includes('arrow_forward') && t.includes('Create') &&
                r.bottom > window.innerHeight - 200 && !btn.disabled) {
                btn.click();
                console.log('[Flow] ✅ Clicked arrow_forwardCreate');
                return;
            }
        }
        // Fallback: ปุ่ม Create ทั่วไป
        for (const btn of document.querySelectorAll('button')) {
            const t = (btn.textContent || '').trim().toLowerCase();
            const r = btn.getBoundingClientRect();
            if (t.includes('create') && r.bottom > window.innerHeight - 200 && !btn.disabled) {
                btn.click();
                console.log('[Flow] ✅ Clicked Create (fallback)');
                return;
            }
        }
        await sleep(1000);
    }
    notify('❌ ไม่เจอปุ่ม Create!', 'error');
}

// ===========================================================
// Add Reference Image by Prompt Search
// ===========================================================

async function searchAndAddReference(searchPrompt) {
    if (!searchPrompt) return false;
    
    // 1. กดปุ่ม `+` / Add Media แถวๆ ช่อง prompt
    let addClicked = false;
    for (const btn of document.querySelectorAll('button')) {
        const text = btn.textContent || '';
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const rect = btn.getBoundingClientRect();
        
        // หากมี icon add_2 ตรงๆ
        const icon = btn.querySelector('i');
        const hasAdd2Icon = icon && icon.textContent.trim() === 'add_2';
        
        // หาปุ่ม add ที่อยู่ครึ่งล่างจอ (แถว prompt)
        // แก้ไข: ไม่ใช้ aria.includes('reference') เพราะมันจะไปคลิก chip เก่า (Remove reference image) ทำให้รูปเก่าหาย!
        if ((hasAdd2Icon || aria === 'add media' || aria === 'add image') 
            && rect.bottom > window.innerHeight / 2 && rect.width < 100) {
            btn.click();
            console.log('[Flow] ✅ Clicked Add Media button');
            addClicked = true;
            break;
        }
    }
    
    if (!addClicked) {
        console.log('[Flow] ⚠️ Cannot find Add Media button, trying fallback...');
        // Fallback: ลองกดปุ่ม svg +
        const svgs = document.querySelectorAll('svg');
        for (const svg of svgs) {
            if (svg.innerHTML.includes('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z')) {
                const btn = svg.closest('button') || svg.parentElement;
                if (btn) { btn.click(); addClicked = true; break; }
            }
        }
    }
    await sleep(2000); // รอ modal เปิด

    // 2. หาช่อง "Search for Assets"
    let searchInput = null;
    for (const input of document.querySelectorAll('input')) {
        const ph = (input.placeholder || '').toLowerCase();
        if (ph.includes('search for assets') || ph.includes('search')) {
            searchInput = input;
            break;
        }
    }

    if (!searchInput) {
        console.log('[Flow] ❌ Cannot find Search for Assets input');
        notify('❌ หาช่อง Search for Assets ไม่เจอ', 'error');
        // ถ้าไม่เจอ อาจจะเป็น UI เก่า ค่อยลองปิด modal
        document.body.click(); 
        return false;
    }

    // 3. พิมพ์ทีละตัวเหมือนคนพิมพ์จริง (ไม่ใช่ยัดค่าทั้ง string)
    searchInput.focus();
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);

    const searchText = searchPrompt.substring(0, 50); // ใช้ 50 ตัวแรก
    for (const char of searchText) {
        searchInput.value += char;
        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
        await sleep(30); // จำลองความเร็วพิมพ์
    }
    // กด Enter เผื่อต้องกด
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    console.log('[Flow] 🔍 Searched for:', searchText);
    
    // 4. รอผลลัพธ์รูปภาพโหลด
    await sleep(3000); 

    // 5. เลือกภาพแรกที่เจอ (ที่เป็นผลค้นหา)
    // ปกติภาพใน assets modal จะเป็น <img> หรือ div ที่มี background-image
    let imgClicked = false;
    
    // หากรอบที่ใส่รูปแล้วมี interaction (มักเป็น button หรือ div ที่มี role=button/presentation)
    const modalContainers = document.querySelectorAll('[role="dialog"], .modal, [class*="overlay"]');
    const searchArea = modalContainers.length > 0 ? modalContainers[modalContainers.length - 1] : document.body;
    
    const possibleImages = searchArea.querySelectorAll('img, [style*="background-image"]');
    for (const img of possibleImages) {
        const rect = img.getBoundingClientRect();
        // เอาภาพที่ใหญ่พอจะเห็นชัด ไม่ใช่ icon
        if (rect.width > 50 && rect.height > 50) {
            // คลิกตัวกรอบนอก (มักเป็น div.sc-... ที่ครอบ img อยู่ตามที่บอทอัดมา)
            const clickableParent = img.parentElement || img;
            clickableParent.click();
            imgClicked = true;
            console.log('[Flow] ✅ Clicked Reference Image Object');
            break;
        }
    }
    
    if (!imgClicked) {
         notify('⚠️ ไม่เจอภาพจากคำค้นหานี้', 'warning');
         document.body.click(); // ปิด modal ทิ้ง
         return false;
    }

    // รอภาพลงไปแปะใน Prompt
    await sleep(2000);
    return true;
}


// ===========================================================
// More Menu (⋮) — fixed position logic
// ===========================================================

async function clickMoreMenu() {
    // หา more_vert ทั้งหมดที่ visible
    const moreBtns = [];
    for (const btn of document.querySelectorAll('button')) {
        const t = (btn.textContent || '').trim();
        if ((t.includes('more_vert') && t.includes('More')) || t === 'more_vert') {
            const r = btn.getBoundingClientRect();
            if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < window.innerHeight) {
                moreBtns.push({ btn, y: r.y, x: r.x });
            }
        }
    }

    if (moreBtns.length > 0) {
        // เลือกปุ่ม more_vert ตัวแรกที่อยู่ในพื้นที่ content
        // Content ที่เพิ่งสร้างจะอยู่ด้านบนของ scroll area
        // ถ้ามีหลายตัว → ตัวแรก (บนสุด) = content ล่าสุด
        moreBtns.sort((a, b) => a.y - b.y);
        moreBtns[0].btn.click();
        console.log('[Flow] ✅ Clicked more_vert at y=', moreBtns[0].y);
        return;
    }

    // Fallback: หาปุ่ม more_vert ทั้งหมด
    for (const btn of document.querySelectorAll('button')) {
        const t = (btn.textContent || '').trim();
        if (t.includes('more_vert')) {
            btn.click();
            console.log('[Flow] ✅ Clicked more_vert (fallback)');
            return;
        }
    }
    console.log('[Flow] ⚠️ more_vert not found');
}

/**
 * กด menuitem — wait for menu + retry
 */
async function clickMenuItem(iconText, labelText) {
    for (let attempt = 0; attempt < 5; attempt++) {
        // รอ menu เปิด
        await sleep(500);

        // หาใน role="menu" ก่อน
        const menu = document.querySelector('[role="menu"]');
        const searchIn = menu ? menu.querySelectorAll('button[role="menuitem"], [role="menuitem"]')
                              : document.querySelectorAll('button[role="menuitem"], [role="menuitem"]');

        for (const item of searchIn) {
            const t = (item.textContent || '').trim();
            if (t.includes(iconText) && t.includes(labelText)) {
                item.click();
                console.log('[Flow] ✅ MenuItem:', labelText);
                return true;
            }
        }
        // Fallback: หาแค่ label
        for (const item of searchIn) {
            const t = (item.textContent || '').trim();
            if (t.includes(labelText)) {
                item.click();
                console.log('[Flow] ✅ MenuItem (label only):', labelText);
                return true;
            }
        }
        await sleep(800);
    }
    console.log('[Flow] ⚠️ MenuItem not found:', labelText);
    return false;
}


// ===========================================================
// Wait for content generation — improved
// ===========================================================

async function waitForNewContent(maxSec) {
    const initial = countMedia();
    let stableCount = 0, lastCount = initial;

    for (let i = 0; i < maxSec; i++) {
        await sleep(1000);

        // === ตรวจจับ error dialog "Failed" / "Oops" ===
        if (detectFlowError()) {
            console.log('[Flow] ❌ Flow Error detected! (Failed / Oops)');
            notify('❌ Flow Error! จะรีเฟรชอัตโนมัติ...', 'error');
            return 'error';
        }

        // ถ้ามี loading spinner → ยังไม่นับ stable
        if (isGenerating()) {
            stableCount = 0;
            lastCount = countMedia();
            if (i > 0 && i % 30 === 0) notify(`⏳ กำลังสร้าง... (${i}s/${maxSec}s)`);
            continue;
        }

        const current = countMedia();
        if (current > initial) {
            if (current === lastCount) {
                stableCount++;
                if (stableCount >= 3) return true;
            } else {
                stableCount = 0;
            }
            lastCount = current;
        }
        if (i > 0 && i % 20 === 0) notify(`⏳ รอ... (${i}s/${maxSec}s)`);
    }
    notify('⏰ หมดเวลารอ', 'warning');
    return false;
}

function countMedia() {
    return document.querySelectorAll('img, video, canvas').length;
}

/**
 * ตรวจว่ากำลัง generate อยู่หรือไม่
 */
function isGenerating() {
    // ตรวจ spinner / loading elements
    const loadingEls = document.querySelectorAll(
        '[class*="loading"], [class*="spinner"], [class*="generating"], [class*="progress"]'
    );
    for (const el of loadingEls) {
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0) {
            return true;
        }
    }
    // ตรวจ animation จาก circular progress
    const circles = document.querySelectorAll('circle[stroke-dasharray]');
    for (const c of circles) {
        if (c.getBoundingClientRect().width > 0) return true;
    }
    return false;
}

/**
 * ตรวจจับ error dialog ของ Google Flow
 * เช่น "Failed" / "Oops, something went wrong!" / "Audio generation failed"
 */
function detectFlowError() {
    const allText = document.querySelectorAll('span, div, h1, h2, h3, p');
    for (const el of allText) {
        const t = (el.textContent || '').trim();
        const r = el.getBoundingClientRect();
        // ต้องเป็น element ที่มองเห็นได้ + ข้อความสั้น (ไม่ใช่ body ทั้งหมด)
        if (r.width > 0 && r.height > 0 && t.length < 150) {
            if ((t === 'Failed' 
                || t.includes('Oops, something went wrong') 
                || t.includes('Something went wrong')
                || t.includes('generation failed')
                || t.includes('Generation failed'))
                && !el.closest('[id*="bot"]')) {
                console.log('[Flow] 🚨 Error element found:', t);
                return true;
            }
        }
    }
    return false;
}


// ===========================================================
// UI Toast (Shadow DOM)
// ===========================================================

function initNotify() {
    if (document.getElementById('__bot_host__')) {
        const host = document.getElementById('__bot_host__');
        if (host.shadowRoot) notifyRoot = host.shadowRoot.getElementById('container');
        return;
    }

    const host = document.createElement('div');
    host.id = '__bot_host__';
    host.style.cssText = 'position:fixed; top:0; right:0; z-index:2147483647; pointer-events:none;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <style>
            :host { all: initial; }
            #container {
                position: fixed; top: 16px; right: 16px;
                display: flex; flex-direction: column; gap: 8px;
                font-family: 'Segoe UI', Arial, sans-serif;
                z-index: 2147483647;
            }
            .toast {
                padding: 12px 18px; border-radius: 12px;
                color: #fff; font-size: 14px; font-weight: 500;
                box-shadow: 0 4px 24px rgba(0,0,0,0.4);
                max-width: 360px; pointer-events: auto;
                animation: slideIn 0.3s ease-out;
                border-left: 4px solid;
                backdrop-filter: blur(12px);
            }
            .toast.info   { background: rgba(59,130,246,0.92);  border-color: #60a5fa; }
            .toast.success{ background: rgba(34,197,94,0.92);   border-color: #4ade80; }
            .toast.error  { background: rgba(239,68,68,0.92);   border-color: #f87171; }
            .toast.warning{ background: rgba(245,158,11,0.92);  border-color: #fbbf24; }
            @keyframes slideIn { from { transform:translateX(120px); opacity:0; } to { transform:translateX(0); opacity:1; } }
        </style>
        <div id="container"></div>
    `;
    notifyRoot = shadow.getElementById('container');
}

function notify(msg, type = 'info') {
    console.log('[Flow]', msg);
    if (!notifyRoot) initNotify();
    if (!notifyRoot) return;

    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = '🤖 ' + msg;
    notifyRoot.appendChild(el);

    while (notifyRoot.children.length > 5) notifyRoot.firstChild.remove();

    setTimeout(() => {
        el.style.transition = 'opacity 0.5s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 500);
    }, 8000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


// ===========================================================
// Lock Screen — แสดงเล็กๆ มุมล่างซ้าย ไม่บังการทำงาน ไม่เบลอ
// ===========================================================

function showLockScreen() {
    if (document.getElementById('__bot_lockscreen__')) return;

    // === Invisible full-page blocker (ไม่มี blur, ไม่มีสี, โปร่งใสทั้งหมด) ===
    const blocker = document.createElement('div');
    blocker.id = '__bot_lockscreen__';
    blocker.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:2147483645; cursor:not-allowed;';
    document.body.appendChild(blocker);

    // Block ALL user interactions on the page
    blocker.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); }, true);
    blocker.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); }, true);
    blocker.addEventListener('mouseup', e => { e.stopPropagation(); e.preventDefault(); }, true);
    blocker.addEventListener('keydown', e => { e.stopPropagation(); e.preventDefault(); }, true);
    blocker.addEventListener('keyup', e => { e.stopPropagation(); e.preventDefault(); }, true);
    blocker.addEventListener('keypress', e => { e.stopPropagation(); e.preventDefault(); }, true);
    blocker.addEventListener('contextmenu', e => { e.stopPropagation(); e.preventDefault(); }, true);
    blocker.addEventListener('dblclick', e => { e.stopPropagation(); e.preventDefault(); }, true);
    blocker.addEventListener('wheel', e => { e.stopPropagation(); e.preventDefault(); }, { passive: false, capture: true });

    // === Small floating status card (มุมล่างซ้าย) ===
    const card = document.createElement('div');
    card.id = '__bot_lock_card__';
    card.style.cssText = 'position:fixed; bottom:16px; left:16px; z-index:2147483647; pointer-events:auto;';
    document.body.appendChild(card);

    const shadow = card.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <style>
            :host { all: initial; }
            * { margin: 0; padding: 0; box-sizing: border-box; }

            .card {
                background: rgba(10, 10, 20, 0.92);
                border: 1px solid rgba(96, 165, 250, 0.25);
                border-radius: 14px;
                padding: 12px 16px;
                width: 280px;
                font-family: 'Segoe UI', -apple-system, sans-serif;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(96,165,250,0.08);
                animation: slideUp 0.4s ease;
            }

            @keyframes slideUp {
                from { transform: translateY(30px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }

            @keyframes slideDown {
                from { transform: translateY(0); opacity: 1; }
                to { transform: translateY(30px); opacity: 0; }
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }

            @keyframes shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }

            .header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
            }

            .spinner {
                width: 16px; height: 16px;
                border: 2px solid rgba(96,165,250,0.2);
                border-top-color: #60a5fa;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                flex-shrink: 0;
            }

            .title {
                font-size: 12px;
                font-weight: 700;
                color: #e2e8f0;
            }

            .lock-badge {
                margin-left: auto;
                font-size: 9px;
                padding: 2px 6px;
                border-radius: 4px;
                background: rgba(239,68,68,0.15);
                color: #f87171;
                font-weight: 600;
            }

            .status {
                font-size: 11px;
                font-weight: 600;
                color: #60a5fa;
                margin-bottom: 4px;
                animation: pulse 2s infinite;
            }

            .detail {
                font-size: 10px;
                color: #64748b;
                margin-bottom: 8px;
                line-height: 1.3;
            }

            .progress-wrap {
                width: 100%;
                height: 4px;
                background: rgba(255,255,255,0.06);
                border-radius: 2px;
                overflow: hidden;
                margin-bottom: 6px;
            }

            .progress-bar {
                height: 100%;
                border-radius: 2px;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6, #c084fc, #3b82f6);
                background-size: 200% 100%;
                animation: shimmer 2s linear infinite;
                transition: width 0.5s ease;
                width: 0%;
            }

            .scene-info {
                font-size: 9px;
                color: #475569;
                margin-bottom: 6px;
            }

            .footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .warn {
                font-size: 9px;
                color: #fbbf24;
                opacity: 0.7;
            }

            .unlock-btn {
                padding: 4px 10px;
                background: rgba(239,68,68,0.1);
                border: 1px solid rgba(239,68,68,0.2);
                border-radius: 6px;
                color: #f87171;
                font-size: 10px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                opacity: 0.5;
            }

            .unlock-btn:hover {
                background: rgba(239,68,68,0.2);
                opacity: 1;
            }
        </style>
        <div class="card">
            <div class="header">
                <div class="spinner"></div>
                <span class="title">\ud83e\udd16 \u0e1a\u0e2d\u0e17\u0e01\u0e33\u0e25\u0e31\u0e07\u0e17\u0e33\u0e07\u0e32\u0e19</span>
                <span class="lock-badge">\ud83d\udd12 LOCKED</span>
            </div>
            <div class="status" id="lockStatus">\u23f3 \u0e01\u0e33\u0e25\u0e31\u0e07\u0e40\u0e23\u0e34\u0e48\u0e21...</div>
            <div class="detail" id="lockDetail">\u0e01\u0e23\u0e38\u0e13\u0e32\u0e23\u0e2d\u0e2a\u0e31\u0e01\u0e04\u0e23\u0e39\u0e48</div>
            <div class="progress-wrap">
                <div class="progress-bar" id="lockProgress"></div>
            </div>
            <div class="scene-info" id="lockSceneInfo"></div>
            <div class="footer">
                <span class="warn">\u26a0\ufe0f \u0e2b\u0e49\u0e32\u0e21\u0e01\u0e14\u0e1a\u0e19\u0e2b\u0e19\u0e49\u0e32\u0e19\u0e35\u0e49</span>
                <button class="unlock-btn" id="unlockBtn">\ud83d\udd13 \u0e1b\u0e25\u0e14\u0e25\u0e47\u0e2d\u0e04</button>
            </div>
        </div>
    `;

    lockScreenRoot = shadow;

    // Force-unlock button
    shadow.getElementById('unlockBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('\u26a0\ufe0f \u0e1b\u0e25\u0e14\u0e25\u0e47\u0e2d\u0e04\u0e2b\u0e19\u0e49\u0e32\u0e08\u0e2d?\n\n\u0e1a\u0e2d\u0e17\u0e08\u0e30\u0e2b\u0e22\u0e38\u0e14\u0e17\u0e33\u0e07\u0e32\u0e19 \u2014 \u0e2d\u0e32\u0e08\u0e15\u0e49\u0e2d\u0e07\u0e40\u0e23\u0e34\u0e48\u0e21\u0e43\u0e2b\u0e21\u0e48')) {
            removeLockScreen();
            window.__FLOW_BOT_RUNNING__ = false;
            notify('\ud83d\udd13 \u0e1b\u0e25\u0e14\u0e25\u0e47\u0e2d\u0e04\u0e41\u0e25\u0e49\u0e27 \u2014 \u0e1a\u0e2d\u0e17\u0e2b\u0e22\u0e38\u0e14\u0e17\u0e33\u0e07\u0e32\u0e19', 'warning');
        }
    });

    console.log('[Flow] \ud83d\udd12 Lock screen shown (compact)');
}

function updateLockStatus(status, detail, currentScene, totalScenes) {
    if (!lockScreenRoot) return;

    const statusEl = lockScreenRoot.getElementById('lockStatus');
    const detailEl = lockScreenRoot.getElementById('lockDetail');
    const sceneEl = lockScreenRoot.getElementById('lockSceneInfo');
    const progressEl = lockScreenRoot.getElementById('lockProgress');

    if (statusEl) statusEl.textContent = status;
    if (detailEl) detailEl.textContent = detail;

    if (currentScene && totalScenes) {
        if (sceneEl) sceneEl.textContent = `\u0e0b\u0e35\u0e19\u0e17\u0e35\u0e48 ${currentScene} \u0e08\u0e32\u0e01 ${totalScenes} \u0e0b\u0e35\u0e19`;
        const pct = Math.round((currentScene / totalScenes) * 100);
        if (progressEl) progressEl.style.width = pct + '%';
    }
}

function removeLockScreen() {
    // ลบ blocker (invisible full-page)
    const blocker = document.getElementById('__bot_lockscreen__');
    if (blocker) blocker.remove();

    // ลบ card (with slide-down animation)
    const card = document.getElementById('__bot_lock_card__');
    if (card && card.shadowRoot) {
        const cardEl = card.shadowRoot.querySelector('.card');
        if (cardEl) {
            cardEl.style.animation = 'slideDown 0.4s ease forwards';
            setTimeout(() => card.remove(), 400);
        } else {
            card.remove();
        }
    } else if (card) {
        card.remove();
    }

    lockScreenRoot = null;
    console.log('[Flow] \ud83d\udd13 Lock screen removed');
}

