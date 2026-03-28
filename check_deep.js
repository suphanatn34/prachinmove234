const fs = require('fs');
let src = fs.readFileSync('sidepanel.js', 'utf8');
const html = fs.readFileSync('sidepanel.html', 'utf8');

const idRegex = /document\.getElementById\('([^']+)'\)/g;
let match;
const missingVars = new Set();
const allIds = new Set();

while ((match = idRegex.exec(src)) !== null) {
    const id = match[1];
    allIds.add(id);
    if (!html.includes('id="' + id + '"')) {
        const varMatch = new RegExp('const\\\\s+([a-zA-Z0-9_]+)\\\\s*=\\\\s*document\\\\.getElementById\\\\(\\\'' + id + '\\\'\\\\);').exec(src);
        if (varMatch) {
            missingVars.add(varMatch[1]);
        } else {
             missingVars.add(id);
        }
    }
}

console.log('Checking deeper property accesses for 69 missing vars...');
let foundDeep = false;
let foundAny = false;

missingVars.forEach(v => {
    // Check for `var.prop.prop` or similar unprotected accesses
    // We patched `.property = ` but what about `.property` access (e.g. var.value.trim())?
    const accessRegex = new RegExp('[^a-zA-Z0-9_.](' + v + '\\.[a-zA-Z0-9_]+(\\.[a-zA-Z0-9_\\(\\)]+)?)', 'g');
    let am;
    while ((am = accessRegex.exec(src)) !== null) {
        // Did we protect it? Check if we wrapped it in 'if (' + v + ') '
        const lineStart = Math.max(0, am.index - 50);
        const context = src.substring(lineStart, am.index + 20).replace(/\n/g, ' ');
        if (!context.includes('if (' + v + ')') && !context.includes('if(' + v + ')') && !context.includes(v + ' &&') && !context.includes(v + '?.')) {
            console.log('UNPROTECTED ACCESS: ' + am[1]);
            foundAny = true;
        }
    }
});

if (!foundAny) {
    console.log('All accesses seem protected or we missed them.');
}
