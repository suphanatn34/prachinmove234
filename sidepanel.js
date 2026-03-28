// ============================================
// Side Panel Script — Pipeline View v5.0
// Per-scene auto-run buttons + progress bar + controls
// ============================================

// === DEBUG: แสดงสถานะ JS ที่หน้า sidepanel ===
window.onerror = function(msg, url, line, col, err) {
    const d = document.getElementById('_dbg');
    if (d) d.innerHTML += `<div style="color:#f87171">❌ ERROR line ${line}: ${msg}</div>`;
    console.error('[SidePanel] ERROR:', msg, 'line:', line);
};
document.addEventListener('DOMContentLoaded', () => {
    // ใส่ debug bar ด้านบน
    const bar = document.createElement('div');
    bar.id = '_dbg';
    bar.style.cssText = 'background:#1a1a2e;border-bottom:2px solid #4ade80;padding:4px 8px;font-size:10px;color:#4ade80;max-height:80px;overflow-y:auto;z-index:9999';
    bar.innerHTML = '✅ JS loaded';
    document.body.prepend(bar);
});
console.log('[SidePanel] === Script START ===');

const DB_URL = "https://affiliate-bot-ee9a2-default-rtdb.firebaseio.com";

// ===== Startup: ดึงสถานะปัจจุบันจาก Firebase =====
(async function loadCurrentStatus() {
    try {
        const resp = await fetch(`${DB_URL}/status.json`);
        const s = await resp.json();
        if (s && s.message) {
            const statusEl = document.getElementById('currentStatus');
            const iconEl = document.getElementById('statusIcon');
            if (statusEl) statusEl.textContent = s.message;
            if (iconEl) {
                if (s.state === 'working') iconEl.textContent = '🔄';
                else if (s.state === 'done') iconEl.textContent = '✅';
                else if (s.state === 'error') iconEl.textContent = '❌';
                else iconEl.textContent = '💤';
            }
        }
    } catch (e) { }
})();

// ===== รับข้อความจาก background.js =====
chrome.runtime.onMessage.addListener((msg) => {
    // สถานะ bot
    if (msg.type === 'BOT_STATUS') {
        const statusEl = document.getElementById('currentStatus');
        const iconEl = document.getElementById('statusIcon');
        if (statusEl) statusEl.textContent = msg.message || '';
        if (iconEl) {
            if (msg.state === 'working') iconEl.textContent = '🔄';
            else if (msg.state === 'done') iconEl.textContent = '✅';
            else if (msg.state === 'error') iconEl.textContent = '❌';
            else iconEl.textContent = '💤';
        }
    }
    // Log จาก bot
    if (msg.type === 'BOT_LOG') {
        const logList = document.getElementById('logList');
        if (logList) {
            const empty = logList.querySelector('.log-empty');
            if (empty) empty.remove();
            const div = document.createElement('div');
            div.className = 'log-entry';
            div.innerHTML = `<span class="log-time">${msg.time || ''}</span> ${msg.message || ''}`;
            logList.appendChild(div);
            logList.scrollTop = logList.scrollHeight;
        }
    }
    // Pipeline log
    if (msg.type === 'PIPELINE_LOG') {
        const logList = document.getElementById('logList');
        if (logList) {
            const empty = logList.querySelector('.log-empty');
            if (empty) empty.remove();
            const div = document.createElement('div');
            div.className = 'log-entry';
            const time = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            div.innerHTML = `<span class="log-time">${time}</span> ${msg.message || ''}`;
            logList.appendChild(div);
            logList.scrollTop = logList.scrollHeight;
        }
    }
    // Pipeline phase
    if (msg.type === 'PIPELINE_PHASE') {
        const statusEl = document.getElementById('currentStatus');
        const iconEl = document.getElementById('statusIcon');
        const phaseNames = { character: '🎭 ตัวละคร', product: '📦 สินค้า', images: '🖼️ ภาพซีน', videos: '🎬 วิดีโอ' };
        if (statusEl) statusEl.textContent = `${phaseNames[msg.phase] || msg.phase}: ${msg.status === 'active' ? 'กำลังทำ' : 'เสร็จ'}`;
        if (iconEl) iconEl.textContent = msg.status === 'active' ? '🔄' : '✅';
    }
    // Pipeline เสร็จ
    if (msg.type === 'FULL_PIPELINE_DONE') {
        const statusEl = document.getElementById('currentStatus');
        const iconEl = document.getElementById('statusIcon');
        if (msg.success) {
            if (statusEl) statusEl.textContent = '🎉 Pipeline เสร็จ!';
            if (iconEl) iconEl.textContent = '✅';
        } else {
            if (statusEl) statusEl.textContent = '❌ ' + (msg.error || 'Pipeline ล้มเหลว');
            if (iconEl) iconEl.textContent = '❌';
        }
    }
});

// ===== Expandable sections (คลิกเปิด/ปิด) =====
document.addEventListener('click', (e) => {
    const expander = e.target.closest('[data-expand]');
    if (!expander) return;
    const targetId = expander.dataset.expand;
    const body = document.getElementById(targetId);
    if (body) {
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
    }
});

// ===== DOM =====
const apiKeyInput = document.getElementById('apiKey');
const gemUrlInput = document.getElementById('gemUrl');
const saveBtn = document.getElementById('saveBtn');
const saveMsg = document.getElementById('saveMsg');
const toggleKey = document.getElementById('toggleKey');
const statusDot = document.getElementById('statusDot');
const statusIcon = document.getElementById('statusIcon');
const currentStatus = document.getElementById('currentStatus');
const logList = document.getElementById('logList');
const clearLogs = document.getElementById('clearLogs');
const stopBtn = document.getElementById('stopBtn');
const scriptEmpty = document.getElementById('scriptEmpty');
const scriptContent = document.getElementById('scriptContent');
const scriptTitle = document.getElementById('scriptTitle');
const sceneBadge = document.getElementById('sceneBadge');
const sceneList = document.getElementById('sceneList');
const copyScriptBtn = document.getElementById('copyScriptBtn');
const retryFlowBtn = document.getElementById('retryFlowBtn');
const runAllBtn = document.getElementById('runAllBtn');
const stopAllBtn = document.getElementById('stopAllBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

// Pipeline elements
const charPromptText = document.getElementById('charPromptText');
const charStatus = document.getElementById('charStatus');
const stepCharacter = document.getElementById('stepCharacter');
const prodStatus = document.getElementById('prodStatus');
const stepProduct = document.getElementById('stepProduct');
const prodImageWrap = document.getElementById('prodImageWrap');
const prodAnalysis = document.getElementById('prodAnalysis');
const analysisText = document.getElementById('analysisText');
const scenesStatus = document.getElementById('scenesStatus');
const stepScenes = document.getElementById('stepScenes');
const copyCharBtn = document.getElementById('copyCharBtn');
const collectionNames = document.getElementById('collectionNames');
const createCollectionBtn = document.getElementById('createCollectionBtn');
const toggleCollectionBtn = document.getElementById('toggleCollectionBtn');
const collectionBody = document.getElementById('collectionBody');

// ===== Tabs =====
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// ===== Step Expand/Collapse =====
document.querySelectorAll('.step-header').forEach(header => {
    header.addEventListener('click', () => {
        const bodyId = header.dataset.expand;
        const body = document.getElementById(bodyId);
        if (body) {
            body.style.display = body.style.display === 'none' ? 'block' : 'none';
        }
    });
});

// ===== Memory card expand/collapse =====
document.querySelectorAll('.mem-card-header').forEach(header => {
    header.addEventListener('click', () => {
        const body = header.nextElementSibling;
        if (body && body.classList.contains('mem-card-body')) {
            body.style.display = body.style.display === 'none' ? 'block' : 'none';
        }
    });
});

// ===== Collection section toggle =====
if(toggleCollectionBtn) toggleCollectionBtn.addEventListener('click', () => {
    if ((collectionBody ? collectionBody.style : {}).display === 'none') {
        if (collectionBody) (collectionBody ? collectionBody.style : {}).display = 'block';
        if (toggleCollectionBtn) toggleCollectionBtn.textContent = '▲';
    } else {
        if (collectionBody) (collectionBody ? collectionBody.style : {}).display = 'none';
        if (toggleCollectionBtn) toggleCollectionBtn.textContent = '▼';
    }
});

// ===== Create Collections =====
createCollectionBtn?.addEventListener('click', () => {
    if (!collectionNames) return;
    const text = (collectionNames ? collectionNames.value : "").trim();
    if (!text) {
        alert('กรุณาพิมพ์ชื่อ collection อย่างน้อย 1 ชื่อ');
        return;
    }
    const names = text.split('\n').map(n => n.trim()).filter(n => n.length > 0);
    if (names.length === 0) {
        alert('กรุณาพิมพ์ชื่อ collection อย่างน้อย 1 ชื่อ');
        return;
    }

    chrome.runtime.sendMessage({ type: 'CREATE_COLLECTIONS', names });
    if (createCollectionBtn) createCollectionBtn.innerHTML = '<span class="ctrl-icon">⚡</span><span>กำลังสร้าง...</span>';
    setTimeout(() => {
        if (createCollectionBtn) createCollectionBtn.innerHTML = '<span class="ctrl-icon">📁</span><span>สร้าง Collection</span>';
    }, 3000);
});

// ===== Rename Collection Test =====
document.getElementById('renameCollectionBtn')?.addEventListener('click', () => {
    const index = parseInt(document.getElementById('renameIndex')?.value || '1') - 1;
    const name = (document.getElementById('renameName')?.value || '').trim();
    if (!name) {
        alert('กรุณาพิมพ์ชื่อใหม่');
        return;
    }
    chrome.runtime.sendMessage({ type: 'RENAME_COLLECTION', index, name });
    const btn = document.getElementById('renameCollectionBtn');
    btn.innerHTML = '<span class="ctrl-icon">⚡</span><span>กำลังเปลี่ยนชื่อ...</span>';
    setTimeout(() => {
        btn.innerHTML = '<span class="ctrl-icon">✏️</span><span>เปลี่ยนชื่อ</span>';
    }, 3000);
});

// ===== Test Tab Buttons =====
const testOutput = document.getElementById('testOutput');
function appendTestOutput(text) {
    if (testOutput) {
        testOutput.textContent += '\n' + text;
        testOutput.scrollTop = testOutput.scrollHeight;
    }
}

function sendTestAction(action, args = {}) {
    chrome.runtime.sendMessage({ type: 'TEST_ACTION', action, ...args }, (response) => {
        if (response?.result) {
            appendTestOutput(response.result);
        } else if (response?.error) {
            appendTestOutput('❌ ' + response.error);
        }
    });
}

// Debug buttons
document.getElementById('testDumpBtns')?.addEventListener('click', () => {
    appendTestOutput('--- Dump buttons y<60 ---');
    sendTestAction('DUMP_BUTTONS');
});
document.getElementById('testDumpInputs')?.addEventListener('click', () => {
    appendTestOutput('--- Dump inputs ---');
    sendTestAction('DUMP_INPUTS');
});
document.getElementById('testClearOutput')?.addEventListener('click', () => {
    if (testOutput) testOutput.textContent = 'พร้อมทดสอบ';
});

// ===== วางรูปสินค้าจาก Clipboard =====
document.getElementById('wfPasteProduct')?.addEventListener('click', async () => {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
                const blob = await item.getType(imageType);
                const reader = new FileReader();
                reader.onload = (e) => {
                    document.getElementById('wfProduct').value = e.target.result.substring(0, 50) + '... (base64)';
                    document.getElementById('wfProductImg').src = e.target.result;
                    document.getElementById('wfProductPreview').style.display = 'block';
                    // เก็บ base64 ไว้ใน data attribute
                    document.getElementById('wfProduct').dataset.base64 = e.target.result;
                };
                reader.readAsDataURL(blob);
                appendTestOutput('✅ วางรูปสินค้าสำเร็จ');
                return;
            }
        }
        // ถ้าไม่มีรูป ลองอ่านเป็น text (URL)
        const text = await navigator.clipboard.readText();
        if (text) {
            document.getElementById('wfProduct').value = text;
            if (text.startsWith('http')) {
                document.getElementById('wfProductImg').src = text;
                document.getElementById('wfProductPreview').style.display = 'block';
            }
        }
    } catch (err) {
        appendTestOutput('❌ วางรูปไม่ได้: ' + err.message);
    }
});

