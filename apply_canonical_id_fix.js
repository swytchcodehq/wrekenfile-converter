const fs = require('fs');

function applyCanonicalIdFix() {
    const file = 'src/v2/utils/canonical-id.ts';
    let content = fs.readFileSync(file, 'utf8');

    // 1. Expand STANDARD_VERBS
    content = content.replace(
        /const STANDARD_VERBS = new Set\(\[\s*([\s\S]*?)\s*\]\);/,
        `const STANDARD_VERBS = new Set([\n  $1,\n  'cancel',\n  'refund',\n  'suspend',\n  'approve',\n  'reject',\n  'start',\n  'stop',\n  'pause',\n  'resume',\n]);`
    );

    // 2. computeCanonicalId definition
    content = content.replace(
        /export function computeCanonicalId\(httpMethod: string, path: string\): string \{/,
        'export function computeCanonicalId(libraryName: string, httpMethod: string, path: string): string {'
    );
    content = content.replace(
        /const namespace = segments\[0\]\.toLowerCase\(\);/,
        "const namespace = libraryName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'api';"
    );

    // 3. resolveCanonicalIds definition
    content = content.replace(
        /export function resolveCanonicalIds\(\s*methods: MethodCanonicalInput\[\]\s*\): Map<string, string> \{/,
        'export function resolveCanonicalIds(\n  methods: MethodCanonicalInput[],\n  libraryName: string\n): Map<string, string> {'
    );
    
    // 4. Update the fallback logic and remove hashes in resolveCanonicalIds
    // This is tricky via regex, so let's just do a string replacement for the chunks:
    content = content.replace(
        /const baseId = computeCanonicalId\(m\.httpMethod, m\.endpoint\);/,
        'const baseId = computeCanonicalId(libraryName, m.httpMethod, m.endpoint);'
    );
    content = content.replace(
        /const baseId = fallback \|\| 'sdk\.method\.' \+ shortHash\(m\.methodId\);\n\s*let cid = baseId;\n\s*if \(\!tryAssign\(m\.methodId, cid\)\) cid = baseId \+ '_' \+ shortHash\(m\.methodId\);\n\s*result\.set\(m\.methodId, cid\);/g,
        `const namespace = libraryName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'sdk';
      const baseId = fallback || \`\${namespace}.method\`;
      let cid = baseId;
      if (!tryAssign(m.methodId, cid)) {
          pending.push({ methodId: m.methodId, httpMethod: m.httpMethod || 'GET', endpoint: m.endpoint || '', baseId });
      } else {
          result.set(m.methodId, cid);
      }`
    );
    
    // replace shortHash collision loop with attempts loop
    content = content.replace(
        /let candidate = p\.baseId \+ '_' \+ shortHash\(p\.endpoint \+ p\.methodId\);\n\s*let finalCandidate = candidate;\n\s*let attempts = 0;\n\s*while \(\!tryAssign\(p\.methodId, finalCandidate\) && attempts < 10\) \{\n\s*finalCandidate = p\.baseId \+ '_' \+ shortHash\(p\.endpoint \+ p\.methodId \+ attempts\.toString\(\)\);\n\s*attempts\+\+;\n\s*\}/,
        `let finalCandidate = p.baseId;
    let attempts = 1;
    while (!tryAssign(p.methodId, finalCandidate) && attempts < 100) {
      finalCandidate = \`\${p.baseId}.\${attempts}\`;
      attempts++;
    }`
    );

    // replace duplicate uniqueness fallback
    content = content.replace(
        /const uniqueId = canonicalId \+ '_' \+ shortHash\(methodId\);\n\s*result\.set\(methodId, uniqueId\);/,
        `let uniqueId = canonicalId;
      let counter = 1;
      while(seen.has(uniqueId) && seen.get(uniqueId) !== methodId) {
          uniqueId = \`\${canonicalId}.fallback\${counter}\`;
          counter++;
      }
      seen.set(uniqueId, methodId);
      result.set(methodId, uniqueId);`
    );

    fs.writeFileSync(file, content);
}

function updateGenerators() {
    ['src/v2/openapi-to-wreken.ts', 'src/v2/openapi-v2-to-wrekenfile.ts', 'src/v2/postman-to-wrekenfile.ts'].forEach(file => {
        let content = fs.readFileSync(file, 'utf8');
        
        // computeCanonicalId calls in generateStructName
        content = content.replace(
            /const canonicalId = computeCanonicalId\(method\.toUpperCase\(\), path\);/g,
            "const canonicalId = computeCanonicalId('api', method.toUpperCase(), path);"
        );
        
        // resolveCanonicalIds in generateWrekenfile
        if (file.includes('postman')) {
            content = content.replace(
                /const canonicalIdMap = resolveCanonicalIds\(canonicalInputs\);/g,
                "const libraryName = collection?.info?.name || 'unknown';\n    const canonicalIdMap = resolveCanonicalIds(canonicalInputs, libraryName);"
            );
        } else {
            content = content.replace(
                /const canonicalIdMap = resolveCanonicalIds\(canonicalInputs\);/g,
                "const libraryName = spec?.info?.title || 'unknown';\n    const canonicalIdMap = resolveCanonicalIds(canonicalInputs, libraryName);"
            );
        }
        
        fs.writeFileSync(file, content);
    });
}

applyCanonicalIdFix();
updateGenerators();
