const fs = require('fs');

let content = fs.readFileSync('src/v2/utils/canonical-id.ts', 'utf8');

// Fix shortHash
content = content.replace(/\/\*\*\s*\*\s*Create a short deterministic hash[\s\S]*?function shortHash\([\s\S]*?\}\n/g, '');

// Fix verb typing issue if needed
content = content.replace(/foundVerbs\.push\(verb\);/g, 'foundVerbs.push(verb as string);');

fs.writeFileSync('src/v2/utils/canonical-id.ts', content);