// ===== Gemini คิดสคริปต์อัตโนมัติ =====
document.getElementById('wfGenStory')?.addEventListener('click', async () => {
    const topic = document.getElementById('wfTopic')?.value?.trim();
    if (!topic) {
        appendTestOutput('❌ กรุณาใส่หัวข้อสินค้าก่อน');
        return;
    }
    const btn = document.getElementById('wfGenStory');
    btn.textContent = '⏳ คิด...';
    btn.disabled = true;
    appendTestOutput('🤖 กำลังคิดสคริปต์ "' + topic + '"...');
    
    try {
        const DEFAULT_KEY = 'AIzaSyD_cjVmNshdwHM_jGvmRUGIXp5EaOpHb8g';
        const storageData = await new Promise(r => chrome.storage.local.get(['geminiApiKey', 'systemPrompt'], r));
        const apiKey = storageData.geminiApiKey || DEFAULT_KEY;
        const sysPrompt = storageData.systemPrompt || `คุณเป็นคนเขียนสคริปต์วิดีโอโฆษณาสินค้า`;
        
        const prompt = `${sysPrompt}

ข้อมูลสินค้าคือ: "${topic}"

สร้าง prompt สำหรับ AI สร้างภาพ/วิดีโอ ตอบเป็น JSON เท่านั้น ห้ามมี markdown ห้ามมี backtick หรือข้อความอื่นใดๆ นอกเหนือจาก JSON:
{"title":"หัวข้อเรื่อง", "character":"English prompt for main character portrait photo, beautiful Thai woman, detailed, 9:16, high quality","product":"คำอธิบายสินค้าสั้นๆ ภาษาไทย","scene1":"English video prompt scene1: introduction, cinematic 9:16","scene2":"English video prompt scene2: problem, cinematic 9:16","scene3":"English video prompt scene3: using product, cinematic 9:16","scene4":"English video prompt scene4: result, cinematic 9:16"}`;
        
        const models = ['gemini-2.5-flash'];
        let text = '';
        let lastError = '';
        
        for (const model of models) {
            try {
                appendTestOutput('📡 ลอง model: ' + model + '...');
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 20000);
                
                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
                    })
                });
                clearTimeout(timeoutId);
                
                const data = await resp.json();
                
                if (data.error) {
                    lastError = data.error.message || JSON.stringify(data.error);
                    appendTestOutput('⚠️ ' + model + ': ' + lastError);
                    continue;
                }
                
                text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (text) break;
                
                lastError = 'ตอบว่าง — ' + JSON.stringify(data).substring(0, 200);
                appendTestOutput('⚠️ ' + model + ' ตอบว่าง');
            } catch (fetchErr) {
                lastError = fetchErr.name === 'AbortError' ? 'Timeout (20s)' : fetchErr.message;
                appendTestOutput('⚠️ ' + model + ': ' + lastError);
            }
        }
        
        if (!text) throw new Error('Gemini ไม่ตอบ: ' + lastError);
        
        // parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const story = JSON.parse(jsonMatch[0]);
            if (story.character) document.getElementById('wfCharacter').value = story.character;
            if (story.product) document.getElementById('wfProduct').value = story.product;
            if (story.scene1) document.getElementById('wfScene1').value = story.scene1;
            if (story.scene2) document.getElementById('wfScene2').value = story.scene2;
            if (story.scene3) document.getElementById('wfScene3').value = story.scene3;
            if (story.scene4) document.getElementById('wfScene4').value = story.scene4;
            if (story.character) document.getElementById('wfImagePrompt').value = story.character;
            if (story.scene1) document.getElementById('wfVideoPrompt').value = story.scene1;
            appendTestOutput('✅ คิดสคริปต์สำเร็จ!\n' + JSON.stringify(story, null, 2));
        } else {
            appendTestOutput('⚠️ Gemini ตอบ (ไม่ใช่ JSON):\n' + text.substring(0, 500));
        }
    } catch (err) {
        appendTestOutput('❌ ' + err.message);
    } finally {
        btn.textContent = '🤖 คิดสคริปต์';
        btn.disabled = false;
    }
});

// ===== Drag & Drop Sortable =====
const stepList = document.getElementById('customStepList');
let dragItem = null;

// ===== Individual Step ▶ Button =====
stepList?.addEventListener('click', (e) => {
    const btn = e.target.closest('.step-run-btn');
    if (!btn) return;
    e.stopPropagation();
    const step = btn.closest('.custom-step');
    const action = step?.dataset?.action;
    if (!action) return;
    const name = document.getElementById('wfCollName')?.value || 'ตัวละคร';
    appendTestOutput('--- ▶ ' + action + ' ---');
    sendTestAction(action, { name });
});

stepList?.addEventListener('dragstart', (e) => {
    dragItem = e.target.closest('.custom-step');
    if (dragItem) dragItem.classList.add('dragging');
});
stepList?.addEventListener('dragend', () => {
    if (dragItem) dragItem.classList.remove('dragging');
    stepList.querySelectorAll('.custom-step').forEach(s => s.classList.remove('drag-over'));
    dragItem = null;
});
stepList?.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.custom-step');
    if (target && target !== dragItem) {
        stepList.querySelectorAll('.custom-step').forEach(s => s.classList.remove('drag-over'));
        target.classList.add('drag-over');
    }
});
stepList?.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.custom-step');
    if (target && dragItem && target !== dragItem) {
        const items = [...stepList.children];
        const fromIdx = items.indexOf(dragItem);
        const toIdx = items.indexOf(target);
        if (fromIdx < toIdx) {
            target.after(dragItem);
        } else {
            target.before(dragItem);
        }
    }
    stepList.querySelectorAll('.custom-step').forEach(s => s.classList.remove('drag-over'));
});

// ===== Run Custom Workflow =====
document.getElementById('runCustomWorkflow')?.addEventListener('click', () => {
    const steps = [];
    stepList?.querySelectorAll('.custom-step').forEach(el => {
        const checked = el.querySelector('.step-check')?.checked;
        if (checked) {
            steps.push(el.dataset.action);
        }
    });
    if (steps.length === 0) {
        appendTestOutput('❌ ไม่มี step ที่เลือก');
        return;
    }
    const name = document.getElementById('wfCollName')?.value || 'ตัวละคร';
    const delay = parseInt(document.getElementById('wfDelay')?.value || '2') * 1000;

    // Reset all step visuals
    stepList?.querySelectorAll('.custom-step').forEach(el => {
        el.classList.remove('running-step', 'done-step', 'error-step');
    });
    
    appendTestOutput('\n=== ▶️ Custom Workflow เริ่ม (' + steps.length + ' steps) ===');
    const btn = document.getElementById('runCustomWorkflow');
    btn.classList.add('running');
    btn.textContent = '⚡ กำลังรัน...';

    const character = document.getElementById('wfCharacter')?.value || '';
    const imagePrompt = document.getElementById('wfImagePrompt')?.value || character;
    const videoPrompt = document.getElementById('wfVideoPrompt')?.value || document.getElementById('wfScene1')?.value || '';
    const contentData = {
        topic: document.getElementById('wfTopic')?.value || '',
        character,
        product: document.getElementById('wfProduct')?.dataset?.base64 || document.getElementById('wfProduct')?.value || '',
        scene1: document.getElementById('wfScene1')?.value || '',
        scene2: document.getElementById('wfScene2')?.value || '',
        scene3: document.getElementById('wfScene3')?.value || '',
        scene4: document.getElementById('wfScene4')?.value || ''
    };
    chrome.runtime.sendMessage({ type: 'TEST_CUSTOM_WORKFLOW', steps, name, delay, imagePrompt, videoPrompt, contentData });
});

// Listen for custom step updates
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CUSTOM_STEP_UPDATE') {
        const stepEl = stepList?.querySelector(`[data-action="${msg.action}"]`);
        if (stepEl) {
            stepEl.classList.remove('running-step', 'done-step', 'error-step');
            stepEl.classList.add(msg.status + '-step');
        }
        if (msg.message) appendTestOutput(msg.message);
    }
    if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
        const btn = document.getElementById('runCustomWorkflow');
        btn.classList.remove('running');
        btn.textContent = '▶️ รันตามลำดับ';
        appendTestOutput('=== ' + (msg.success ? '✅ Custom Workflow สำเร็จ!' : '❌ Custom Workflow ล้มเหลว: ' + (msg.error || 'unknown')) + ' ===');
    }
    // === Batch Workflow Updates ===
    if (msg.type === 'BATCH_STEP_UPDATE') {
        const prog = document.getElementById('batchProgress');
        if (prog) prog.textContent = msg.message;
        appendTestOutput(msg.message);
    }
    if (msg.type === 'BATCH_WORKFLOW_DONE') {
        const btn = document.getElementById('runBatchWorkflow');
        if (btn) { btn.classList.remove('running'); btn.textContent = '🚀 สร้างทั้งหมด'; }
        const prog = document.getElementById('batchProgress');
        if (prog) prog.textContent = msg.success ? '✅ เสร็จทั้งหมด!' : '❌ ' + (msg.error || 'ล้มเหลว');
        appendTestOutput('=== ' + (msg.success ? '✅ Batch เสร็จ ' + msg.count + ' collections!' : '❌ Batch ล้มเหลว: ' + (msg.error || '')) + ' ===');
    }
    // === Create Image Done ===
    if (msg.type === 'CREATE_IMAGE_DONE') {
        appendTestOutput(msg.success ? '✅ สร้างภาพสำเร็จ: ' + (msg.steps?.join(' → ') || '') : '❌ สร้างภาพล้มเหลว: ' + (msg.error || ''));
    }
});

// ===== Batch Workflow Button =====
document.getElementById('runBatchWorkflow')?.addEventListener('click', () => {
    const textarea = document.getElementById('batchNames');
    const names = textarea.value.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (names.length === 0) { appendTestOutput('❌ ใส่ชื่อ collection อย่างน้อย 1 ชื่อ'); return; }
    
    const delay = parseInt(document.getElementById('testDelay')?.value || '3000');
    const btn = document.getElementById('runBatchWorkflow');
    btn.classList.add('running');
    btn.textContent = '⏳ กำลังสร้าง...';
    
    appendTestOutput('=== 🚀 Batch เริ่ม (' + names.length + ' collections) ===');
    chrome.runtime.sendMessage({ type: 'BATCH_WORKFLOW', names, delay });
});

// ===== Create Image Button =====
document.getElementById('btnCreateImage')?.addEventListener('click', () => {
    const prompt = document.getElementById('imagePrompt')?.value?.trim();
    if (!prompt) { appendTestOutput('❌ ใส่ prompt ก่อน'); return; }
    const name = document.getElementById('imageName')?.value?.trim() || '';
    appendTestOutput('🎨 กำลังสร้างภาพ...' + (name ? ' ชื่อ: "' + name + '"' : ''));
    chrome.runtime.sendMessage({ type: 'CREATE_IMAGE', prompt, name, settings: { type: 'IMAGE', ratio: '9:16', count: '1' } });
});

// ===== Workflow Runner =====
let workflowRunning = false;

function setStepStatus(step, status) {
    const el = document.querySelector(`.wf-step[data-step="${step}"]`);
    if (!el) return;
    el.className = 'wf-step ' + status;
    const icon = el.querySelector('.wf-icon');
    if (icon) {
        if (status === 'active') icon.textContent = '⚡';
        else if (status === 'done') icon.textContent = '✅';
        else if (status === 'error') icon.textContent = '❌';
        else icon.textContent = '⏳';
    }
}

function resetAllSteps() {
    for (let i = 1; i <= 8; i++) setStepStatus(i, '');
}

document.getElementById('testRunAll')?.addEventListener('click', () => {
    if (workflowRunning) return;
    workflowRunning = true;
    const name = document.getElementById('wfCollName')?.value || 'ตัวละคร';
    const delay = parseInt(document.getElementById('wfDelay')?.value || '2') * 1000;
    
    resetAllSteps();
    appendTestOutput('\n=== 🚀 Workflow เริ่ม ===');
    
    const runBtn = document.getElementById('testRunAll');
    const stopBtn = document.getElementById('testStopWorkflow');
    runBtn.classList.add('running');
    runBtn.textContent = '⚡ กำลังรัน...';
    stopBtn.style.display = 'block';
    
    chrome.runtime.sendMessage({ type: 'TEST_WORKFLOW', name, delay });
});

document.getElementById('testStopWorkflow')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TEST_WORKFLOW_STOP' });
    workflowRunning = false;
    const runBtn = document.getElementById('testRunAll');
    const stopBtn = document.getElementById('testStopWorkflow');
    runBtn.classList.remove('running');
    runBtn.textContent = '🚀 รันทั้งหมด (Workflow)';
    stopBtn.style.display = 'none';
    appendTestOutput('⏹️ Workflow หยุดแล้ว');
});

// ===== Character: Image Paste =====
document.getElementById('pasteCharImg')?.addEventListener('click', async () => {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
                const blob = await item.getType(imageType);
                const url = URL.createObjectURL(blob);
                const img = document.getElementById('charImagePreview');
                const empty = document.getElementById('charImageEmpty');
                if (img) { img.src = url; img.style.display = 'block'; }
                if (empty) empty.style.display = 'none';
                return;
            }
        }
        alert('ไม่พบรูปภาพใน clipboard — ลอง copy รูปจาก Flow ก่อน');
    } catch(e) {
        alert('ไม่สามารถอ่าน clipboard: ' + e.message);
    }
});

// paste ลงในช่อง charImageWrap ด้วย Ctrl+V
document.getElementById('charImageWrap')?.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            const url = URL.createObjectURL(blob);
            const img = document.getElementById('charImagePreview');
            const empty = document.getElementById('charImageEmpty');
            if (img) { img.src = url; img.style.display = 'block'; }
            if (empty) empty.style.display = 'none';
        }
    }
});
// focus ให้ paste ได้
document.getElementById('charImageWrap')?.setAttribute('tabindex', '0');

