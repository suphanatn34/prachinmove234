// ============================================
// Gemini API Helper — ผู้ช่วยอัจฉริยะ
// ใช้ API ช่วย: วิเคราะห์รูป, สร้าง prompt, แก้ JSON, validate script
// ============================================

// ลองหลาย model ถ้าตัวแรก quota เต็ม
const HELPER_MODELS = [
    "gemini-2.5-flash"
];

function getHelperUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

/**
 * อ่าน API key จาก chrome.storage
 */
const DEFAULT_API_KEY = "AIzaSyD8pOcXMy6LDX_RnkBHyxdUFFJz6iU5qx0";

async function getApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['geminiApiKey'], (data) => {
            resolve(data.geminiApiKey || DEFAULT_API_KEY);
        });
    });
}

/**
 * เรียก Gemini API พร้อม retry + model fallback
 */
async function callGeminiAPI(requestBody) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        throw new Error('ยังไม่ได้ตั้งค่า API key! กรุณาตั้งค่าใน popup');
    }

    let lastError = null;
    for (const model of HELPER_MODELS) {
        const url = getHelperUrl(model, apiKey);
        console.log(`[Helper] Trying: ${model}`);

        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                if (response.status === 429) {
                    const waitSec = (attempt + 1) * 20; // 20, 40, 60, 80, 100 วินาที
                    lastError = `${model}: rate limited (429)`;
                    console.log(`[Helper] Rate limited (${model}), waiting ${waitSec}s... (attempt ${attempt+1}/5)`);
                    await new Promise(r => setTimeout(r, waitSec * 1000));
                    continue;
                }

                if (!response.ok) {
                    const err = await response.text();
                    lastError = `${model}: ${response.status}`;
                    console.log(`[Helper] Error:`, err.substring(0, 200));
                    break;
                }

                const data = await response.json();
                const parts = data.candidates?.[0]?.content?.parts;
                if (parts && parts.length > 0) {
                    for (let i = parts.length - 1; i >= 0; i--) {
                        if (parts[i].text) return parts[i].text;
                    }
                }

                lastError = `${model}: empty response`;
                break;

            } catch (err) {
                lastError = err.message;
                console.log(`[Helper] Attempt ${attempt + 1} failed:`, err.message);
            }
        }
    }

    throw new Error(`API failed: ${lastError}`);
}


// ======================================================
// 1. วิเคราะห์รูปสินค้า
// ======================================================

/**
 * ใช้ API ดูรูปสินค้า → สรุปจุดเด่น/ลักษณะ
 * @param {string} imageBase64 - รูป base64 (data:image/...)
 * @returns {string} คำอธิบายสินค้าจากรูป
 */
async function analyzeProductImage(imageBase64) {
    try {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

        const result = await callGeminiAPI({
            contents: [{
                parts: [
                    {
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: base64Data
                        }
                    },
                    {
                        text: `ดูรูปสินค้านี้แล้วสรุปให้สั้น (2-3 บรรทัด):
1. สินค้าคืออะไร
2. สี/ลักษณะ/ขนาดโดยประมาณ
3. จุดเด่นที่เห็นจากรูป
ตอบเป็นภาษาไทย กระชับ`
                    }
                ]
            }],
            generationConfig: { temperature: 0.3 }
        });

        console.log('[Helper] ✅ Image analysis:', result.substring(0, 100));
        return result;

    } catch (err) {
        console.log('[Helper] ⚠️ Image analysis failed:', err.message);
        return null;
    }
}


// ======================================================
// 2. สร้าง Prompt ที่ดีขึ้น
// ======================================================

/**
 * สร้าง prompt สำหรับ Gem โดยรวมข้อมูลจากทุกแหล่ง
 */
