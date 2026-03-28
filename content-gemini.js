// ============================================
// Content Script — Gemini Gem Automation (Smart Hybrid v4)
// เปิดเว็บ Gem → inject รูป → พิมพ์ prompt → กดส่ง → รอ response → ส่งให้ API parse
// ============================================

(async function () {
    console.log('[Gemini] Smart content script loaded');
    await sleep(5000);

    const data = await chrome.storage.local.get(['pendingPrompt', 'pendingImage', 'waitingForScript']);

    if (!data.waitingForScript || !data.pendingPrompt) {
        console.log('[Gemini] No pending prompt');
        return;
    }

    const prompt = data.pendingPrompt;
    const hasImage = !!data.pendingImage;

    console.log('[Gemini] Got prompt, has image:', hasImage);
    await chrome.storage.local.remove(['pendingPrompt', 'waitingForScript']);

    // ===== ถ้ามีรูป → รอ inject เสร็จ + ลอง Ctrl+V =====
    if (hasImage) {
        console.log('[Gemini] Waiting for image inject...');
        await sleep(6000);

        // ลอง Ctrl+V เพื่อ paste จาก clipboard
        const editor = findEditor();
        if (editor) {
            editor.focus();
            document.execCommand('paste');
            console.log('[Gemini] Tried paste command');
            await sleep(3000);
        }
    }

    // ===== พิมพ์ prompt =====
    let inputEl = null;
    for (let i = 0; i < 20; i++) {
        inputEl = findEditor();
        if (inputEl) break;
        await sleep(1000);
    }

    if (!inputEl) {
        console.error('[Gemini] Cannot find input field!');
        return;
    }

    console.log('[Gemini] Typing prompt...');
    inputEl.focus();
    await sleep(500);

    // ใช้ insertText — ทำงานกับ editor ได้ดี
    document.execCommand('insertText', false, prompt);
    await sleep(1500);

    // ===== กดส่ง =====
    let sendBtn = null;
    for (let i = 0; i < 15; i++) {
        sendBtn = document.querySelector('button.send-button')
            || document.querySelector('button[aria-label="Send message"]')
            || document.querySelector('button[aria-label*="Send"]')
            || document.querySelector('button[aria-label*="send"]');

        // ลองหาปุ่มที่มี icon arrow
        if (!sendBtn) {
            for (const btn of document.querySelectorAll('button')) {
                const t = (btn.textContent || '').trim().toLowerCase();
                if (t.includes('send') || t.includes('arrow_upward')) {
                    sendBtn = btn;
                    break;
                }
            }
        }

        if (sendBtn && !sendBtn.disabled) break;
        sendBtn = null;
        await sleep(500);
    }

    if (sendBtn) {
        sendBtn.click();
        console.log('[Gemini] ✅ Prompt sent!');
    } else {
        // Fallback: กด Enter
        console.log('[Gemini] Send button not found, trying Enter...');
        if (inputEl) {
            inputEl.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
            }));
        }
    }

    // ===== รอ response =====
    console.log('[Gemini] Waiting for response...');
    let responseText = null;

    // วนรอจนได้ response (max 90 วินาที)
    for (let sec = 0; sec < 90; sec++) {
        await sleep(1000);

        // ตรวจว่า Gem ยังกำลังพิมพ์อยู่ไหม
        const isTyping = checkIfTyping();
        if (sec > 10 && !isTyping) {
            // หยุดพิมพ์แล้ว → ลองอ่าน response
            const text = getLatestResponse();
            if (text && text.length > 50) {
                responseText = text;
                console.log('[Gemini] Got response at', sec, 'sec, length:', text.length);
                // รอเพิ่มอีก 3 วินาทีให้แน่ใจว่าเสร็จ
                await sleep(3000);
                responseText = getLatestResponse();
                break;
            }
        }

        if (sec > 0 && sec % 15 === 0) {
            console.log('[Gemini] Still waiting...', sec, 's');
        }
    }

    if (!responseText) {
        // สุดท้าย ลองอ่านอีกครั้ง
        responseText = getLatestResponse();
    }

    if (!responseText) {
        console.error('[Gemini] No response found after 90s');
        return;
    }

    console.log('[Gemini] Final response length:', responseText.length);

    // ===== ส่ง raw response ให้ background → API ช่วย parse =====
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'GEM_RAW_RESPONSE',
            text: responseText
        });

        if (result && result.success) {
            console.log('[Gemini] ✅ Script parsed by API:', result.script?.title);
            // ส่ง SCRIPT_READY เพื่อให้ background เปิด Flow
            chrome.runtime.sendMessage({
                type: 'SCRIPT_READY',
                script: result.script
            });
        } else {
            console.log('[Gemini] ❌ API parse failed:', result?.error);
            // Fallback: ลอง parse เองแบบเดิม
            const localScript = tryLocalParse(responseText);
            if (localScript && localScript.scenes) {
                chrome.runtime.sendMessage({
                    type: 'SCRIPT_READY',
                    script: localScript
                });
            }
        }
    } catch (err) {
        console.error('[Gemini] Error sending to background:', err.message);
    }
})();


// ===== Helper Functions =====

function findEditor() {
    return document.querySelector('.ql-editor.textarea')
        || document.querySelector('.ql-editor[contenteditable="true"]')
        || document.querySelector('div[role="textbox"][contenteditable="true"]')
        || document.querySelector('[aria-label*="prompt" i][contenteditable="true"]')
        || document.querySelector('[aria-label*="Prompt" i]')
        || document.querySelector('rich-textarea .ql-editor');
}

function checkIfTyping() {
    // ตรวจว่ามี typing indicator หรือ loading spinner
    const indicators = document.querySelectorAll(
        '[class*="loading"], [class*="typing"], [class*="generating"], [class*="spinner"], .model-response-text'
    );
    for (const el of indicators) {
        const style = getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
            return true;
        }
    }

    // ตรวจ animation ที่กำลังแสดง
    const dots = document.querySelectorAll('[class*="dot"], [class*="pulse"]');
    for (const dot of dots) {
        if (dot.getBoundingClientRect().width > 0) return true;
    }

    return false;
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