// ===== Character: Debug log helper =====
function charDebugAppend(text) {
    const log = document.getElementById('charDebugLog');
    if (log) {
        log.textContent += (log.textContent ? '\n' : '') + text;
        log.scrollTop = log.scrollHeight;
    }
}

// ===== Character: กดปุ่ม ▶ ที่ละขั้น =====
document.getElementById('charStepsList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cs-run');
    if (!btn) return;
    const stepEl = btn.closest('.char-step');
    if (!stepEl) return;
    
    const action = stepEl.dataset.action;
    const icon = stepEl.querySelector('.cs-icon');
    if (icon) icon.textContent = '🔄';
    btn.disabled = true;
    charDebugAppend(`▶ ${action} ...`);
    
    const charPrompt = document.getElementById('charPromptText')?.textContent || '';
    
    // ส่งทำ step เดียว
    chrome.runtime.sendMessage({ 
        type: 'TEST_CUSTOM_WORKFLOW', 
        steps: [action], 
        name: 'ตัวละคร', 
        delay: 2000,
        imagePrompt: charPrompt,
        videoPrompt: ''
    });
    
    const listener = (msg) => {
        if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
            if (icon) icon.textContent = msg.success ? '✅' : '❌';
            btn.disabled = false;
            charDebugAppend(msg.success ? `✅ ${action} สำเร็จ` : `❌ ${action} ล้มเหลว: ${msg.error || 'unknown'}`);
            // บันทึก URL ถ้าเป็น WAIT_COLLECTION_URL หรือ CLICK_DONE
            if (msg.success && (action === 'WAIT_COLLECTION_URL' || action === 'CLICK_DONE')) {
                chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                    if (tabs[0]?.url) {
                        document.getElementById('charCollUrl').value = tabs[0].url;
                        charDebugAppend('🔗 URL: ' + tabs[0].url);
                    }
                });
            }
            chrome.runtime.onMessage.removeListener(listener);
        }
    };
    chrome.runtime.onMessage.addListener(listener);
});

// ===== Character: Auto ทั้งหมด =====
document.getElementById('autoCharacter')?.addEventListener('click', () => {
    const charPrompt = document.getElementById('charPromptText')?.textContent || '';
    const btn = document.getElementById('autoCharacter');
    btn.textContent = '⏳ กำลังทำงาน...';
    btn.disabled = true;
    charDebugAppend('⚡ Auto ทั้งหมด เริ่ม...');
    
    // รีเซ็ต icons
    document.querySelectorAll('#charStepsList .cs-icon').forEach(i => i.textContent = '⏳');
    
    const allSteps = [
        'CLICK_ADD_MEDIA', 'CLICK_CREATE_COLLECTION', 'CLICK_NEW_COLLECTION',
        'WAIT_COLLECTION_URL', 'CLICK_TITLE', 'SELECT_ALL_DELETE',
        'TYPE_NAME', 'CLICK_DONE', 'CREATE_IMAGE', 'GO_BACK'
    ];
    
    chrome.runtime.sendMessage({ 
        type: 'TEST_CUSTOM_WORKFLOW', 
        steps: allSteps, 
        name: 'ตัวละคร', 
        delay: 2000,
        imagePrompt: charPrompt,
        videoPrompt: ''
    });
    
    let stepIdx = 0;
    const listener = (msg) => {
        if (msg.type === 'CUSTOM_STEP_UPDATE') {
            const stepEls = document.querySelectorAll('#charStepsList .char-step');
            if (stepIdx < stepEls.length) {
                const icon = stepEls[stepIdx].querySelector('.cs-icon');
                if (msg.status === 'running' && icon) icon.textContent = '🔄';
                if (msg.status === 'done' && icon) { icon.textContent = '✅'; stepIdx++; }
                if (msg.status === 'error' && icon) { icon.textContent = '❌'; }
            }
            charDebugAppend(`${msg.status === 'done' ? '✅' : msg.status === 'error' ? '❌' : '🔄'} ${msg.action || ''} ${msg.message || ''}`);
            // บันทึก URL
            if (msg.status === 'done' && msg.action === 'CLICK_DONE') {
                chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                    if (tabs[0]?.url) document.getElementById('charCollUrl').value = tabs[0].url;
                });
            }
        }
        if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
            btn.textContent = msg.success ? '✅ เสร็จ!' : '❌ ล้มเหลว';
            btn.disabled = false;
            charDebugAppend(msg.success ? '🎉 Auto ทั้งหมดสำเร็จ!' : '❌ ล้มเหลว: ' + (msg.error || ''));
            setTimeout(() => { btn.textContent = '⚡ Auto ทั้งหมด (ตัวละคร)'; }, 3000);
            chrome.runtime.onMessage.removeListener(listener);
        }
    };
    chrome.runtime.onMessage.addListener(listener);
});

// ===== Product: Debug log helper =====
function prodDebugAppend(text) {
    const log = document.getElementById('prodDebugLog');
    if (log) {
        log.textContent += (log.textContent ? '\n' : '') + text;
        log.scrollTop = log.scrollHeight;
    }
}

// ===== Product: Image Paste =====
document.getElementById('pasteProdImg')?.addEventListener('click', async () => {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
                const blob = await item.getType(imageType);
                const url = URL.createObjectURL(blob);
                const img = document.getElementById('prodImagePreview');
                const empty = document.getElementById('prodImageEmpty');
                if (img) { img.src = url; img.style.display = 'block'; }
                if (empty) empty.style.display = 'none';
                return;
            }
        }
        alert('ไม่พบรูปภาพใน clipboard');
    } catch(e) { alert('ไม่สามารถอ่าน clipboard: ' + e.message); }
});
document.getElementById('prodPasteWrap')?.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            const url = URL.createObjectURL(blob);
            const img = document.getElementById('prodImagePreview');
            const empty = document.getElementById('prodImageEmpty');
            if (img) { img.src = url; img.style.display = 'block'; }
            if (empty) empty.style.display = 'none';
        }
    }
});

// ===== Product: copy รูปสินค้าเข้า clipboard อัตโนมัติ =====
async function copyProdImageToClipboard() {
    // ลองจาก prodImagePreview ก่อน
    const img = document.getElementById('prodImagePreview');
    if (img && img.src && img.style.display !== 'none') {
        const resp = await fetch(img.src);
        const blob = await resp.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        return;
    }
    // ลองจาก pendingImage ใน storage
    const data = await new Promise(r => chrome.storage.local.get(['pendingImage'], r));
    if (data.pendingImage) {
        const resp = await fetch(data.pendingImage);
        const blob = await resp.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        return;
    }
    throw new Error('ไม่มีรูปสินค้า — กรุณาวางรูปก่อน');
}

// ===== Product: กดปุ่ม ▶ ที่ละขั้น =====
document.getElementById('prodStepsList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ps-run');
    if (!btn) return;
    const stepEl = btn.closest('.prod-step');
    if (!stepEl) return;
    
    const action = stepEl.dataset.action;
    const icon = stepEl.querySelector('.ps-icon');
    if (icon) icon.textContent = '🔄';
    btn.disabled = true;
    prodDebugAppend(`▶ ${action} ...`);
    
    // ถ้าเป็น PASTE_IMAGE → copy รูปเข้า clipboard ก่อน แล้วค่อย paste
    if (action === 'PASTE_IMAGE') {
        try {
            await copyProdImageToClipboard();
            prodDebugAppend('📋 copy รูปเข้า clipboard แล้ว');
        } catch(e) {
            if (icon) icon.textContent = '❌';
            btn.disabled = false;
            prodDebugAppend(`❌ copy รูปล้มเหลว: ${e.message}`);
            return;
        }
    }
    
    chrome.runtime.sendMessage({ 
        type: 'TEST_CUSTOM_WORKFLOW', 
        steps: [action], name: 'สินค้า', delay: 2000, imagePrompt: '', videoPrompt: ''
    });
    
    const listener = (msg) => {
        if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
            if (icon) icon.textContent = msg.success ? '✅' : '❌';
            btn.disabled = false;
            prodDebugAppend(msg.success ? `✅ ${action} สำเร็จ` : `❌ ${action} ล้มเหลว: ${msg.error || 'unknown'}`);
            if (msg.success && (action === 'WAIT_COLLECTION_URL' || action === 'CLICK_DONE')) {
                chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                    if (tabs[0]?.url) {
                        document.getElementById('prodCollUrl').value = tabs[0].url;
                        prodDebugAppend('🔗 URL: ' + tabs[0].url);
                    }
                });
            }
            chrome.runtime.onMessage.removeListener(listener);
        }
    };
    chrome.runtime.onMessage.addListener(listener);
});

// ===== Product: Auto ทั้งหมด =====
document.getElementById('autoProduct')?.addEventListener('click', async () => {
    const btn = document.getElementById('autoProduct');
    btn.textContent = '⏳ กำลังทำงาน...';
    btn.disabled = true;
    prodDebugAppend('⚡ Auto ทั้งหมด เริ่ม...');
    
    // copy รูปสินค้าเข้า clipboard ก่อน (เตรียมไว้สำหรับ PASTE_IMAGE)
    try {
        await copyProdImageToClipboard();
        prodDebugAppend('📋 เตรียม copy รูปเข้า clipboard แล้ว');
    } catch(e) {
        prodDebugAppend('⚠️ ไม่มีรูปสินค้า — จะข้าม PASTE_IMAGE');
    }
    
    document.querySelectorAll('#prodStepsList .ps-icon').forEach(i => i.textContent = '⏳');
    
    const allSteps = [
        'CLICK_ADD_MEDIA','CLICK_CREATE_COLLECTION','CLICK_NEW_COLLECTION',
        'WAIT_COLLECTION_URL','CLICK_TITLE','SELECT_ALL_DELETE',
        'TYPE_NAME','CLICK_DONE','PASTE_IMAGE','GO_BACK'
    ];
    
    chrome.runtime.sendMessage({ 
        type: 'TEST_CUSTOM_WORKFLOW', steps: allSteps, 
        name: 'สินค้า', delay: 2000, imagePrompt: '', videoPrompt: ''
    });
    
    let stepIdx = 0;
    const listener = (msg) => {
        if (msg.type === 'CUSTOM_STEP_UPDATE') {
            const stepEls = document.querySelectorAll('#prodStepsList .prod-step');
            if (stepIdx < stepEls.length) {
                const icon = stepEls[stepIdx].querySelector('.ps-icon');
                if (msg.status === 'running' && icon) icon.textContent = '🔄';
                if (msg.status === 'done' && icon) { icon.textContent = '✅'; stepIdx++; }
                if (msg.status === 'error' && icon) { icon.textContent = '❌'; }
            }
            prodDebugAppend(`${msg.status === 'done' ? '✅' : msg.status === 'error' ? '❌' : '🔄'} ${msg.action || ''} ${msg.message || ''}`);
            if (msg.status === 'done' && msg.action === 'CLICK_DONE') {
                chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                    if (tabs[0]?.url) document.getElementById('prodCollUrl').value = tabs[0].url;
                });
            }
        }
        if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
            btn.textContent = msg.success ? '✅ เสร็จ!' : '❌ ล้มเหลว';
            btn.disabled = false;
            prodDebugAppend(msg.success ? '🎉 Auto สินค้าสำเร็จ!' : '❌ ล้มเหลว: ' + (msg.error || ''));
            setTimeout(() => { btn.textContent = '⚡ Auto ทั้งหมด (สินค้า)'; }, 3000);
            chrome.runtime.onMessage.removeListener(listener);
        }
    };
    chrome.runtime.onMessage.addListener(listener);
});
const plStepList = document.getElementById('pipelineStepList');

// กดปุ่ม ▶ ที่ step แต่ละตัว
plStepList?.addEventListener('click', (e) => {
    const btn = e.target.closest('.pl-run');
    if (!btn) return;
    const stepEl = btn.closest('.pl-step');
    if (!stepEl) return;
    
    const action = stepEl.dataset.plstep;
    const name = stepEl.dataset.name || stepEl.dataset.coll || '';
    
    // อัพเดท icon เป็นกำลังรัน
    const icon = stepEl.querySelector('.pl-icon');
    if (icon) icon.textContent = '🔄';
    
    // ส่ง action เดียวไป background
    let steps = [];
    if (action === 'OPEN_FLOW') steps = ['OPEN_FLOW'];
    else if (action === 'NEW_PROJECT') steps = ['NEW_PROJECT'];
    else if (action === 'CREATE_COLL') steps = ['CREATE_AND_ENTER_COLL', 'CLICK_TITLE', 'SELECT_ALL_DELETE', 'TYPE_NAME', 'CLICK_DONE', 'GO_BACK'];
    else if (action === 'GEN_IMAGE') steps = ['ENTER_COLLECTION', 'CREATE_SCENE_IMAGE', 'GO_BACK'];
    else if (action === 'GEN_VIDEO') steps = ['ENTER_COLLECTION', 'CREATE_VIDEO', 'GO_BACK'];
    
    chrome.runtime.sendMessage({ 
        type: 'TEST_CUSTOM_WORKFLOW', 
        steps, 
        name, 
        delay: 2000,
        imagePrompt: '',
        videoPrompt: ''
    });
    
    // ฟังผลลัพธ์
    const listener = (msg) => {
        if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
            if (icon) icon.textContent = msg.success ? '✅' : '❌';
            chrome.runtime.onMessage.removeListener(listener);
        }
    };
    chrome.runtime.onMessage.addListener(listener);
});

