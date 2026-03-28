const fs = require('fs');

const src = fs.readFileSync('sidepanel.js', 'utf8');
const html = fs.readFileSync('sidepanel.html', 'utf8');

const idRegex = /document\.getElementById\('([^']+)'\)/g;
let match;
let missingCount = 0;

while ((match = idRegex.exec(src)) !== null) {
    const id = match[1];
    if (!html.includes('id="' + id + '"')) {
        console.log('Missing DOM ID in HTML:', id);
        missingCount++;
    }
}

if (missingCount === 0) {
    console.log('All element IDs found in HTML.');
} else {
    console.log('Total missing:', missingCount);
}
