// ============================================
// Content Script — Action Recorder
// บันทึกการคลิก/พิมพ์/วาง/hover บนหน้าเว็บ → ส่ง selector + info กลับ side panel
// ============================================

var recorderActive = false;
var recordedActions = [];
var highlightOverlay = null;
var inputDebounceTimer = null;

// รับคำสั่งจาก side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_RECORDING') {
        startRecording();
        sendResponse({ ok: true });
    }
    if (msg.type === 'STOP_RECORDING') {
        stopRecording();
        sendResponse({ ok: true });
    }
    if (msg.type === 'GET_RECORDING') {
        sendResponse({ actions: recordedActions });
    }
    if (msg.type === 'CLEAR_RECORDING') {
        recordedActions = [];
        sendResponse({ ok: true });
    }
    if (msg.type === 'ADD_ACTION') {
        // Side panel ส่ง action มาเพิ่ม
        if (msg.action) {
            recordedActions.push(msg.action);
            console.log('[Recorder] +SidePanel:', msg.action.type, msg.action.text?.substring(0, 30));
        }
        sendResponse({ ok: true });
    }
    if (msg.type === 'PLAYBACK_ACTIONS') {
        runPlayback(msg.actions).then(() => {
            sendResponse({ ok: true });
        }).catch(err => {
            sendResponse({ error: err.message });
        });
        return true;
    }
});

function startRecording() {
    if (recorderActive) return;
    recorderActive = true;
    recordedActions = [];

    // สร้าง overlay สำหรับ highlight
    createHighlightOverlay();

    // ตั้ง event listeners
    document.addEventListener('click', recHandleClick, true);
    document.addEventListener('mousemove', onRecordHover, true);
    document.addEventListener('contextmenu', recHandleClick, true);
    document.addEventListener('input', recHandleInput, true);
    document.addEventListener('change', recHandleChange, true);
    document.addEventListener('paste', recHandlePaste, true);
    document.addEventListener('focus', recHandleFocus, true);

    console.log('[Recorder] ✅ Recording started (click+type+paste)');
}

function stopRecording() {
    recorderActive = false;
    document.removeEventListener('click', recHandleClick, true);
    document.removeEventListener('mousemove', onRecordHover, true);
    document.removeEventListener('contextmenu', recHandleClick, true);
    document.removeEventListener('input', recHandleInput, true);
    document.removeEventListener('change', recHandleChange, true);
    document.removeEventListener('paste', recHandlePaste, true);
    document.removeEventListener('focus', recHandleFocus, true);

    if (highlightOverlay) {
        highlightOverlay.remove();
        highlightOverlay = null;
    }

    console.log('[Recorder] 🛑 Recording stopped');
}

function recHandleClick(e) {
    if (!recorderActive) return;

    const el = e.target;
    const tag = el.tagName;
    // ข้ามถ้าเป็น input/textarea เพราะมี handler ของมันเอง
    if (e.type === 'click' && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;
    if (el.closest('#genhod-bot-root') || el.closest('#genhod-panel')) return; // Skip recorder's own elements

    const rect = el.getBoundingClientRect();
    const info = getElementInfo(el);

    recordedActions.push({
        type: e.type === 'contextmenu' ? 'right_click' : 'click',
        timestamp: new Date().toLocaleTimeString('th-TH'),
        ...info
    });

    // ส่งเข้า storage ทันที
    chrome.storage.local.set({ recordedActions: recordedActions });

    // แสดง visual feedback
    showClickFeedback(rect);

    console.log('[Recorder] Click:', info.selector, info.text?.substring(0, 30));
}

function recHandleInput(e) {
    if (!recorderActive) return;

    // ใช้ debounce — บันทึกทุก 2 วินาที ไม่ใช่ทุก keystroke
    clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
        const el = e.target;
        const info = getElementInfo(el);

        // ดึงค่าที่พิมพ์
        let value = '';
        if (el.value !== undefined) value = el.value;
        else if (el.textContent) value = el.textContent.trim();

        recordedActions.push({
            type: 'input',
            timestamp: new Date().toLocaleTimeString('th-TH'),
            inputValue: value.substring(0, 200),
            ...info
        });

        chrome.storage.local.set({ recordedActions: recordedActions });
        console.log('[Recorder] Input:', info.selector, '→', value.substring(0, 40));
    }, 2000);
}

function recHandleChange(e) {
    if (!recorderActive) return;

    const el = e.target;
    const info = getElementInfo(el);

    let value = '';
    if (el.value !== undefined) value = el.value;
    else if (el.textContent) value = el.textContent.trim();

    recordedActions.push({
        type: 'change',
        timestamp: new Date().toLocaleTimeString('th-TH'),
        inputValue: value.substring(0, 200),
        ...info
    });

    chrome.storage.local.set({ recordedActions: recordedActions });
    console.log('[Recorder] Change:', info.selector, '→', value.substring(0, 40));
}