// Auto ทั้งหมด
document.getElementById('btnAutoFromScript')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'AUTO_PIPELINE_FROM_SCRIPT' });
});

// หยุด
document.getElementById('btnStopPipeline')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_PIPELINE' });
});

// รีเซ็ต
document.getElementById('btnClearPipeline')?.addEventListener('click', () => {
    plStepList?.querySelectorAll('.pl-icon').forEach(i => i.textContent = '⏳');
});

// ฟัง pipeline step updates จาก background
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PIPELINE_STEP_UPDATE') {
        const statusEl = document.getElementById('pipelineStatus');
        const stepEl = document.getElementById('pipelineCurrentStep');
        const logEl = document.getElementById('pipelineLog');
        if (statusEl) statusEl.style.display = 'block';
        if (stepEl) stepEl.textContent = msg.step || '';
        if (logEl && msg.message) {
            logEl.innerHTML += msg.message + '<br>';
            logEl.scrollTop = logEl.scrollHeight;
        }
        // อัพเดท progress
        if (msg.progress) {
            const progEl = document.getElementById('pipelineProgress');
            if (progEl) progEl.textContent = msg.progress;
        }
    }
    if (msg.type === 'PIPELINE_DONE') {
        const stopBtn = document.getElementById('btnStopPipeline');
        const progEl = document.getElementById('pipelineProgress');
        if (stopBtn) stopBtn.style.display = 'none';
        if (progEl) progEl.textContent = msg.success ? '✅ เสร็จสิ้น' : '❌ ล้มเหลว';
    }
});

// Listen for step updates from background
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'WORKFLOW_STEP_UPDATE') {
        setStepStatus(msg.step, msg.status);
        if (msg.message) appendTestOutput(msg.message);
    }
    if (msg.type === 'WORKFLOW_DONE') {
        workflowRunning = false;
        const runBtn = document.getElementById('testRunAll');
        const stopBtn = document.getElementById('testStopWorkflow');
        runBtn.classList.remove('running');
        runBtn.textContent = '🚀 รันทั้งหมด (Workflow)';
        stopBtn.style.display = 'none';
        appendTestOutput('=== ' + (msg.success ? '✅ Workflow สำเร็จ!' : '❌ Workflow ล้มเหลว') + ' ===');
    }
});

// ===== Load saved settings =====
chrome.storage.local.get(['geminiApiKey', 'gemUrl', 'machineId'], (data) => {
    if (data.geminiApiKey) apiKeyInput.value = data.geminiApiKey;
    if (data.gemUrl) gemUrlInput.value = data.gemUrl;
    if (data.machineId) document.getElementById('machineId').value = data.machineId;
});

// ===== Toggle API key visibility =====
toggleKey.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    toggleKey.textContent = apiKeyInput.type === 'password' ? '👁️' : '🙈';
});

// ===== Save settings =====
saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const url = gemUrlInput.value.trim();

    const mid = (document.getElementById('machineId')?.value || '').trim();
    chrome.storage.local.set({
        geminiApiKey: key,
        gemUrl: url || 'https://gemini.google.com/gem/823f453339b7',
        machineId: mid
    }, () => {
        saveMsg.textContent = '✅ บันทึกแล้ว!';
        saveMsg.style.color = '#4ade80';
        setTimeout(() => { saveMsg.textContent = ''; }, 2000);
    });
});

// ===== Load status from Firebase =====
async function loadStatus() {
    try {
        const resp = await fetch(`${DB_URL}/status.json`);
        const data = await resp.json();
        if (data) {
            currentStatus.textContent = data.message || 'ไม่มีข้อมูล';
            statusDot.className = 'status-dot ' + (data.state || 'idle');

            const state = data.state || 'idle';
            if (state === 'working') statusIcon.textContent = '⚡';
            else if (state === 'done') statusIcon.textContent = '✅';
            else if (state === 'error') statusIcon.textContent = '❌';
            else statusIcon.textContent = '💤';
        }
    } catch (e) {
        currentStatus.textContent = 'ไม่สามารถโหลดสถานะ';
        statusIcon.textContent = '⚠️';
    }
}

// ===== Load & Display Pipeline =====
function loadScript() {
    chrome.storage.local.get([
        'currentScript', 'currentSceneIndex', 'currentPhase',
        'pendingImage', 'imageAnalysis', 'pipelineStep', 'currentStep', 'stepDetail'
    ], (data) => {
        if (!data.currentScript || !data.currentScript.scenes) {
            if (scriptEmpty) scriptEmpty.style.display = 'flex';
            if (scriptContent) scriptContent.style.display = 'none';
            if (progressContainer) progressContainer.style.display = 'none';
            return;
        }

        const script = data.currentScript;
        const currentIdx = -1; // รีเซ็ต — ไม่มี scene active จนกว่าจะเริ่ม pipeline
        const phase = 'idle'; // รีเซ็ต — ไม่มี phase active
        const pipeStep = data.pipelineStep || 'idle';

        if (scriptEmpty) scriptEmpty.style.display = 'none';
        if (scriptContent) Object.assign(scriptContent.style, { display: 'flex', flexDirection: 'column', flex: '1' });

        if (scriptTitle) scriptTitle.textContent = `🎬 ${script.title || 'ไม่มีชื่อ'}`;
        if (sceneBadge) sceneBadge.textContent = `${script.scenes.length} ซีน`;

        if (collectionNames && !(collectionNames ? collectionNames.value : "").trim()) {
            const autoNames = ['ตัวละคร', 'สินค้า'];
            for (let i = 1; i <= script.scenes.length; i++) {
                autoNames.push(`ซีน ${i}`);
            }
            if (collectionNames) collectionNames.value = autoNames.join('\n');
        }

        // === Progress Bar ===
        updateProgressBar(script, currentIdx, phase, pipeStep);

        // === Step 1: Character(s) ===
        const chars = script.characters || [];
        let charDisplayText = '';
        if (chars.length > 0) {
            charDisplayText = chars.map((c, i) => {
                if (c.hasImage) return `ตัวละคร ${i+1}: 📷 ใช้รูปที่อัพ`;
                return `ตัวละคร ${i+1}: ${c.promptEN || script.characterPrompt || '-'}`;
            }).join('\n');
        } else {
            charDisplayText = script.characterPrompt || '-';
        }
        if (charPromptText) charPromptText.textContent = charDisplayText;
        
        const btnRunChar = document.getElementById('btnRunOnlyCharacter');
        if (btnRunChar) btnRunChar.style.display = charDisplayText !== '-' ? 'block' : 'none';

        if (pipeStep === 'character') {
            if (stepCharacter) stepCharacter.className = 'pipeline-step active';
            if (charStatus) charStatus.textContent = '⚡ กำลังสร้าง';
            if (charStatus) charStatus.className = 'step-status active';
        } else if (['product', 'scenes', 'done'].includes(pipeStep)) {
            if (stepCharacter) stepCharacter.className = 'pipeline-step done';
            if (charStatus) charStatus.textContent = '✅ เสร็จ';
            if (charStatus) charStatus.className = 'step-status done';
        } else {
            if (stepCharacter) stepCharacter.className = 'pipeline-step';
            if (charStatus) charStatus.textContent = '⏳ รอ';
            if (charStatus) charStatus.className = 'step-status';
        }

        // === Step 2: Product Image ===
        const prodImg = document.getElementById('prodImagePreview');
        const prodEmpty = document.getElementById('prodImageEmpty');
        
        const btnRunProd = document.getElementById('btnRunOnlyProduct');
        if (btnRunProd) btnRunProd.style.display = data.pendingImage ? 'block' : 'none';

        if (data.pendingImage && prodImg) {
            prodImg.src = data.pendingImage;
            prodImg.style.display = 'block';
            if (prodEmpty) prodEmpty.style.display = 'none';
        }

        if (data.imageAnalysis && prodAnalysis) {
            if (prodAnalysis) prodAnalysis.style.display = 'block';
            if (analysisText) analysisText.textContent = data.imageAnalysis;
        } else if (prodAnalysis) {
            if (prodAnalysis) prodAnalysis.style.display = 'none';
        }

        if (pipeStep === 'product') {
            if (stepProduct) stepProduct.className = 'pipeline-step active';
            if (prodStatus) prodStatus.textContent = '⚡ กำลังเตรียม';
            if (prodStatus) prodStatus.className = 'step-status active';
        } else if (['scenes', 'done'].includes(pipeStep)) {
            if (stepProduct) stepProduct.className = 'pipeline-step done';
            if (prodStatus) prodStatus.textContent = '✅ เสร็จ';
            if (prodStatus) prodStatus.className = 'step-status done';
        } else {
            if (stepProduct) stepProduct.className = 'pipeline-step';
            if (prodStatus) prodStatus.textContent = '⏳ รอ';
            if (prodStatus) prodStatus.className = 'step-status';
        }

        // === Step 3: Scenes ===
        if (pipeStep === 'scenes') {
            if (stepScenes) stepScenes.className = 'pipeline-step active';
            if (scenesStatus) scenesStatus.textContent = `⚡ ซีน ${currentIdx + 1}/${script.scenes.length}`;
            if (scenesStatus) scenesStatus.className = 'step-status active';
        } else if (pipeStep === 'done') {
            if (stepScenes) stepScenes.className = 'pipeline-step done';
            if (scenesStatus) scenesStatus.textContent = '✅ เสร็จทั้งหมด';
            if (scenesStatus) scenesStatus.className = 'step-status done';
        } else {
            if (stepScenes) stepScenes.className = 'pipeline-step';
            if (scenesStatus) scenesStatus.textContent = `⏳ ${script.scenes.length} ซีน`;
            if (scenesStatus) scenesStatus.className = 'step-status';
        }

        // === Render Scene Cards ===
        renderSceneCards(script, currentIdx, phase, pipeStep);
    });
}

// ===== Progress Bar =====
function updateProgressBar(script, currentIdx, phase, pipeStep) {
    if (pipeStep === 'idle') {
        progressContainer.style.display = 'none';
        return;
    }

    progressContainer.style.display = 'flex';
    const totalSteps = script.scenes.length * 2; // image + video per scene
    let completedSteps = 0;

    if (['scenes', 'done'].includes(pipeStep)) {
        completedSteps = currentIdx * 2;
        if (phase === 'video') completedSteps += 1;
        if (pipeStep === 'done') completedSteps = totalSteps;
    }

    const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
    progressBar.style.width = pct + '%';
    progressText.textContent = pct + '%';

    if (pct >= 100) {
        progressBar.classList.add('complete');
    } else {
        progressBar.classList.remove('complete');
    }
}


