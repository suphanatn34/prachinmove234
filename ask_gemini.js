const { execSync } = require('child_process');
const fs = require('fs');

const js = fs.readFileSync('sidepanel.js', 'utf8');
const html = fs.readFileSync('sidepanel.html', 'utf8');

const prompt = `ฉันเป็น AI agent และนี่คือโค้ดเต็มของ sidepanel.js และ sidepanel.html 
ปัจจุบันผู้ใช้ลบ UI ออกไปเยอะ ทำให้มีตัวแปร DOM หลายตัวเป็น null 
ฉันเขียนสคริปต์เติม if (varName) กันไว้เยอะแล้ว
รบกวนช่วยหาว่ายังมีจุดไหนใน sidepanel.js (บรรทัดหรือส่วนไหน) 
ที่จะพังเพราะ null reference อีกไหม (เช่น การอ้าง property ซ้อนๆ กัน หรือเมธอดคอล)
ตอบสั้นๆ ชี้เป้าบรรทัดที่เสี่ยงพังที่สุด

HTML:
${html}

JS:
${js}`;

fs.writeFileSync('prompt.txt', prompt);
console.log('Sending to Gemini CLI...');

try {
    const output = execSync('gemini -p "$(cat prompt.txt)"', { encoding: 'utf8' });
    console.log('\n--- GEMINI CLI ANALYSIS ---');
    console.log(output);
} catch (e) {
    console.log('Failed to run gemini cli', e.message);
}