function recHandlePaste(e) {
    if (!recorderActive) return;

    const el = e.target;
    const info = getElementInfo(el);
    const pastedText = (e.clipboardData || window.clipboardData)?.getData('text') || '';

    recordedActions.push({
        type: 'paste',
        timestamp: new Date().toLocaleTimeString('th-TH'),
        inputValue: pastedText.substring(0, 300),
        ...info
    });

    chrome.storage.local.set({ recordedActions: recordedActions });
    console.log('[Recorder] Paste:', info.selector, '→', pastedText.substring(0, 50));
}

function recHandleFocus(e) {
    if (!recorderActive) return;

    const el = e.target;
    // เฉพาะ input/textbox
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' ||
        el.getAttribute('role') === 'textbox' ||
        el.getAttribute('contenteditable') === 'true') {

        const info = getElementInfo(el);
        recordedActions.push({
            type: 'focus',
            timestamp: new Date().toLocaleTimeString('th-TH'),
            ...info
        });

        chrome.storage.local.set({ recordedActions: recordedActions });
        console.log('[Recorder] Focus:', info.selector);
    }
}

var hoverDebounceTimer = null;

function onRecordHover(e) {
    if (!recorderActive || !highlightOverlay) return;

    const el = e.target;
    const rect = el.getBoundingClientRect();

    // อัปเดต highlight
    highlightOverlay.style.top = rect.top + 'px';
    highlightOverlay.style.left = rect.left + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
    highlightOverlay.style.display = 'block';

    // แสดง selector ใน label
    const label = highlightOverlay.querySelector('.recorder-label');
    const info = getElementInfo(el);
    if (label) {
        label.textContent = info.selector;
    }

    // --- บันทึกการ Hover (เอาเมาส์แช่ไว้ 1.5 วินาที) ---
    // ป้องกันการยิงถี่เกินไปจนค้าง
    clearTimeout(hoverDebounceTimer);
    hoverDebounceTimer = setTimeout(() => {
        recordedActions.push({
            type: 'hover',
            timestamp: new Date().toLocaleTimeString('th-TH'),
            ...info
        });
        chrome.storage.local.set({ recordedActions: recordedActions });
        console.log('[Recorder] Hover:', info.selector);
        
        // กะพริบสีเพื่อบอกว่าบันทึก hover สำเร็จ
        highlightOverlay.style.background = 'rgba(74, 222, 128, 0.4)';
        highlightOverlay.style.borderColor = '#4ade80';
        setTimeout(() => {
            if (highlightOverlay) {
                highlightOverlay.style.background = 'rgba(255, 107, 53, 0.1)';
                highlightOverlay.style.borderColor = '#ff6b35';
            }
        }, 500);

    }, 1500);
}

/**
 * ดึงข้อมูล element: tag, class, id, role, text, attributes, selector, position
 */
function getElementInfo(el) {
    const rect = el.getBoundingClientRect();

    // สร้าง CSS selector
    let selector = el.tagName.toLowerCase();
    if (el.id) selector += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).slice(0, 3);
        selector += '.' + classes.join('.');
    }
    if (el.getAttribute('role')) selector += `[role="${el.getAttribute('role')}"]`;

    // Unique selector path
    const uniqueSelector = getUniqueSelector(el);

    // Attributes สำคัญ
    const attrs = {};
    for (const attr of ['id', 'class', 'role', 'aria-label', 'contenteditable', 'type', 'placeholder', 'data-action', 'href']) {
        if (el.hasAttribute(attr)) attrs[attr] = el.getAttribute(attr);
    }

    return {
        tag: el.tagName,
        selector: selector,
        uniqueSelector: uniqueSelector,
        text: (el.textContent || '').trim().substring(0, 100),
        attrs: attrs,
        position: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        },
        innerHTML: el.innerHTML?.substring(0, 200) || '',
        parentTag: el.parentElement?.tagName || '',
        parentClass: (el.parentElement?.className || '').substring(0, 60),
        childCount: el.children?.length || 0
    };
}

/**
 * สร้าง unique CSS selector path
 */
function getUniqueSelector(el) {
    const parts = [];
    let current = el;
    let depth = 0;

    while (current && current !== document.body && depth < 5) {
        let part = current.tagName.toLowerCase();

        if (current.id) {
            part = '#' + current.id;
            parts.unshift(part);
            break;
        }

        if (current.getAttribute('role')) {
            part += `[role="${current.getAttribute('role')}"]`;
        }

        // nth-child
        if (current.parentElement) {
            const siblings = [...current.parentElement.children].filter(s => s.tagName === current.tagName);
            if (siblings.length > 1) {
                const idx = siblings.indexOf(current) + 1;
                part += `:nth-of-type(${idx})`;
            }
        }

        parts.unshift(part);
        current = current.parentElement;
        depth++;
    }

    return parts.join(' > ');
}

// === Visual Feedback ===