// ===== Render Scene Cards with per-scene step buttons =====
function renderSceneCards(script, currentIdx, phase, pipeStep) {
    const existingSceneCount = sceneList.querySelectorAll('.scene-block').length;
    if (existingSceneCount === script.scenes.length) return;

    sceneList.innerHTML = '';
    
    // === Pipeline Control Bar ===
    const pipeBar = document.createElement('div');
    pipeBar.id = 'pipelineBar';
    pipeBar.style.cssText = 'background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:8px;padding:10px;margin-bottom:10px;';
    pipeBar.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <button id="btnFullPipeline" style="flex:1;padding:8px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:6px;cursor:pointer">🚀 Auto Pipeline ทั้งหมด</button>
            <button id="btnPausePipeline" style="display:none;padding:8px 12px;font-size:12px;font-weight:700;background:#f59e0b;color:#000;border:none;border-radius:6px;cursor:pointer">⏸️ พัก</button>
            <button id="btnStopPipeline2" style="display:none;padding:8px 12px;font-size:12px;font-weight:700;background:#dc2626;color:white;border:none;border-radius:6px;cursor:pointer">⏹️ หยุด</button>
        </div>
        <div id="pipePhases" style="display:none;gap:4px;margin-bottom:6px;font-size:10px;flex-wrap:wrap">
            <span id="ph-character" style="padding:2px 6px;border-radius:4px;background:#334155;color:#94a3b8">🎭 ตัวละคร</span>
            <span id="ph-product" style="padding:2px 6px;border-radius:4px;background:#334155;color:#94a3b8">📦 สินค้า</span>
            <span id="ph-images" style="padding:2px 6px;border-radius:4px;background:#334155;color:#94a3b8">🖼️ ภาพซีน</span>
            <span id="ph-videos" style="padding:2px 6px;border-radius:4px;background:#334155;color:#94a3b8">🎬 วิดีโอ</span>
        </div>
        <pre id="pipelineLog2" style="display:none;max-height:120px;overflow-y:auto;font-size:9px;background:#020617;color:#e2e8f0;padding:6px;border-radius:4px;margin:0;white-space:pre-wrap"></pre>
    `;
    sceneList.appendChild(pipeBar);
    
    // Pipeline button handler
    document.getElementById('btnFullPipeline').addEventListener('click', () => {
        const btn = document.getElementById('btnFullPipeline');
        const stopBtn = document.getElementById('btnStopPipeline2');
        const phases = document.getElementById('pipePhases');
        const log = document.getElementById('pipelineLog2');
        const pauseBtn = document.getElementById('btnPausePipeline');
        
        btn.style.display = 'none';
        stopBtn.style.display = 'block';
        pauseBtn.style.display = 'block';
        phases.style.display = 'flex';
        log.style.display = 'block';
        log.textContent = '🚀 Pipeline เริ่ม...\n🔒 ล็อคหน้าจอ Flow\n';
        
        // Collect scene data
        const charPrompt = document.getElementById('charPromptText')?.textContent || '';
        const prodImgEl = document.querySelector('#prodImagePreview img');
        const productImageUrl = prodImgEl?.src || '';
        
        chrome.runtime.sendMessage({
            type: 'FULL_PIPELINE',
            data: {
                charPrompt,
                productImageUrl,
                scenes: script.scenes,
                delay: 2000
            }
        });
    });
    
    // Stop button
    document.getElementById('btnStopPipeline2').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'FULL_PIPELINE_STOP' });
        const log = document.getElementById('pipelineLog2');
        if (log) log.textContent += '⏹️ กำลังหยุด...\n';
        document.getElementById('btnPausePipeline').style.display = 'none';
    });
    
    // Pause/Resume toggle button
    let isPaused = false;
    document.getElementById('btnPausePipeline').addEventListener('click', () => {
        const pauseBtn = document.getElementById('btnPausePipeline');
        const log = document.getElementById('pipelineLog2');
        isPaused = !isPaused;
        if (isPaused) {
            chrome.runtime.sendMessage({ type: 'FULL_PIPELINE_PAUSE' });
            pauseBtn.textContent = '▶️ ทำต่อ';
            pauseBtn.style.background = '#10b981';
            pauseBtn.style.color = '#fff';
            if (log) log.textContent += '⏸️ พัก — ปลดล็อคหน้าจอแล้ว กดใช้เว็บได้\n';
        } else {
            chrome.runtime.sendMessage({ type: 'FULL_PIPELINE_RESUME' });
            pauseBtn.textContent = '⏸️ พัก';
            pauseBtn.style.background = '#f59e0b';
            pauseBtn.style.color = '#000';
            if (log) log.textContent += '▶️ ทำต่อ — ล็อคหน้าจอกลับ\n';
        }
    });
    
    script.scenes.forEach((scene, i) => {
        const sn = scene.sceneNumber || (i + 1);
        const sceneName = `ซีน${sn}`;
        const imgPrompt = scene.imagePromptEN || scene.imagePromptTH || scene.imagePrompt || scene.prompt || '-';
        const vidPrompt = (scene.videoPromptEN || scene.videoPromptTH || scene.videoPrompt || '') + (scene.dialogue ? '\n\nบทพูด: ' + scene.dialogue : '') || '-';
        const needsProduct = scene.hasProduct !== false;

        const block = document.createElement('div');
        block.className = 'scene-block';
        block.style.cssText = 'background:#1e293b;border-radius:8px;padding:8px;margin-top:6px';
        block.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer" class="scene-toggle">
                <span style="font-size:12px;font-weight:700;color:#fbbf24">🎬 ซีนที่ ${sn}</span>
                <span style="flex:1"></span>
                <span class="scene-badge" style="font-size:9px;color:#94a3b8">⏳ รอ</span>
            </div>
            <div class="scene-body" style="display:none">
                <button class="auto-scene-new" data-scene="${i}" style="width:100%;padding:6px;margin-bottom:6px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#f59e0b,#ef4444);color:white;border:none;border-radius:6px;cursor:pointer">⚡ Auto สร้างภาพ ซีนที่ ${sn}</button>
                
                <div class="scene-steps" data-scene="${i}" style="display:flex;flex-direction:column;gap:2px;margin-bottom:6px">
                    <div style="padding:2px 6px"><span style="font-size:9px;color:#38bdf8;font-weight:600">🖼️ สร้างภาพ</span></div>
                    <div class="sc-step" data-action="CLICK_ADD_MEDIA" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">① กด + Add Media</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="CLICK_CREATE_COLLECTION" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">② กด Create Collection</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="CLICK_NEW_COLLECTION" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">③ คลิกเข้า Collection ใหม่</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="WAIT_COLLECTION_URL" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">④ รอ URL /collection/</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="CLICK_TITLE" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">⑤ คลิก Title</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="SELECT_ALL_DELETE" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">⑥ Ctrl+A ลบ (CDP)</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="TYPE_NAME" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">⑦ พิมพ์ "${sceneName}" (CDP)</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="CLICK_DONE" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">⑧ กด ✓ Done</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="CREATE_SCENE_IMAGE" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">⑨ สร้างภาพ${needsProduct ? ' (+ ตัวละคร + สินค้า)' : ' (+ ตัวละคร)'}</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="GO_BACK" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">⑩ กลับหน้าแรก + บันทึก URL</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#38bdf8;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div style="border-top:1px solid #334155;margin:4px 0;padding-top:2px">
                        <span style="font-size:9px;color:#a78bfa;font-weight:600">🎬 สร้างวิดีโอ</span>
                    </div>
                    <div class="sc-step" data-action="OPEN_COLLECTION_URL" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">⑪ เปิด Collection URL</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#a78bfa;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                    <div class="sc-step" data-action="CREATE_SCENE_VIDEO" style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#0f172a;border-radius:4px;font-size:10px">
                        <span class="sc-icon">⏳</span><span style="flex:1;color:#94a3b8">⑫ สร้างวิดีโอ (Veo 3.1)</span>
                        <button class="sc-run" style="background:#1e293b;border:1px solid #334155;color:#a78bfa;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:9px">▶</button>
                    </div>
                </div>
                
                <button class="auto-scene-video" data-scene="${i}" style="width:100%;padding:5px;margin-bottom:6px;font-size:10px;font-weight:700;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;border-radius:6px;cursor:pointer">🎬 Auto วิดีโอ ซีนที่ ${sn}</button>

                <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
                    <span style="font-size:9px;color:#64748b;white-space:nowrap">🔗 URL:</span>
                    <input type="text" class="scene-coll-url" style="font-size:9px;padding:2px 4px;flex:1;background:#0f172a;color:#cbd5e1;border:1px solid #334155;border-radius:3px" placeholder="Collection URL (วางลิงก์ได้)">
                    <button class="scene-open-url" style="font-size:9px;padding:2px 6px;background:#334155;color:#38bdf8;border:none;border-radius:3px;cursor:pointer">↗</button>
                </div>

                <div style="background:#0f172a;border-radius:4px;padding:6px;font-size:10px;margin-bottom:4px">
                    <span style="color:#64748b;font-size:9px">🎨 IMAGE PROMPT</span>
                    <p style="margin:2px 0 0;color:#cbd5e1;word-break:break-word">${imgPrompt}</p>
                </div>
                <div style="background:#0f172a;border-radius:4px;padding:6px;font-size:10px;margin-bottom:4px">
                    <span style="color:#64748b;font-size:9px">🎬 VIDEO / DIALOGUE</span>
                    <p style="margin:2px 0 0;color:#cbd5e1;word-break:break-word">${vidPrompt}</p>
                </div>

                <div style="margin-top:4px">
                    <div style="display:flex;align-items:center;justify-content:space-between">
                        <span style="font-size:9px;color:#64748b">🐛 Debug</span>
                        <button class="scene-clear-debug" style="font-size:8px;background:#334155;color:#94a3b8;border:none;border-radius:3px;padding:1px 4px;cursor:pointer">ล้าง</button>
                    </div>
                    <pre class="scene-debug" style="background:#0f172a;color:#94a3b8;font-size:9px;padding:4px;border-radius:4px;max-height:80px;overflow-y:auto;margin:2px 0 0;white-space:pre-wrap"></pre>
                </div>
            </div>
        `;
        sceneList.appendChild(block);

        const urlInput = block.querySelector('.scene-coll-url');
        block.querySelector('.scene-open-url').addEventListener('click', () => {
            if (urlInput.value) window.open(urlInput.value);
        });
        block.querySelector('.scene-toggle').addEventListener('click', () => {
            const body = block.querySelector('.scene-body');
            body.style.display = body.style.display === 'none' ? 'block' : 'none';
        });
        block.querySelector('.scene-clear-debug').addEventListener('click', () => {
            block.querySelector('.scene-debug').textContent = '';
        });

        const debugLog = (msg) => {
            const pre = block.querySelector('.scene-debug');
            pre.textContent += msg + '\n';
            pre.scrollTop = pre.scrollHeight;
        };

        const saveCollUrl = () => {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                if (tabs[0]?.url?.includes('/collection/')) {
                    urlInput.value = tabs[0].url;
                    debugLog('🔗 URL: ' + tabs[0].url);
                }
            });
        };

        // Step button clicks
        block.querySelector('.scene-steps').addEventListener('click', async (e) => {
            const btn = e.target.closest('.sc-run');
            if (!btn) return;
            const stepEl = btn.closest('.sc-step');
            if (!stepEl) return;
            const action = stepEl.dataset.action;
            const icon = stepEl.querySelector('.sc-icon');
            if (icon) icon.textContent = '🔄';
            btn.disabled = true;
            debugLog(`▶ ${action} ...`);

            chrome.runtime.sendMessage({
                type: 'TEST_CUSTOM_WORKFLOW',
                steps: [action], name: sceneName, delay: 2000,
                imagePrompt: imgPrompt, videoPrompt: vidPrompt,
                sceneOptions: { hasCharacter: true, hasProduct: needsProduct, collectionUrl: urlInput.value, charPrompt: script.characterPrompt }
            });

            const listener = (msg) => {
                if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
                    if (icon) icon.textContent = msg.success ? '✅' : '❌';
                    btn.disabled = false;
                    debugLog(msg.success ? `✅ ${action} สำเร็จ` : `❌ ${action}: ${msg.error || ''}`);
                    if (msg.success && (action === 'WAIT_COLLECTION_URL' || action === 'CLICK_DONE')) saveCollUrl();
                    chrome.runtime.onMessage.removeListener(listener);
                }
            };
            chrome.runtime.onMessage.addListener(listener);
        });

        // Auto สร้างภาพ button
        block.querySelector('.auto-scene-new').addEventListener('click', async () => {
            const autoBtn = block.querySelector('.auto-scene-new');
            autoBtn.textContent = '⏳ กำลังสร้างภาพ...';
            autoBtn.disabled = true;
            debugLog('⚡ Auto สร้างภาพเริ่ม...');
            // reset image step icons only (①-⑩)
            const allIcons = block.querySelectorAll('.sc-icon');
            for (let x = 0; x < 10 && x < allIcons.length; x++) allIcons[x].textContent = '⏳';

            const imgSteps = [
                'CLICK_ADD_MEDIA', 'CLICK_CREATE_COLLECTION', 'CLICK_NEW_COLLECTION',
                'WAIT_COLLECTION_URL', 'CLICK_TITLE', 'SELECT_ALL_DELETE',
                'TYPE_NAME', 'CLICK_DONE', 'CREATE_SCENE_IMAGE', 'GO_BACK'
            ];

            chrome.runtime.sendMessage({
                type: 'TEST_CUSTOM_WORKFLOW',
                steps: imgSteps, name: sceneName, delay: 2000,
                imagePrompt: imgPrompt, videoPrompt: vidPrompt,
                sceneOptions: { hasCharacter: true, hasProduct: needsProduct, charPrompt: script.characterPrompt }
            });

            const listener = (msg) => {
                if (msg.type === 'CUSTOM_STEP_UPDATE') {
                    debugLog(`${msg.status === 'done' ? '✅' : '🔄'} ${msg.message || msg.action}`);
                    const icons = block.querySelectorAll('.sc-icon');
                    const stepIdx = imgSteps.indexOf(msg.action);
                    if (stepIdx >= 0 && icons[stepIdx]) {
                        icons[stepIdx].textContent = msg.status === 'done' ? '✅' : '🔄';
                    }
                    if (msg.action === 'WAIT_COLLECTION_URL' && msg.status === 'done') saveCollUrl();
                }
                if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
                    autoBtn.textContent = msg.success ? '✅ ภาพเสร็จ!' : `❌ ${msg.error || 'ล้มเหลว'}`;
                    autoBtn.disabled = false;
                    debugLog(msg.success ? '✅ Auto สร้างภาพเสร็จ!' : `❌ Auto ล้มเหลว: ${msg.error || 'unknown'}`);
                    setTimeout(() => { autoBtn.textContent = `⚡ Auto สร้างภาพ ซีนที่ ${sn}`; }, 5000);
                    chrome.runtime.onMessage.removeListener(listener);
                }
            };
            chrome.runtime.onMessage.addListener(listener);
        });

        // Auto วิดีโอ button
        block.querySelector('.auto-scene-video').addEventListener('click', async () => {
            const vidBtn = block.querySelector('.auto-scene-video');
            const collUrl = urlInput.value;
            if (!collUrl) {
                debugLog('❌ ไม่มี Collection URL — กรุณาสร้างภาพซีนก่อน');
                vidBtn.textContent = '❌ ไม่มี URL';
                setTimeout(() => { vidBtn.textContent = `🎬 Auto วิดีโอ ซีนที่ ${sn}`; }, 3000);
                return;
            }
            vidBtn.textContent = '⏳ กำลังสร้างวิดีโอ...';
            vidBtn.disabled = true;
            debugLog('🎬 Auto วิดีโอเริ่ม...');
            // reset video step icons (⑪-⑫)
            const allIcons = block.querySelectorAll('.sc-icon');
            if (allIcons[10]) allIcons[10].textContent = '⏳';
            if (allIcons[11]) allIcons[11].textContent = '⏳';

            const vidSteps = ['OPEN_COLLECTION_URL', 'CREATE_SCENE_VIDEO'];

            chrome.runtime.sendMessage({
                type: 'TEST_CUSTOM_WORKFLOW',
                steps: vidSteps, name: sceneName, delay: 2000,
                imagePrompt: imgPrompt, videoPrompt: vidPrompt,
                sceneOptions: { hasCharacter: true, hasProduct: needsProduct, collectionUrl: collUrl, charPrompt: script.characterPrompt }
            });

            const listener = (msg) => {
                if (msg.type === 'CUSTOM_STEP_UPDATE') {
                    debugLog(`${msg.status === 'done' ? '✅' : '🔄'} ${msg.message || msg.action}`);
                    const icons = block.querySelectorAll('.sc-icon');
                    if (msg.action === 'OPEN_COLLECTION_URL' && icons[10]) icons[10].textContent = msg.status === 'done' ? '✅' : '🔄';
                    if (msg.action === 'CREATE_SCENE_VIDEO' && icons[11]) icons[11].textContent = msg.status === 'done' ? '✅' : '🔄';
                }
                if (msg.type === 'CUSTOM_WORKFLOW_DONE') {
                    vidBtn.textContent = msg.success ? '✅ วิดีโอเสร็จ!' : `❌ ${msg.error || 'ล้มเหลว'}`;
                    vidBtn.disabled = false;
                    debugLog(msg.success ? '✅ Auto วิดีโอเสร็จ!' : `❌ วิดีโอล้มเหลว: ${msg.error || 'unknown'}`);
                    setTimeout(() => { vidBtn.textContent = `🎬 Auto วิดีโอ ซีนที่ ${sn}`; }, 5000);
                    chrome.runtime.onMessage.removeListener(listener);
                }
            };
            chrome.runtime.onMessage.addListener(listener);
        });
    });
}
// ===== ดึงสคริปต์จากหน้า Gemini (Tab ปัจจุบัน) =====
document.getElementById('pullConfigBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('pullConfigBtn');
    const origHTML = btn.innerHTML;
    btn.innerHTML = '⏳ กำลังดึงสคริปต์...';
    btn.disabled = true;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || (!tab.url.includes('gemini.google.com') && !tab.url.includes('aistudio.google.com'))) {
            throw new Error('กรุณาเปิดหน้า Gemini หรือ AI Studio ก่อนกดปุ่มนี้');
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                function tryLocalParse(text) {
                    if (!text) return null;
                    try { return JSON.parse(text.trim()); } catch (e) { }
                    try {
                        const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
                        if (m) return JSON.parse(m[1].trim());
                    } catch (e) { }
                    try {
                        const m = text.match(/\{[\s\S]*"scenes"[\s\S]*\}/);
                        if (m) return JSON.parse(m[0]);
                    } catch (e) { }
                    return null;
                }
                
                function getLatestResponse() {
                    const selectors = [
                        'message-content .markdown',
                        '.model-response-text .markdown',
                        'infinite-scroller .markdown',
                        '.chat-history .markdown',
                        '.response-container .markdown',
                        '.markdown'
                    ];

                    for (const sel of selectors) {
                        const els = document.querySelectorAll(sel);
                        if (els.length > 0) {
                            const text = els[els.length - 1].textContent;
                            if (text && text.length > 50) return text;
                        }
                    }

                    // ลองหา code blocks ที่มี JSON
                    const codeBlocks = document.querySelectorAll('code-block, pre, code');
                    for (const block of codeBlocks) {
                        const t = block.textContent || '';
                        if (t.includes('"scenes"') || t.includes('sceneNumber')) return t;
                    }

                    return null;
                }

                const responseText = getLatestResponse();
                if (!responseText) return { error: 'หาคำตอบจาก Gemini ไม่เจอ' };
                
                const script = tryLocalParse(responseText);
                if (!script || !script.scenes) {
                    return { text: responseText, error: 'JSON parse ล้มเหลว กรุณาแก้ format ให้ถูกต้อง' };
                }
                
                return { script };
            }
        });

        const res = results[0]?.result;
        if (res && res.error && !res.text) throw new Error(res.error);
        
        // ถ้าได้ script local เลย
        if (res && res.script) {
            chrome.runtime.sendMessage({ type: 'SCRIPT_READY', script: res.script });
            btn.innerHTML = '✅ ดึงสคริปต์สำเร็จ!';
        } else if (res && res.text) {
            // ถ้าได้แค่ text ลองส่งไปให้ API parsing
            btn.innerHTML = '⏳ กำลังใช้ API ช่วยแกะ JSON...';
            const apiRes = await chrome.runtime.sendMessage({
                type: 'GEM_RAW_RESPONSE',
                text: res.text
            });
            if (apiRes && apiRes.success) {
                chrome.runtime.sendMessage({ type: 'SCRIPT_READY', script: apiRes.script });
                btn.innerHTML = '✅ ดึงสคริปต์สำเร็จ!';
            } else {
                throw new Error(apiRes?.error || res.error || 'Parsing failed');
            }
        } else {
            throw new Error('ไม่พบข้อมูลใดๆ');
        }
    } catch (e) {
        alert('เกิดข้อผิดพลาด:\n' + e.message);
        btn.innerHTML = '❌ ล้มเหลว';
    } finally {
        setTimeout(() => {
            btn.innerHTML = origHTML;
            btn.disabled = false;
        }, 3000);
    }
});

