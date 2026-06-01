const fs = require('fs');

function fixFile(file) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Fix generateStructName to use 'api'
    content = content.replace(
        /const canonicalId = computeCanonicalId\(method\.toUpperCase\(\), path\);/g,
        "const canonicalId = computeCanonicalId('api', method.toUpperCase(), path);"
    );
    
    // Fix generateWrekenfile to pass libraryName
    content = content.replace(
        /const canonicalIdMap = resolveCanonicalIds\(canonicalInputs\);/g,
        "const libraryName = spec?.info?.title || (typeof collection !== 'undefined' ? collection?.info?.name : undefined) || 'unknown';\n    const canonicalIdMap = resolveCanonicalIds(canonicalInputs, libraryName);"
    );
    
    fs.writeFileSync(file, content);
}

['src/v2/openapi-to-wreken.ts', 'src/v2/openapi-v2-to-wrekenfile.ts', 'src/v2/postman-to-wrekenfile.ts'].forEach(fixFile);
console.log('Fixes applied.');
