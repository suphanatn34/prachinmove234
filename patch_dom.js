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
        // find variable name
        const varMatch = new RegExp('const\\\\s+([a-zA-Z0-9_]+)\\\\s*=\\\\s*document\\\\.getElementById\\\\(\\\'' + id + '\\\'\\\\);').exec(src);
        if (varMatch) {
            missingVars.add(varMatch[1]);
        } else {
             missingVars.add(id); // direct usage sometimes
        }
    }
}

console.log('Found ' + missingVars.size + ' missing variables.');

// Replace dangerous property accesses
missingVars.forEach(v => {
    // Exact assignments: `v.property = value` -> `if (v) v.property = value`
    const props = ['textContent', 'innerHTML', 'className', 'value', 'src', 'disabled'];
    props.forEach(prop => {
        const regex = new RegExp('^(\\s*)(' + v + '\\.' + prop + '\\s*=)', 'gm');
        src = src.replace(regex, '$1if (' + v + ') $2');
    });

    // Style assignments: `v.style.property = value`
    const regexStyle = new RegExp('^(\\s*)(' + v + '\\.style\\.[a-zA-Z]+\\s*=)', 'gm');
    src = src.replace(regexStyle, '$1if (' + v + ') $2');

    // Method calls: `v.appendChild(...)`
    const regexMethod = new RegExp('^(\\s*)(' + v + '\\.appendChild\\()', 'gm');
    src = src.replace(regexMethod, '$1if (' + v + ') $2');
    
    // classList calls: `v.classList.add(...)`
    const regexClassList = new RegExp('^(\\s*)(' + v + '\\.classList\\.(add|remove|toggle)\\()', 'gm');
    src = src.replace(regexClassList, '$1if (' + v + ') $2');
});

fs.writeFileSync('sidepanel.js', src);
console.log('Patch complete.');