function buildSmartPrompt(taskData, imageAnalysis) {
    let prompt = `คุณคือ AI ผู้กำกับวิดีโอระดับมืออาชีพ ที่ถนัดการสร้างสคริปต์สั้นๆ แต่ดึงดูดความสนใจคนดูได้ตั้งแต่ 3 วินาทีแรก
เป้าหมายของวิดีโอ: ${taskData.objective || 'ไม่ระบุ'}
สไตล์การเล่าเรื่อง (Storytelling Style): ${taskData.storyStyle || 'ธรรมดา'}
สไตล์ภาพและงานอาร์ต (Visual Style): ${taskData.visualStyle || 'แล้วแต่เหมาะสม'}
น้ำเสียง/บุคลิกคนพูด/บรรยาย (Voice Tone): ${taskData.voiceTone || 'ปกติ'}
รูปแบบเสียง (Audio Type): ${taskData.audioType || 'ไม่ระบุ'}
มีข้อความประกอบบนจอไหม (Text Overlay): ${taskData.textOverlay ? 'มีข้อความ Pop-up เน้นย้ำคำพูด' : 'ไม่มีข้อความใดๆ บนจอ'}
ฉากหลัง (Background): ${taskData.epicBackground ? 'อลังการงานสร้าง (Epic/Cinematic)' : 'ฉากหลังธรรมดา มินิมอล โฟกัสคน/ของ'}
จำนวนซีนทั้งหมด: ${taskData.numScenes || 4} ซีน ซีนละ 8 วินาที
ขนาดวิดีโอ (Aspect Ratio): ${taskData.aspectRatio || '9:16'}

ข้อมูลโจทย์ (${taskData.objective}):
- หัวข้อ/สินค้า: ${taskData.productName || 'ไม่ระบุ'}
- รายละเอียด/จุดเด่น: ${taskData.features || 'ไม่ระบุ'}
`;

    if (imageAnalysis) {
        prompt += `\n📷 ข้อมูลจากภาพสินค้าจริง (นำไปใช้ให้สอดคล้องกัน): \n${imageAnalysis}\n`;
    }

    if (taskData.characters && taskData.characters.length > 0) {
        prompt += `\nตัวละครในเรื่องที่ผู้ใช้กำหนด (ต้องอิงข้อมูลนี้): \n`;
        taskData.characters.forEach(c => {
           prompt += `- ตัวละคร ${c.index}: ${c.prompt ? c.prompt : 'รูปอัพโหลด (คุณแค่สมมติให้เข้ากับเรื่องไปก่อนได้)'}\n`;
        });
    }

    let isSales = (taskData.objective || '').includes('ขาย');

    // ส่วนตัวละคร: ขึ้นอยู่กับว่าผู้ใช้อัพรูปมาหรือไม่
    if (taskData._hasCharImage) {
        prompt += `
กรุณาเขียนสคริปต์วิดีโอนี้ และพิมพ์ตอบกลับเป็นรูปแบบ JSON โค้ดที่นำไปใช้ในระบบคลิ๊กอัตโนมัติได้ทันที

*** หมายเหตุ: ผู้ใช้อัพโหลดรูปตัวละครมาแล้ว ไม่ต้องออกแบบตัวละคร ***
- characterPrompt ให้ใส่ "user_uploaded" (จะใช้รูปที่ผู้ใช้อัพ)
`;
    } else {
        prompt += `
กรุณาเขียนสคริปต์วิดีโอนี้ และพิมพ์ตอบกลับเป็นรูปแบบ JSON โค้ดที่นำไปใช้ในระบบคลิ๊กอัตโนมัติได้ทันที

*** สำคัญมาก: ต้องออกแบบตัวละครให้เข้ากับสินค้า/เนื้อหา! ***
- characterPrompt = prompt ภาษาอังกฤษสำหรับ AI สร้างรูปตัวละครหลัก
- ต้องออกแบบตัวละครให้เหมาะกับสินค้า/เนื้อหา (เช่น ถ้าขายเสื้อผ้าแฟชั่นต้องเป็นคนแต่งตัวดี, ถ้าขายอาหารต้องเป็นคนดูน่ารัก/อบอุ่น)
- ต้องบรรยายรายละเอียด: เพศ, เชื้อชาติ, อายุ, ทรงผม, เสื้อผ้า, สีหน้า, ท่าทาง
- ตัวอย่าง: "1girl, Thai woman, 25 years old, long black hair, white casual t-shirt, smiling, looking at camera, studio lighting, portrait photo, 9:16 aspect ratio"
`;
    }

    prompt += `
*** ตอบเป็นโครงสร้าง JSON นี้เท่านั้น ห้ามมีคำอธิบายอื่น ***:
{
  "title": "ชื่อคลิปสั้นๆ",
  "totalScenes": ${taskData.numScenes || 4},
  "aspectRatio": "${taskData.aspectRatio || '9:16'}",
  "characterPrompt": "English prompt for AI to generate the main character portrait photo (MUST be detailed: gender, ethnicity, age, hair, clothing, expression, pose, 9:16, high quality, studio lighting)",
  "characters": [
    { "index": 1, "promptEN": "same as characterPrompt above" }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "imagePromptEN": "พ้อมสร้างภาพฉากนี้ภาษาอังกฤษ (ตาม visualStyle และ epicBackground ถ้ามี, ขยายความบรรยากาศ)",
      "videoPromptEN": "พ้อมสร้างวิดีโอภาษาอังกฤษ (บอก camera movement, action) (ถ้ารูปแบบเสียงเป็น Voiceover ให้บอกว่า mouth closed, not speaking ด้วยเพื่อไม่ให้ขยับปาก)",
      "dialogue": "บทพูดภาษาไทย (ถ้าเป็น Voiceover ให้เขียนคำบรรยาย ถ้า Dialogue คือตัวละครพูด กะให้พอดี 8 วิ)",
      "textOverlayTH": "${taskData.textOverlay ? 'คำพูดไฮไลท์สั้นๆ 1-3 คำ เพื่อทำเป็นข้อความบนจอ' : ''}",
      "hasProduct": ${isSales ? 'true/false (ซีนนี้มีตัวสินค้าโผล่มาไหม)' : 'false'}
    }
  ]
}`;

    return prompt;
}


