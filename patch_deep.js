const fs = require('fs');

let src = fs.readFileSync('sidepanel.js', 'utf8');

src = src.replace(/copyCharBtn\.addEventListener/g, 'if(copyCharBtn) copyCharBtn.addEventListener');
src = src.replace(/copyCharBtn\.textContent/g, 'if(copyCharBtn) copyCharBtn.textContent');
src = src.replace(/toggleCollectionBtn\?\.addEventListener/g, 'if(toggleCollectionBtn) toggleCollectionBtn.addEventListener');
src = src.replace(/collectionNames\.value/g, '(collectionNames ? collectionNames.value : "")');
src = src.replace(/collectionBody\.style/g, '(collectionBody ? collectionBody.style : {})');

fs.writeFileSync('sidepanel.js', src);
console.log('Final 4 deep null references patched successfully!');
