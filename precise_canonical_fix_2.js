const fs = require('fs');

let content = fs.readFileSync('src/v2/utils/canonical-id.ts', 'utf8');

// Fix unused actionSegmentToCamel (just remove it)
content = content.replace(/\/\*\* Verb-first form for compound actions[\s\S]*?function actionSegmentToCamel[\s\S]*?\}\n/, '');

// Fix unused verb in extractSubresource
content = content.replace(/function extractSubresource\(remaining: string\[\], verb: string\)/, 'function extractSubresource(remaining: string[], _verb: string)');

fs.writeFileSync('src/v2/utils/canonical-id.ts', content);