function showButtonFeedback(btn, text) {
    const origHTML = btn.innerHTML;
    btn.innerHTML = `<span class="auto-run-icon">${text}</span>`;
    btn.classList.add('clicked');
    setTimeout(() => {
        btn.innerHTML = origHTML;
        btn.classList.remove('clicked');
    }, 2000);
}

function createImageCard(scene, sn, i, currentIdx, phase) {
    const isActiveScene = i === currentIdx;
    const isDone = i < currentIdx || (isActiveScene && phase === 'video');
    const isActive = isActiveScene && phase === 'image';

    const card = document.createElement('div');
    card.className = 'scene-sub' + (isActive ? ' active' : '') + (isDone ? ' done' : '');
    card.dataset.type = 'image';
    card.dataset.scene = i;

    let statusIcon = '⏳', statusText = 'รอ', statusClass = '';
    if (isDone) { statusIcon = '✅'; statusText = 'เสร็จ'; statusClass = 'done'; }
    else if (isActive) { statusIcon = '🎨'; statusText = 'กำลังสร้าง'; statusClass = 'active'; }

    const prodBadge = scene.hasProduct ? '<span class="prod-tag">📦 ใส่รูปสินค้า</span>' : '<span class="no-prod-tag">👤 ไม่ใส่รูป</span>';

    card.innerHTML = `
        <div class="sub-header">
            <div class="sub-left">
                <span class="sub-icon">🎨</span>
                <span class="sub-title">ซีน ${sn} — สร้างภาพ</span>
                ${prodBadge}
            </div>
            <span class="sub-status ${statusClass}">${statusIcon} ${statusText}</span>
        </div>
        <div class="sub-body" style="display:${isActive ? 'block' : 'none'}">
            <div class="prompt-box">
                <span class="prompt-label">Image Prompt</span>
                <p class="prompt-text img-prompt">${scene.imagePromptEN || scene.imagePromptTH || '-'}</p>
            </div>
            <button class="action-btn small copy-img-prompt" data-prompt="${encodeURIComponent(scene.imagePromptEN || scene.imagePromptTH || '')}">📋 คัดลอก Prompt ภาพ</button>
        </div>
    `;

    card.querySelector('.sub-header').addEventListener('click', () => {
        const body = card.querySelector('.sub-body');
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    card.querySelector('.copy-img-prompt')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = decodeURIComponent(e.target.dataset.prompt);
        navigator.clipboard.writeText(text).then(() => {
            e.target.textContent = '✅ คัดลอกแล้ว!';
            setTimeout(() => { e.target.textContent = '📋 คัดลอก Prompt ภาพ'; }, 1500);
        });
    });

    return card;
}

function createVideoCard(scene, sn, i, currentIdx, phase) {
    const isActiveScene = i === currentIdx;
    const isDone = i < currentIdx;
    const isActive = isActiveScene && phase === 'video';

    const card = document.createElement('div');
    card.className = 'scene-sub' + (isActive ? ' active' : '') + (isDone ? ' done' : '');
    card.dataset.type = 'video';
    card.dataset.scene = i;

    let statusIcon = '⏳', statusText = 'รอ', statusClass = '';
    if (isDone) { statusIcon = '✅'; statusText = 'เสร็จ'; statusClass = 'done'; }
    else if (isActive) { statusIcon = '🎬'; statusText = 'กำลังสร้าง'; statusClass = 'active'; }

    const videoText = (scene.videoPromptEN || scene.videoPromptTH || '') +
        (scene.dialogue ? '\n\nบทพูด: ' + scene.dialogue : '');

    card.innerHTML = `
        <div class="sub-header">
            <div class="sub-left">
                <span class="sub-icon">🎬</span>
                <span class="sub-title">ซีน ${sn} — สร้างวิดีโอ</span>
            </div>
            <span class="sub-status ${statusClass}">${statusIcon} ${statusText}</span>
        </div>
        <div class="sub-body" style="display:${isActive ? 'block' : 'none'}">
            <div class="prompt-box">
                <span class="prompt-label">Video Prompt</span>
                <p class="prompt-text vid-prompt">${scene.videoPromptEN || scene.videoPromptTH || '-'}</p>
            </div>
            <div class="dialogue-box">
                <span class="prompt-label">💬 บทพูด</span>
                <p class="dialogue-text">${scene.dialogue || '-'}</p>
            </div>
            <button class="action-btn small copy-vid-prompt" data-prompt="${encodeURIComponent(videoText)}">📋 คัดลอก Prompt วิดีโอ+บทพูด</button>
        </div>
    `;

    card.querySelector('.sub-header').addEventListener('click', () => {
        const body = card.querySelector('.sub-body');
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    card.querySelector('.copy-vid-prompt')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = decodeURIComponent(e.target.dataset.prompt);
        navigator.clipboard.writeText(text).then(() => {
            e.target.textContent = '✅ คัดลอกแล้ว!';
            setTimeout(() => { e.target.textContent = '📋 คัดลอก Prompt วิดีโอ+บทพูด'; }, 1500);
        });
    });

    return card;
}

function updateSubCardStatus(card, sceneIdx, currentIdx, phase, type) {
    if (!card) return;
    const isActiveScene = sceneIdx === currentIdx;
    let isDone, isActive;

    if (type === 'image') {
        isDone = sceneIdx < currentIdx || (isActiveScene && phase === 'video');
        isActive = isActiveScene && phase === 'image';
    } else {
        isDone = sceneIdx < currentIdx;
        isActive = isActiveScene && phase === 'video';
    }

    card.className = 'scene-sub' + (isActive ? ' active' : '') + (isDone ? ' done' : '');

    const statusEl = card.querySelector('.sub-status');
    if (statusEl) {
        if (isDone) {
            statusEl.textContent = '✅ เสร็จ';
            statusEl.className = 'sub-status done';
        } else if (isActive) {
            statusEl.textContent = type === 'image' ? '🎨 กำลังสร้าง' : '🎬 กำลังสร้าง';
            statusEl.className = 'sub-status active';
        } else {
            statusEl.textContent = '⏳ รอ';
            statusEl.className = 'sub-status';
        }
    }
}

// ===== Global Controls =====
runAllBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RUN_ALL_SCENES', startIndex: 0 });
    showButtonFeedback(runAllBtn, '🚀 เริ่มแล้ว!');
});

stopAllBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_AND_CLEAR' });
    showButtonFeedback(stopAllBtn, '⏹️ หยุดแล้ว');
});

// ===== Copy Character Prompt =====
if(copyCharBtn) copyCharBtn.addEventListener('click', () => {
    const text = charPromptText.textContent;
    if (text && text !== '-') {
        navigator.clipboard.writeText(text).then(() => {
            if (copyCharBtn) if(copyCharBtn) copyCharBtn.textContent = '✅ คัดลอกแล้ว!';
            setTimeout(() => { if(copyCharBtn) copyCharBtn.textContent = '📋 คัดลอก Prompt'; }, 2000);
        });
    }
});