function createHighlightOverlay() {
    if (highlightOverlay) return;

    highlightOverlay = document.createElement('div');
    highlightOverlay.id = '__recorder_highlight__';
    highlightOverlay.style.cssText = `
        position: fixed; z-index: 2147483646;
        pointer-events: none;
        border: 2px solid #ff6b35;
        background: rgba(255, 107, 53, 0.1);
        border-radius: 4px;
        transition: all 0.1s ease;
        display: none;
    `;

    const label = document.createElement('div');
    label.className = 'recorder-label';
    label.style.cssText = `
        position: absolute; bottom: -22px; left: 0;
        background: #ff6b35; color: white;
        font-size: 11px; padding: 2px 6px;
        border-radius: 3px; white-space: nowrap;
        font-family: monospace; max-width: 400px;
        overflow: hidden; text-overflow: ellipsis;
    `;
    highlightOverlay.appendChild(label);

    document.body.appendChild(highlightOverlay);
}

function showClickFeedback(rect) {
    const dot = document.createElement('div');
    dot.style.cssText = `
        position: fixed; z-index: 2147483647;
        left: ${rect.x + rect.width / 2 - 10}px;
        top: ${rect.y + rect.height / 2 - 10}px;
        width: 20px; height: 20px;
        background: #ff6b35; border-radius: 50%;
        opacity: 0.8; pointer-events: none;
        animation: recorderPulse 0.6s ease-out forwards;
    `;

    // Add animation keyframes
    if (!document.getElementById('__recorder_style__')) {
        const style = document.createElement('style');
        style.id = '__recorder_style__';
        style.textContent = `
            @keyframes recorderPulse {
                0% { transform: scale(1); opacity: 0.8; }
                100% { transform: scale(3); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 600);
}

// ============================================
// Playback Engine (ทดสอบรันสคริปต์)
// ============================================
async function runPlayback(actions) {
    if (!actions || actions.length === 0) return;
    
    console.log('[Recorder] ▶️ Starting Playback:', actions.length, 'steps');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        console.log(`[Playback] Step ${i+1}/${actions.length}:`, action.type, action.selector);
        
        let el = null;
        if (action.selector) {
            try { el = document.querySelector(action.selector); } catch(e) {}
        }
        
        if (!el && action.text) {
            const all = document.querySelectorAll('*');
            for (const n of all) {
                if (n.children.length === 0 && (n.textContent||'').trim() === action.text) {
                    el = n; break;
                }
            }
        }
        
        if (!el) {
            console.log(`[Playback] ⚠️ Step ${i+1} failed: Element not found.`);
            alert(`⚠️ หาปุ่ม/กล่อง ไม่เจอใน Step ${i+1}:\n${action.selector || action.text}`);
            continue;
        }

        // Highlight ก่อนกด
        const oldOutline = el.style.outline;
        const oldBoxShadow = el.style.boxShadow;
        el.style.outline = '4px solid #f59e0b';
        el.style.boxShadow = '0 0 15px #f59e0b';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(1500); 
        
        if (action.type === 'click' || action.type === 'right_click') {
            el.style.outline = '4px solid #10b981';
            el.style.boxShadow = '0 0 15px #10b981';
            const rect = el.getBoundingClientRect();
            const x = rect.x + rect.width/2, y = rect.y + rect.height/2;
            const buttonCode = action.type === 'right_click' ? 2 : 0;
            const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: buttonCode };
            el.dispatchEvent(new PointerEvent('pointerdown', o));
            el.dispatchEvent(new MouseEvent('mousedown', o));
            el.dispatchEvent(new PointerEvent('pointerup', o));
            el.dispatchEvent(new MouseEvent('mouseup', o));
            if (action.type === 'right_click') {
                el.dispatchEvent(new MouseEvent('contextmenu', o));
            } else {
                el.dispatchEvent(new MouseEvent('click', o));
            }
            el.focus();
            console.log(`[Playback] ✅ ${action.type === 'right_click' ? 'Right-' : ''}Clicked Step ${i+1}`);
        } else if (action.type === 'input' || action.type === 'change' || action.type === 'paste') {
            el.style.outline = '4px solid #3b82f6';
            el.style.boxShadow = '0 0 15px #3b82f6';
            el.focus();
            const text = action.inputValue || action.text || 'test';
            
            if (el.isContentEditable) {
                el.innerText = text;
            } else {
                el.value = text;
            }
            
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`[Playback] ✅ Typed Step ${i+1}: ${text.substring(0,20)}`);
        } else if (action.type === 'hover') {
            el.style.outline = '4px dotted #c084fc';
            el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); 
            el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
            console.log(`[Playback] ✅ Hover Step ${i+1}`);
        }
        
        await sleep(1000);
        el.style.outline = oldOutline;
        el.style.boxShadow = oldBoxShadow;
        await sleep(800);
    }
    console.log('[Recorder] ⏹️ Playback finished!');
    alert('✅ ทดสอบสคริปต์เสร็จสิ้น!');
}