// ======================================================
// 3. แก้/Parse JSON จาก Gem response
// ======================================================

/**
 * รับ response ดิบจาก Gem → ลอง parse เอง → ถ้าไม่ได้ ให้ API ช่วยแก้
 * @param {string} rawText - response text จาก Gem
 * @returns {Object|null} parsed script JSON
 */
async function fixAndParseJSON(rawText) {
    // ลอง parse เองก่อน (เร็ว ไม่เสีย API call)
    const localResult = tryLocalParse(rawText);
    if (localResult && localResult.scenes) {
        console.log('[Helper] ✅ Local parse success');
        return localResult;
    }

    // Parse ไม่ได้ → ให้ API ช่วยแก้
    console.log('[Helper] Local parse failed → asking API to fix...');
    try {
        const result = await callGeminiAPI({
            contents: [{
                parts: [{
                    text: `ข้อความนี้ควรจะเป็น JSON สคริปต์วิดีโอ แต่อาจมีรูปแบบผิด
กรุณาแก้ไขให้เป็น JSON ที่ถูกต้อง โดยมีโครงสร้าง:
{
  "title": "...",
  "totalScenes": 4,
  "aspectRatio": "9:16",
  "characters": [{"index":1, "promptEN":"..."}],
  "scenes": [{"sceneNumber":1, "imagePromptEN":"...", "videoPromptEN":"...", "dialogue":"...", "textOverlayTH":"...", "hasProduct":true}]
}

ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น

ข้อความที่ต้องแก้:
${rawText.substring(0, 4000)}`
                }]
            }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json"
            }
        });

        const fixed = tryLocalParse(result);
        if (fixed && fixed.scenes) {
            console.log('[Helper] ✅ API fixed JSON successfully');
            return fixed;
        }

    } catch (err) {
        console.log('[Helper] ⚠️ API fix failed:', err.message);
    }

    return null;
}

/**
 * ลอง parse JSON จาก text (regex หลายวิธี)
 */
function tryLocalParse(text) {
    if (!text) return null;

    try {
        // วิธี 1: parse ตรงๆ
        return JSON.parse(text.trim());
    } catch (e) { }

    try {
        // วิธี 2: หาใน code block
        const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeMatch) return JSON.parse(codeMatch[1].trim());
    } catch (e) { }

    try {
        // วิธี 3: หา JSON object ที่มี "scenes"
        const jsonMatch = text.match(/\{[\s\S]*"scenes"[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) { }

    return null;
}


// ======================================================
// 4. Validate Script
// ======================================================

/**
 * ตรวจสอบ script ว่าครบถ้วนหรือไม่
 * @returns {{ valid: boolean, errors: string[], script: Object }}
 */
function validateScript(script) {
    const errors = [];

    if (!script) return { valid: false, errors: ['script is null'], script: null };
    if (!script.title) errors.push('ไม่มี title');
    if (!script.scenes || !Array.isArray(script.scenes)) {
        return { valid: false, errors: ['ไม่มี scenes array'], script };
    }
    if (script.scenes.length === 0) errors.push('scenes ว่างเปล่า');

    script.scenes.forEach((scene, i) => {
        const sn = i + 1;
        if (!scene.imagePromptEN) errors.push(`ซีน ${sn}: ไม่มี imagePromptEN`);
        if (!scene.videoPromptEN) errors.push(`ซีน ${sn}: ไม่มี videoPromptEN`);
        if (!scene.dialogue) errors.push(`ซีน ${sn}: ไม่มี dialogue`);
        // เพิ่ม sceneNumber ถ้าไม่มี
        if (!scene.sceneNumber) scene.sceneNumber = sn;
    });

    return {
        valid: errors.length === 0,
        errors,
        script
    };
}


// ======================================================
// 5. ปรับ Prompt สำหรับ Flow
// ======================================================

/**
 * ปรับปรุง image/video prompt สำหรับ Flow ให้ดีขึ้น
 */
async function improveFlowPrompt(originalPrompt, type = 'image') {
    try {
        const instruction = type === 'image'
            ? 'ปรับปรุง prompt สำหรับสร้างภาพให้ละเอียดขึ้น เพิ่มรายละเอียด lighting, camera angle, style ตอบเป็น prompt เดียวภาษาอังกฤษ ไม่ต้องอธิบาย'
            : 'ปรับปรุง prompt สำหรับสร้างวิดีโอ 8 วินาที เพิ่ม camera movement, pacing, visual effects ตอบเป็น prompt เดียวภาษาอังกฤษ ไม่ต้องอธิบาย';

        const result = await callGeminiAPI({
            contents: [{
                parts: [{
                    text: `${instruction}\n\nPrompt เดิม: ${originalPrompt}`
                }]
            }],
            generationConfig: { temperature: 0.7 }
        });

        console.log(`[Helper] ✅ Improved ${type} prompt`);
        return result.trim();

    } catch (err) {
        console.log(`[Helper] ⚠️ Prompt improve failed, using original`);
        return originalPrompt;
    }
}
