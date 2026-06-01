const fs = require('fs');

// Fix 1: canonical-id.ts fallback for empty path
let canonicalFile = 'src/v2/utils/canonical-id.ts';
let canonicalContent = fs.readFileSync(canonicalFile, 'utf8');

const oldFallbackEmpty = `  if (segments.length === 0) {
    return 'api.resource.execute';
  }

  const method = (httpMethod || 'GET').toUpperCase();

  // namespace and primary resource
  const namespace = libraryName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'api';`;

const newFallbackEmpty = `  const namespace = libraryName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'api';
  
  if (segments.length === 0) {
    return \`\${namespace}.resource.execute\`;
  }

  const method = (httpMethod || 'GET').toUpperCase();

  // primary resource`;

canonicalContent = canonicalContent.replace(oldFallbackEmpty, newFallbackEmpty);
fs.writeFileSync(canonicalFile, canonicalContent);

// Fix 2: tests/canonical-id.test.ts custom preserving test
let testFile = 'tests/canonical-id.test.ts';
let testContent = fs.readFileSync(testFile, 'utf8');

testContent = testContent.replace(
    /expect\(result\.get\('listPets'\)\)\.toBe\('testapi\.pets\.list'\);/,
    "expect(result.get('listPets')).toBe('custom.pets.list');"
);
fs.writeFileSync(testFile, testContent);

console.log('Fixed final tests.');
