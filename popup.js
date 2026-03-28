// ============================================
// Popup Script — Settings + Status + Script Preview + Logs
// ============================================

const DB_URL = "https://affiliate-bot-ee9a2-default-rtdb.firebaseio.com";

// DOM
const apiKeyInput = document.getElementById('apiKey');
const gemUrlInput = document.getElementById('gemUrl');
const systemPromptInput = document.getElementById('systemPrompt');
const saveBtn = document.getElementById('saveBtn');
const saveMsg = document.getElementById('saveMsg');
const toggleKey = document.getElementById('toggleKey');
const statusDot = document.getElementById('statusDot');
const currentStatus = document.getElementById('currentStatus');
const logList = document.getElementById('logList');
const clearLogs = document.getElementById('clearLogs');
const stopBtn = document.getElementById('stopBtn');
const scriptCard = document.getElementById('scriptCard');
const scriptTitle = document.getElementById('scriptTitle');
const sceneBadge = document.getElementById('sceneBadge');
const sceneList = document.getElementById('sceneList');
const copyScriptBtn = document.getElementById('copyScriptBtn');
const retryFlowBtn = document.getElementById('retryFlowBtn');

// ===== Load saved settings =====
chrome.storage.local.get(['geminiApiKey', 'gemUrl', 'systemPrompt'], (data) => {
    if (data.geminiApiKey) apiKeyInput.value = data.geminiApiKey;
    if (data.gemUrl) gemUrlInput.value = data.gemUrl;
    if (data.systemPrompt) systemPromptInput.value = data.systemPrompt;
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
    const prompt = systemPromptInput.value.trim();

    chrome.storage.local.set({
        geminiApiKey: key,
        systemPrompt: prompt,
        gemUrl: url || 'https://gemini.google.com/gem/823f453339b7'
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
        }
    } catch (e) {
        currentStatus.textContent = 'ไม่สามารถโหลดสถานะ';
    }
}

// ===== Load & Display Script =====
function loadScript() {
    chrome.storage.local.get(['currentScript', 'currentSceneIndex', 'currentPhase'], (data) => {
        if (!data.currentScript || !data.currentScript.scenes) {
            scriptCard.style.display = 'none';
            return;
        }

        const script = data.currentScript;
        const currentIdx = data.currentSceneIndex || 0;
        const phase = data.currentPhase || 'idle';

        scriptCard.style.display = 'block';
        scriptTitle.textContent = `🎬 ${script.title || 'ไม่มีชื่อ'}`;
        sceneBadge.textContent = `${script.scenes.length} ซีน`;

        sceneList.innerHTML = '';
        script.scenes.forEach((scene, i) => {
            const sn = scene.sceneNumber || (i + 1);
            const isActive = i === currentIdx;
            const isDone = i < currentIdx;

            const card = document.createElement('div');
            card.className = 'scene-card' +
                (isActive ? ' active' : '') +
                (isDone ? ' done' : '');

            // Status icon
            let statusIcon = '⏳';
            let statusText = 'รอ';
            if (isDone) {
                statusIcon = '✅';
                statusText = 'เสร็จ';
            } else if (isActive) {
                statusIcon = phase === 'image' ? '🎨' : '🎬';
                statusText = phase === 'image' ? 'สร้างภาพ' : 'สร้างวิดีโอ';
            }

            card.innerHTML = `
                <div class="scene-header">
                    <span class="scene-number">ซีน ${sn}</span>
                    <span class="scene-status ${isDone ? 'done' : isActive ? 'active' : ''}">${statusIcon} ${statusText}</span>
                </div>
                <div class="scene-body">
                    <div class="scene-field">
                        <span class="field-label">🎨 Image Prompt</span>
                        <span class="field-value">${truncate(scene.imagePromptEN || scene.imagePromptTH || '-', 120)}</span>
                    </div>
                    <div class="scene-field">
                        <span class="field-label">🎬 Video Prompt</span>
                        <span class="field-value">${truncate(scene.videoPromptEN || scene.videoPromptTH || '-', 120)}</span>
                    </div>
                    <div class="scene-field">
                        <span class="field-label">💬 บทพูด</span>
                        <span class="field-value dialogue">${scene.dialogue || '-'}</span>
                    </div>
                </div>
            `;

            // Toggle expand/collapse
            const header = card.querySelector('.scene-header');
            const body = card.querySelector('.scene-body');
            if (!isActive) body.style.display = 'none';
            header.addEventListener('click', () => {
                body.style.display = body.style.display === 'none' ? 'block' : 'none';
            });

            sceneList.appendChild(card);
        });
    });
}

function truncate(text, max) {
    if (!text) return '-';
    return text.length > max ? text.substring(0, max) + '...' : text;
}

// ===== Copy Script JSON =====
copyScriptBtn.addEventListener('click', () => {
    chrome.storage.local.get(['currentScript'], (data) => {
        if (data.currentScript) {
            const json = JSON.stringify(data.currentScript, null, 2);
            navigator.clipboard.writeText(json).then(() => {
                copyScriptBtn.textContent = '✅ คัดลอกแล้ว!';
                setTimeout(() => { copyScriptBtn.textContent = '📋 คัดลอก JSON'; }, 2000);
            });
        }
    });
});

// ===== Retry Flow =====
retryFlowBtn.addEventListener('click', () => {
    chrome.storage.local.get(['currentScript'], (data) => {
        if (data.currentScript) {
            // Reset scene index → re-trigger Flow
            chrome.storage.local.set({ currentSceneIndex: 0, currentPhase: 'image' });
            chrome.runtime.sendMessage({
                type: 'SCRIPT_READY',
                script: data.currentScript
            });
            retryFlowBtn.textContent = '✅ เปิดใหม่แล้ว!';
            setTimeout(() => { retryFlowBtn.textContent = '🔄 เปิด Flow ใหม่'; }, 2000);
        }
    });
});

// ===== Load logs =====
async function loadLogs() {
    chrome.runtime.sendMessage({ type: 'GET_LOGS' }, (logs) => {
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

        logList.scrollTop = 0;
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

    chrome.storage.local.get(['geminiApiKey', 'gemUrl'], (settings) => {
        chrome.storage.local.clear(() => {
            if (settings.geminiApiKey) chrome.storage.local.set({ geminiApiKey: settings.geminiApiKey });
            if (settings.gemUrl) chrome.storage.local.set({ gemUrl: settings.gemUrl });
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
    statusDot.className = 'status-dot idle';
    scriptCard.style.display = 'none';
    logList.innerHTML = '<div class="log-empty">เคลียร์แล้ว ✅</div>';
    stopBtn.textContent = '✅ เคลียร์แล้ว!';

    setTimeout(() => {
        stopBtn.textContent = '🛑 หยุด & เคลียร์ทุกอย่าง';
        stopBtn.disabled = false;
    }, 2000);
});

// ===== Init =====
loadStatus();
loadLogs();
loadScript();

// Auto refresh ทุก 3 วินาที
setInterval(() => {
    loadStatus();
    loadLogs();
    loadScript();
}, 3000);
