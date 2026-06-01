const fs = require('fs');

let content = fs.readFileSync('tests/canonical-id.test.ts', 'utf8');

// Update expect assertions for computeCanonicalId
// We replace expect(id).toBe('something.xyz') with expect(id).toBe('testapi.xyz')
// because 'testapi' is now the namespace (from libraryName)
content = content.replace(/expect\(id\)\.toBe\(['`"]([a-zA-Z0-9_-]+)\.([^'"`]+)['`"]\);/g, "expect(id).toBe('testapi.$2');");

// Update expect assertions for resolveCanonicalIds
content = content.replace(/expect\(result\.get\((['`"][^'"`]+['`"])\)\)\.toBe\(['`"]([a-zA-Z0-9_-]+)\.([^'"`]+)['`"]\);/g, "expect(result.get($1)).toBe('testapi.$3');");

// Fallback logic assertion update
content = content.replace(/expect\(result\.get\('sdkMethod'\)\)\.toMatch\(\/\^sdk\\.method\.\/\);/g, "expect(result.get('sdkMethod')).toMatch(/^testapi\\.method/);");
content = content.replace(/expect\(result\.get\('methodWithoutHttp'\)\)\.toBe\('method\.without\.http'\);/g, "expect(result.get('methodWithoutHttp')).toBe('testapi.method');");
content = content.replace(/expect\(result\.get\('method-without-http'\)\)\.toBe\('method\.without\.http'\);/g, "expect(result.get('method-without-http')).toBe('testapi.method');");

// The baseId in the fallback tests should also be checked to see if they were expected to be testapi.method.fallback1 etc.
content = content.replace(/toBe\('testapi\.method\.1'\);/g, "toBe('testapi.method.1');");

fs.writeFileSync('tests/canonical-id.test.ts', content);
