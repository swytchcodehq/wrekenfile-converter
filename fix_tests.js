const fs = require('fs');

let content = fs.readFileSync('tests/canonical-id.test.ts', 'utf8');

// Fix computeCanonicalId tests
content = content.replace(/computeCanonicalId\((['`"])(.*?)\1,\s*(['`"])(.*?)\3\)/g, "computeCanonicalId('testapi', $1$2$1, $3$4$3)");

// Fix resolveCanonicalIds tests
content = content.replace(/resolveCanonicalIds\(\[\n([\s\S]*?)\]\)/g, "resolveCanonicalIds([\n$1], 'testapi')");

fs.writeFileSync('tests/canonical-id.test.ts', content);