// ===== Load logs =====
function loadLogs() {
    chrome.runtime.sendMessage({ type: 'GET_LOGS' }, (logs) => {
        if (chrome.runtime.lastError) return;
        if (!logs || logs.length === 0) {
            logList.innerHTML = '<div class="log-empty">ยังไม่มี log</div>';
            return;
        }

        logList.innerHTML = '';
        [...logs].reverse().forEach(entry => {
            const div = document.createElement('div');
            div.className = 'log-entry';
            div.innerHTML = `<span class="log-time">${entry.time}</span><span class="log-msg">${entry.message}</span>`;
            logList.appendChild(div);
        });
    });
}

// ===== Clear logs =====
clearLogs.addEventListener('click', () => {
    chrome.storage.local.set({ botLogs: [] }, () => {
        logList.innerHTML = '<div class="log-empty">ล้าง log แล้ว</div>';
    });
});

// ===== Stop & Clear =====
stopBtn.addEventListener('click', async () => {
    stopBtn.textContent = '⏳ กำลังเคลียร์...';
    stopBtn.disabled = true;

    chrome.runtime.sendMessage({ type: 'STOP_AND_CLEAR' });

    // Fixed race condition: get then clear then set back
    chrome.storage.local.get(['geminiApiKey', 'gemUrl'], (settings) => {
        const restore = {};
        if (settings.geminiApiKey) restore.geminiApiKey = settings.geminiApiKey;
        if (settings.gemUrl) restore.gemUrl = settings.gemUrl;

        chrome.storage.local.clear(() => {
            if (Object.keys(restore).length > 0) {
                chrome.storage.local.set(restore);
            }
        });
    });

    try {
        await fetch(`${DB_URL}/tasks.json`, { method: 'DELETE' });
        await fetch(`${DB_URL}/status.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: 'idle', message: '🛑 หยุดแล้ว — พร้อมรับงานใหม่', updatedAt: Date.now() })
        });
    } catch (e) { }

    currentStatus.textContent = '🛑 หยุดแล้ว — พร้อมรับงานใหม่';
    statusDot.className = 'status-dot';
    statusIcon.textContent = '💤';
    scriptEmpty.style.display = 'flex';
    scriptContent.style.display = 'none';
    progressContainer.style.display = 'none';
    logList.innerHTML = '<div class="log-empty">เคลียร์แล้ว ✅</div>';
    stopBtn.textContent = '✅ เคลียร์แล้ว!';

    setTimeout(() => {
        stopBtn.textContent = '🛑 หยุด & เคลียร์ทุกอย่าง';
        stopBtn.disabled = false;
    }, 2000);
});

// ===== Init =====
try { const d = document.getElementById('_dbg'); if(d) d.innerHTML += ' → ✅ Init'; } catch(e){}
loadStatus();
loadLogs();
loadScript();

setInterval(() => {
    loadStatus();
    loadLogs();
    loadScript();
}, 2000);


// ============================================
// Recorder — บันทึกการคลิก
// ============================================
console.log('[SidePanel] === Recorder section loaded ===');
try { const d = document.getElementById('_dbg'); if(d) d.innerHTML += ' → ✅ Recorder'; } catch(e){}

const recStartBtn = document.getElementById('recStartBtn');
const recStopBtn = document.getElementById('recStopBtn');
const recCopyBtn = document.getElementById('recCopyBtn');
const recClearBtn = document.getElementById('recClearBtn');
const recTestBtn = document.getElementById('recTestBtn');
const recActions = document.getElementById('recActions');
let recIsRecording = false;
let recPollInterval = null;

recStartBtn?.addEventListener('click', async () => {
    console.log('[SidePanel] 🔴 recStart clicked!');
    
    // แสดงผลทันที
    recStartBtn.disabled = true;
    recStartBtn.classList.add('recording');
    recStartBtn.textContent = '🔴 กำลังบันทึก...';
    if (recStopBtn) recStopBtn.disabled = false;
    recIsRecording = true;
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { 
        console.log('[SidePanel] No active tab!'); 
        recActions.innerHTML = '<div style="color:#f87171;padding:8px">❌ ไม่เจอ tab! เปิดหน้าเว็บก่อน</div>';
        recStartBtn.disabled = false;
        recStartBtn.textContent = '🔴 เริ่มบันทึก';
        return; 
    }

    // Inject content-recorder.js
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-recorder.js']
        });
        console.log('[SidePanel] content-recorder.js injected');
    } catch (e) {
        console.log('[SidePanel] Inject error:', e.message);
        recActions.innerHTML = `<div style="color:#f87171;padding:8px">❌ ไม่สามารถ inject ได้: ${e.message}</div>`;
    }

    // ส่ง START_RECORDING ไป content script
    try {
        chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' }, () => {
            if (chrome.runtime.lastError) {
                console.log('[SidePanel] sendMessage error:', chrome.runtime.lastError.message);
                recActions.innerHTML = '<div style="color:#fbbf24;padding:8px">⚠️ กำลังรอ content script... ลองกดบนหน้าเว็บ</div>';
            }
            recPollInterval = setInterval(() => pollRecordedActions(tab.id), 1500);
        });
    } catch (e) {
        console.log('[SidePanel] sendMessage catch:', e.message);
    }
});

recStopBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' }, () => {
        recIsRecording = false;
        recStartBtn.disabled = false;
        recStartBtn.classList.remove('recording');
        recStartBtn.textContent = '🔴 เริ่มบันทึก';
        recStopBtn.disabled = true;
        if (recPollInterval) { clearInterval(recPollInterval); recPollInterval = null; }
        pollRecordedActions(tab.id);
    });
});

recClearBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_RECORDING' });
    chrome.storage.local.remove('recordedActions');
    recActions.innerHTML = '<div class="rec-empty">ยังไม่มีการบันทึก</div>';
});

recTestBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    
    chrome.storage.local.get(['recordedActions'], (data) => {
        const actions = data.recordedActions || [];
        if (actions.length === 0) {
            alert('ยังไม่มีการบันทึก! กรุณากดปุ่ม "เริ่มบันทึก" แล้วคลิกบนหน้าเว็บก่อนครับ');
            return;
        }
        recTestBtn.textContent = '⏳ กำลังทดสอบ...';
        recTestBtn.disabled = true;
        chrome.tabs.sendMessage(tab.id, { type: 'PLAYBACK_ACTIONS', actions: actions }, () => {
            recTestBtn.textContent = '▶️ ทดสอบ สคริปต์ที่บันทึก';
            recTestBtn.disabled = false;
        });
    });
});

recCopyBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { type: 'GET_RECORDING' }, (resp) => {
        const actions = resp?.actions || [];
        if (actions.length === 0) {
            alert('ยังไม่มีการบันทึก!');
            return;
        }

        let text = `📋 Recorded Actions (${actions.length})\n`;
        text += `URL: ${tab.url}\n`;
        text += '='.repeat(50) + '\n\n';

        actions.forEach((a, i) => {
            text += `--- Action ${i + 1}: ${a.type} (${a.timestamp}) ---\n`;
            text += `Tag: ${a.tag}\n`;
            text += `Selector: ${a.selector}\n`;
            text += `UniqueSelector: ${a.uniqueSelector}\n`;
            text += `Text: "${a.text?.substring(0, 80)}"\n`;
            text += `Position: x=${a.position?.x} y=${a.position?.y} w=${a.position?.width} h=${a.position?.height}\n`;
            if (a.attrs && Object.keys(a.attrs).length > 0) {
                text += `Attrs: ${JSON.stringify(a.attrs)}\n`;
            }
            text += `Parent: ${a.parentTag}.${a.parentClass?.substring(0, 40)}\n`;
            text += `InnerHTML: ${a.innerHTML?.substring(0, 120)}\n`;
            text += '\n';
        });

        navigator.clipboard.writeText(text).then(() => {
            recCopyBtn.textContent = '✅ คัดลอกแล้ว!';
            setTimeout(() => { recCopyBtn.textContent = '📋 คัดลอก ทั้งหมด'; }, 2000);
        });
    });
});

function pollRecordedActions(tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'GET_RECORDING' }, (resp) => {
        if (chrome.runtime.lastError) return;
        const actions = resp?.actions || [];
        renderRecordedActions(actions);
    });
}

function renderRecordedActions(actions) {
    if (!recActions) return;

    if (actions.length === 0) {
        recActions.innerHTML = '<div class="rec-empty">ยังไม่มีการบันทึก — คลิกบนหน้าเว็บ</div>';
        return;
    }

    const typeIcons = {
        click: '🖱️', right_click: '👆', input: '⌨️', change: '🔄',
        paste: '📋', focus: '🎯', copy_prompt: '📎'
    };

    recActions.innerHTML = actions.map((a, i) => `
        <div class="rec-card">
            <div class="rec-header">
                <span class="rec-type">#${i + 1} ${typeIcons[a.type] || '📌'} ${a.type}</span>
                <span class="rec-time">${a.timestamp}</span>
            </div>
            <div class="rec-tag">&lt;${a.tag.toLowerCase()}&gt; ${a.attrs?.role ? '[role="' + a.attrs.role + '"]' : ''}</div>
            <div class="rec-selector">${a.uniqueSelector || a.selector}</div>
            ${a.inputValue ? `<div class="rec-text" style="color:#4ade80">⌨️ ค่าที่พิมพ์: "${a.inputValue.substring(0, 80)}"</div>` : ''}
            ${a.text && !a.inputValue ? `<div class="rec-text">📝 "${a.text.substring(0, 60)}"</div>` : ''}
            ${a.attrs && Object.keys(a.attrs).length > 0 ? `<div class="rec-attrs">🏷️ ${Object.entries(a.attrs).map(([k, v]) => k + '="' + (v || '').substring(0, 30) + '"').join(', ')}</div>` : ''}
            <div class="rec-pos">📐 x:${a.position?.x} y:${a.position?.y} w:${a.position?.width} h:${a.position?.height}</div>
        </div>
    `).join('');

    recActions.scrollTop = recActions.scrollHeight;
}

// ===== Pipeline Auto System =====

// === Script Tab: 🚀 Batch Collections ===
document.getElementById('runBatchScript')?.addEventListener('click', () => {
    const textarea = document.getElementById('batchNamesScript');
    const names = textarea.value.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (names.length === 0) return;
    const btn = document.getElementById('runBatchScript');
    btn.textContent = '⏳ กำลังสร้าง...';
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: 'BATCH_WORKFLOW', names, delay: 3000 });
});

// Script tab batch listeners (reuse BATCH messages)
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'BATCH_STEP_UPDATE') {
        const prog = document.getElementById('batchProgressScript');
        if (prog) prog.textContent = msg.message;
    }
    if (msg.type === 'BATCH_WORKFLOW_DONE') {
        const btn = document.getElementById('runBatchScript');
        if (btn) { btn.textContent = '🚀 สร้าง Collections ทั้งหมด'; btn.disabled = false; }
        const prog = document.getElementById('batchProgressScript');
        if (prog) prog.textContent = msg.success ? '✅ เสร็จ!' : '❌ ' + (msg.error || 'ล้มเหลว');
    }
});

// === Script Tab: 🎨 Create Image ===
document.getElementById('btnCreateImageScript')?.addEventListener('click', () => {
    const prompt = document.getElementById('imagePromptScript')?.value?.trim();
    if (!prompt) return;
    chrome.runtime.sendMessage({ type: 'CREATE_IMAGE', prompt, name: '', settings: { type: 'IMAGE', ratio: '9:16', count: '1' } });
});

// === ⚡ Auto จากสคริปต์ ===
document.getElementById('btnAutoFromScript')?.addEventListener('click', () => {
    const statusDiv = document.getElementById('pipelineStatus');
    if (statusDiv) statusDiv.style.display = 'block';
    const logEl1 = document.getElementById('pipelineLog');
    if (logEl1) logEl1.innerHTML = '';
    const stepEl1 = document.getElementById('pipelineCurrentStep');
    if (stepEl1) stepEl1.textContent = '⚡ กำลังเริ่ม Auto Pipeline จากสคริปต์...';
    const stopBtn = document.getElementById('btnStopPipeline');
    if (stopBtn) stopBtn.style.display = 'block';
    chrome.runtime.sendMessage({ type: 'AUTO_PIPELINE_FROM_SCRIPT' });
});

// === 🚀 สร้าง Collections ===
document.getElementById('runBatchScript')?.addEventListener('click', () => {
    const textarea = document.getElementById('batchNamesScript');
    if (!textarea) return;
    const names = textarea.value.split('\n').map(n => n.trim()).filter(n => n.length > 0);
    if (names.length === 0) return;
    const btn = document.getElementById('runBatchScript');
    if (btn) { btn.textContent = '⏳ กำลังสร้าง...'; btn.disabled = true; }
    const prog = document.getElementById('batchProgressScript');
    if (prog) prog.textContent = `กำลังสร้าง ${names.length} collections...`;
    chrome.runtime.sendMessage({ type: 'BATCH_WORKFLOW', names, delay: 3000 });
});

// === 🤖 รัน Pipeline จาก Config ===
document.getElementById('btnRunPipeline')?.addEventListener('click', () => {
    const configText = document.getElementById('pipelineConfig')?.value;
    if (!configText) return;
    const config = parsePipelineConfig(configText);
    if (config.length === 0) return;
    const statusDiv = document.getElementById('pipelineStatus');
    if (statusDiv) statusDiv.style.display = 'block';
    const logEl2 = document.getElementById('pipelineLog');
    if (logEl2) logEl2.innerHTML = '';
    const stepEl2 = document.getElementById('pipelineCurrentStep');
    if (stepEl2) stepEl2.textContent = '🤖 กำลังเริ่ม Pipeline...';
    const stopBtn = document.getElementById('btnStopPipeline');
    if (stopBtn) stopBtn.style.display = 'block';
    chrome.runtime.sendMessage({ type: 'RUN_PIPELINE', config });
});

// === ⏹️ หยุด Pipeline ===
document.getElementById('btnStopPipeline')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_PIPELINE' });
    const stopBtn = document.getElementById('btnStopPipeline');
    if (stopBtn) stopBtn.style.display = 'none';
    const step = document.getElementById('pipelineCurrentStep');
    if (step) step.textContent = '⏹️ หยุดแล้ว';
});

// === 🗑️ ล้าง Pipeline ===
document.getElementById('btnClearPipeline')?.addEventListener('click', () => {
    const statusDiv = document.getElementById('pipelineStatus');
    if (statusDiv) statusDiv.style.display = 'none';
    const log = document.getElementById('pipelineLog');
    if (log) log.innerHTML = '';
    const step = document.getElementById('pipelineCurrentStep');
    if (step) step.textContent = '';
    const stopBtn = document.getElementById('btnStopPipeline');
    if (stopBtn) stopBtn.style.display = 'none';
});

function parsePipelineConfig(text) {
    return text.split('\n').map(line => line.trim()).filter(l => l.length > 0).map(line => {
        const parts = line.split('|').map(p => p.trim());
        const name = parts[0] || '';
        const type = (parts[1] || 'skip').toLowerCase();
        const promptRaw = parts[2] || '';
        let imagePrompt = '', videoPrompt = '';
        
        const imgMatch = promptRaw.match(/\[image\]\s*(.+?)(?=\[video\]|$)/i);
        const vidMatch = promptRaw.match(/\[video\]\s*(.+?)$/i);
        if (imgMatch) imagePrompt = imgMatch[1].trim();
        if (vidMatch) videoPrompt = vidMatch[1].trim();
        if (!imgMatch && !vidMatch && promptRaw) imagePrompt = promptRaw;
        
        return { name, type, imagePrompt, videoPrompt };
    });
}

function pipelineLog(msg) {
    const logDiv = document.getElementById('pipelineLog');
    if (logDiv) {
        logDiv.innerHTML += `<div>${msg}</div>`;
        logDiv.scrollTop = logDiv.scrollHeight;
    }
}

// Run Pipeline
document.getElementById('btnRunPipeline')?.addEventListener('click', () => {
    const config = parsePipelineConfig(document.getElementById('pipelineConfig')?.value || '');
    if (config.length === 0) return;
    
    const statusDiv = document.getElementById('pipelineStatus');
    statusDiv.style.display = 'block';
    document.getElementById('pipelineLog').innerHTML = '';
    document.getElementById('pipelineCurrentStep').textContent = '🤖 เริ่ม Pipeline...';
    
    document.getElementById('btnRunPipeline').style.display = 'none';
    document.getElementById('btnStopPipeline').style.display = 'block';
    
    pipelineLog('=== 🤖 Pipeline เริ่ม (' + config.length + ' collections) ===');
    chrome.runtime.sendMessage({ type: 'RUN_PIPELINE', config });
});

// Stop Pipeline
document.getElementById('btnStopPipeline')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_PIPELINE' });
    document.getElementById('pipelineCurrentStep').textContent = '⏹️ กำลังหยุด...';
});

// Clear Pipeline
document.getElementById('btnClearPipeline')?.addEventListener('click', () => {
    const statusDiv = document.getElementById('pipelineStatus');
    statusDiv.style.display = 'none';
    document.getElementById('pipelineLog').innerHTML = '';
    document.getElementById('pipelineCurrentStep').textContent = '';
});

// Pipeline message listeners
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PIPELINE_UPDATE') {
        document.getElementById('pipelineCurrentStep').textContent = msg.step || '';
        if (msg.log) pipelineLog(msg.log);
    }
    if (msg.type === 'PIPELINE_DONE') {
        document.getElementById('btnRunPipeline').style.display = 'block';
        document.getElementById('btnStopPipeline').style.display = 'none';
        document.getElementById('pipelineCurrentStep').textContent = msg.success ? '✅ Pipeline เสร็จ!' : '❌ ' + (msg.error || 'ล้มเหลว');
        pipelineLog('=== ' + (msg.success ? '✅ เสร็จ!' : '❌ ' + (msg.error || '')) + ' ===');
    }
});

// === 🧪 ทดสอบ Paste รูปซีน ===
document.getElementById('testPasteSceneImage')?.addEventListener('click', async () => {
    appendTestOutput('🧪 ทดสอบ Paste รูปซีน...');
    const btn = document.getElementById('testPasteSceneImage');
    btn.textContent = '⏳ กำลังทดสอบ...';
    btn.disabled = true;
    
    chrome.runtime.sendMessage({ type: 'TEST_PASTE_SCENE' }, (resp) => {
        btn.textContent = '📋 Paste รูปซีน';
        btn.disabled = false;
        if (resp?.success) {
            appendTestOutput('✅ Paste สำเร็จ! src: ' + (resp.imgSrc || ''));
        } else {
            appendTestOutput('❌ Paste ล้มเหลว: ' + (resp?.error || 'ไม่ทราบข้อผิดพลาด'));
        }
    });
});

// === 🧪 ทดสอบ more_vert + Add to Prompt ===
document.getElementById('testMoreVertAddPrompt')?.addEventListener('click', async () => {
    appendTestOutput('🧪 ทดสอบ more_vert + Add to Prompt...');
    const btn = document.getElementById('testMoreVertAddPrompt');
    btn.textContent = '⏳ กำลังทดสอบ...';
    btn.disabled = true;
    
    chrome.runtime.sendMessage({ type: 'TEST_MORE_VERT' }, (resp) => {
        btn.textContent = '⋮ more_vert+Add';
        btn.disabled = false;
        if (resp?.success) {
            appendTestOutput('✅ more_vert+AddToPrompt สำเร็จ!');
        } else {
            appendTestOutput('❌ ล้มเหลว: ' + (resp?.error || 'ไม่ทราบข้อผิดพลาด'));
        }
    });
});

// === 🚀 Pipeline Message Listeners ===
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PIPELINE_LOG') {
        const log = document.getElementById('pipelineLog2');
        if (log) {
            log.textContent += msg.message + '\n';
            log.scrollTop = log.scrollHeight;
        }
    }
    if (msg.type === 'PIPELINE_PHASE') {
        const el = document.getElementById('ph-' + msg.phase);
        if (el) {
            if (msg.status === 'active') {
                el.style.background = '#f59e0b'; el.style.color = '#000';
            } else if (msg.status === 'done') {
                el.style.background = '#10b981'; el.style.color = '#fff';
            }
        }
    }
    if (msg.type === 'PIPELINE_SCENE_URL') {
        // อัพเดท Collection URL ของซีนนั้นในช่อง input
        const urlInputs = document.querySelectorAll('.scene-block input[type="text"]');
        if (urlInputs[msg.sceneIndex]) {
            urlInputs[msg.sceneIndex].value = msg.url;
        }
    }
    if (msg.type === 'FULL_PIPELINE_DONE') {
        const btn = document.getElementById('btnFullPipeline');
        const stopBtn = document.getElementById('btnStopPipeline2');
        const pauseBtn = document.getElementById('btnPausePipeline');
        if (btn) { btn.style.display = 'block'; btn.textContent = msg.success ? '✅ Pipeline เสร็จ! (กดเพื่อรันใหม่)' : '🚀 Auto Pipeline ทั้งหมด'; }
        if (stopBtn) stopBtn.style.display = 'none';
        if (pauseBtn) { pauseBtn.style.display = 'none'; pauseBtn.textContent = '⏸️ พัก'; pauseBtn.style.background = '#f59e0b'; pauseBtn.style.color = '#000'; }
        const log = document.getElementById('pipelineLog2');
        if (log) {
            log.textContent += msg.success ? '\n🎉 ==================\n🎉 PIPELINE เสร็จสมบูรณ์!\n🎉 ==================\n' : '\n❌ Pipeline หยุด: ' + (msg.error || '') + '\n';
            log.scrollTop = log.scrollHeight;
        }
    }
});

// ==========================================
// Individual Step Manual Run Buttons
// ==========================================
setTimeout(() => {
    document.getElementById('btnRunOnlyCharacter')?.addEventListener('click', () => {
        chrome.storage.local.get(['currentScript'], (data) => {
            if (!data.currentScript) return;
            const prompt = data.currentScript.characterPrompt || '';
            const steps = [
                'CLICK_ADD_MEDIA', 'CLICK_CREATE_COLLECTION', 'CLICK_NEW_COLLECTION',
                'WAIT_COLLECTION_URL', 'CLICK_TITLE', 'SELECT_ALL_DELETE',
                'TYPE_NAME', 'CLICK_DONE', 'CREATE_IMAGE', 'GO_BACK'
            ];
            chrome.runtime.sendMessage({
                type: 'TEST_CUSTOM_WORKFLOW',
                steps: steps, name: 'ตัวละคร', delay: 2000,
                imagePrompt: prompt, videoPrompt: '',
                sceneOptions: { hasCharacter: false, hasProduct: false }
            });
            alert('🚀 สั่งสร้างเฉพาะตัวละครแล้ว! กรุณารอหน้าจอ Flow ทิ้งไว้');
        });
    });

    document.getElementById('btnRunOnlyProduct')?.addEventListener('click', () => {
        chrome.storage.local.get(['pendingImage'], (data) => {
            if (!data.pendingImage) return;
            const steps = [
                'CLICK_ADD_MEDIA', 'CLICK_CREATE_COLLECTION', 'CLICK_NEW_COLLECTION',
                'WAIT_COLLECTION_URL', 'CLICK_TITLE', 'SELECT_ALL_DELETE',
                'TYPE_NAME', 'CLICK_DONE', 'PASTE_IMAGE', 'GO_BACK'
            ];
            chrome.runtime.sendMessage({
                type: 'TEST_CUSTOM_WORKFLOW',
                steps: steps, name: 'สินค้า', delay: 2000,
                imagePrompt: '', videoPrompt: '', sceneOptions: {}
            });
            alert('🚀 สั่งสร้างเฉพาะรูปสินค้าแล้ว! กรุณารอหน้าจอ Flow ทิ้งไว้');
        });
    });

    // ==========================================
    // Settings Tab Handlers for Sidepanel
    // ==========================================
    const apiKeyInput = document.getElementById('apiKey');
    const gemUrlInput = document.getElementById('gemUrl');
    const systemPromptInput = document.getElementById('systemPrompt');
    const saveBtn = document.getElementById('saveBtn');
    const saveMsg = document.getElementById('saveMsg');
    const toggleKey = document.getElementById('toggleKey');
    const stopBtn = document.getElementById('stopBtn');

    if (apiKeyInput) {
        chrome.storage.local.get(['geminiApiKey', 'gemUrl', 'systemPrompt'], (data) => {
            if (data.geminiApiKey) apiKeyInput.value = data.geminiApiKey;
            if (data.gemUrl) gemUrlInput.value = data.gemUrl;
            if (data.systemPrompt) systemPromptInput.value = data.systemPrompt;
        });

        toggleKey?.addEventListener('click', () => {
            apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
            toggleKey.textContent = apiKeyInput.type === 'password' ? '👁️' : '🙈';
        });

        saveBtn?.addEventListener('click', () => {
            const key = apiKeyInput.value.trim();
            const url = gemUrlInput.value.trim();
            const prompt = systemPromptInput.value.trim();

            chrome.storage.local.set({
                geminiApiKey: key,
                systemPrompt: prompt,
                gemUrl: url || 'https://gemini.google.com/gem/823f453339b7'
            }, () => {
                if(saveMsg) {
                    saveMsg.textContent = '✅ บันทึกแล้ว!';
                    saveMsg.style.color = '#4ade80';
                    setTimeout(() => { saveMsg.textContent = ''; }, 2000);
                }
            });
        });

        stopBtn?.addEventListener('click', async () => {
             chrome.runtime.sendMessage({ type: 'STOP_AND_CLEAR' });
             chrome.storage.local.get(['geminiApiKey', 'gemUrl', 'systemPrompt'], (settings) => {
                 chrome.storage.local.clear(() => {
                     if (settings.geminiApiKey) chrome.storage.local.set({ geminiApiKey: settings.geminiApiKey });
                     if (settings.gemUrl) chrome.storage.local.set({ gemUrl: settings.gemUrl });
                     if (settings.systemPrompt) chrome.storage.local.set({ systemPrompt: settings.systemPrompt });
                 });
             });
             alert('🛑 หยุดการทำงานและล้างข้อมูลเรียบร้อยแล้ว!');
        });
    }

}, 1000);
