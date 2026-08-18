import * as fs from 'fs';
import * as yaml from 'js-yaml';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface WrekenfileStructure {
  VERSION?: string;
  INIT?: {
    DEFAULTS?: any[];
  };
  INTERFACES?: Record<string, any>;
  STRUCTS?: Record<string, any>;
}

function fixWrekenfile(data: WrekenfileStructure): string {
  // Create a clean, properly formatted YAML structure
  const fixedData: any = {};
  
  // Fix VERSION
  if (data.VERSION) {
    fixedData.VERSION = data.VERSION;
  }
  
  // Fix INIT section
  if (data.INIT) {
    fixedData.INIT = {};
    if (data.INIT.DEFAULTS && Array.isArray(data.INIT.DEFAULTS)) {
      fixedData.INIT.DEFAULTS = data.INIT.DEFAULTS.map((defaultValue: any) => {
        if (typeof defaultValue === 'object' && defaultValue !== null) {
          const key = Object.keys(defaultValue)[0];
          const value = defaultValue[key];
          return { [key]: value };
        }
        return defaultValue;
      });
    }
  }
  
  // Fix INTERFACES section
  if (data.INTERFACES) {
    fixedData.INTERFACES = {};
    for (const [interfaceName, interfaceData] of Object.entries(data.INTERFACES)) {
      if (typeof interfaceData === 'object' && interfaceData !== null) {
        fixedData.INTERFACES[interfaceName] = {
          DESC: interfaceData.DESC || '',
          ENDPOINT: interfaceData.ENDPOINT || '',
          VISIBILITY: interfaceData.VISIBILITY || 'PUBLIC',
          HTTP: {
            METHOD: interfaceData.HTTP?.METHOD || 'GET',
            HEADERS: Array.isArray(interfaceData.HTTP?.HEADERS) ? interfaceData.HTTP.HEADERS : [],
            BODYTYPE: interfaceData.HTTP?.BODYTYPE || 'JSON'
          },
          INPUTS: Array.isArray(interfaceData.INPUTS) ? interfaceData.INPUTS : [],
          RETURNS: Array.isArray(interfaceData.RETURNS) ? interfaceData.RETURNS : []
        };
      }
    }
  }
  
  // Fix STRUCTS section
  if (data.STRUCTS) {
    fixedData.STRUCTS = {};
    for (const [structName, structData] of Object.entries(data.STRUCTS)) {
      if (Array.isArray(structData)) {
        fixedData.STRUCTS[structName] = structData.map((field: any) => {
          if (typeof field === 'object' && field !== null) {
            return {
              name: field.name || '',
              type: field.type || 'ANY',
              required: field.required || 'OPTIONAL'
            };
          }
          return field;
        });
      }
    }
  }
  
  // Generate clean YAML with proper formatting
  return yaml.dump(fixedData, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    flowLevel: -1
  });
}

function fixYamlContent(fileContent: string): string {
  // Fix common YAML formatting issues
  let fixedContent = fileContent;
  
  // Fix malformed arrays like "INPUTS: []" that should be "INPUTS:"
  fixedContent = fixedContent.replace(/^(\s*[A-Z_]+:\s*)\[\s*\]\s*$/gm, '$1[]');
  
  // Fix specific malformed INPUTS section
  fixedContent = fixedContent.replace(/^(\s*INPUTS:\s*)\[\s*\]\s*$/gm, '$1[]');
  
  // Fix indentation - normalize to 2 spaces
  fixedContent = fixedContent.replace(/^\s+/gm, (match) => {
    const level = Math.floor(match.length / 2);
    return '  '.repeat(level);
  });
  
  // Fix missing quotes around values that contain special characters
  // But don't quote keys or section headers
  fixedContent = fixedContent.replace(/^(\s*[a-zA-Z_][a-zA-Z0-9_-]*:\s*)([^"'\s][^"\n]*)$/gm, (match, prefix, value) => {
    // Don't quote if it's a section header (no indentation) or if it ends with colon
    if (prefix.trim().endsWith(':') || value.includes(':')) {
      return match;
    }
    
    if (value.includes('{') || value.includes('}') || value.includes('[') || value.includes(']') || value.includes('/')) {
      return `${prefix}"${value}"`;
    }
    return match;
  });
  
  // Fix empty arrays
  fixedContent = fixedContent.replace(/^\s*\[\s*\]\s*$/gm, '[]');
  
  // Fix trailing spaces
  fixedContent = fixedContent.replace(/[ \t]+$/gm, '');
  
  return fixedContent;
}

function parseYamlRobust(fileContent: string): WrekenfileStructure | null {
  try {
    // First try normal YAML parsing
    return yaml.load(fileContent) as WrekenfileStructure;
  } catch {
    console.log('Standard YAML parsing failed, attempting to fix formatting...');

    try {
      // Try to fix common YAML formatting issues
      const fixedContent = fixYamlContent(fileContent);

      // Try parsing the fixed content
      return yaml.load(fixedContent) as WrekenfileStructure;
    } catch {
      console.log('Could not parse YAML even after fixing formatting');
      return null;
    }
  }
}

function validateWrekenfile(filePath: string): ValidationResult {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error("Argument 'filePath' is required and must be a string");
  }
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      result.isValid = false;
      result.errors.push(`File not found: ${filePath}`);
      return result;
    }

    // Read the YAML file
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // First, validate that it's valid YAML
    try {
      yaml.load(fileContent);
    } catch (yamlError: any) {
      result.isValid = false;
      if (yamlError.name === 'YAMLException') {
        const line = yamlError.mark?.line !== undefined ? yamlError.mark.line + 1 : 'unknown';
        const column = yamlError.mark?.column !== undefined ? yamlError.mark.column + 1 : 'unknown';
        result.errors.push(`Invalid YAML syntax at line ${line}, column ${column}: ${yamlError.message}`);
      } else {
        result.errors.push(`Invalid YAML file: ${yamlError.message}`);
      }
      return result;
    }
    
    // Use robust parsing (which may try to fix minor issues)
    const data = parseYamlRobust(fileContent);

    if (!data) {
      result.isValid = false;
      result.errors.push('File is empty or could not be parsed as YAML');
      return result;
    }

    // Validate VERSION
    validateVersion(data, result);

    // Validate INIT section
    validateInitSection(data, result);

    // Validate INTERFACES section
    validateInterfacesSection(data, result);

    // Validate STRUCTS section
    validateStructsSection(data, result);

    // Cross-reference validation
    validateCrossReferences(data, result);

  } catch (error: any) {
    result.isValid = false;
    if (error.name === 'YAMLException') {
      result.errors.push(`YAML parsing error at line ${error.mark?.line || 'unknown'}: ${error.message}`);
    } else {
      result.errors.push(`Failed to parse YAML file: ${error.message}`);
    }
  }

  return result;
}

function validateVersion(data: WrekenfileStructure, result: ValidationResult): void {
  if (!data.VERSION) {
    result.isValid = false;
    result.errors.push('Missing required VERSION field');
    return;
  }

  if (typeof data.VERSION !== 'string') {
    result.isValid = false;
    result.errors.push('VERSION must be a string');
    return;
  }

  // Check if version is in expected format (e.g., '1.2' or '2.1.0')
  if (!/^\d+\.\d+(\.\d+)?$/.test(data.VERSION)) {
    result.warnings.push(`VERSION format '${data.VERSION}' may not be standard (expected format: X.Y or X.Y.Z)`);
  }
}

function validateInitSection(data: any, result: ValidationResult): void {
  if (!data.INIT && !data.DEFAULTS) {
    result.warnings.push('Missing INIT or DEFAULTS section (optional but recommended)');
    return;
  }

  // If using V2 DEFAULTS format directly at root
  if (data.DEFAULTS) {
    if (typeof data.DEFAULTS !== 'object' || Array.isArray(data.DEFAULTS)) {
      result.errors.push('DEFAULTS must be an object');
    }
    return;
  }

  if (typeof data.INIT !== 'object') {
    result.errors.push('INIT must be an object');
    return;
  }

  // Validate DEFAULTS if present
  if (data.INIT.DEFAULTS) {
    if (!Array.isArray(data.INIT.DEFAULTS)) {
      result.isValid = false;
      result.errors.push('INIT.DEFAULTS must be an array');
      return;
    }

    for (let i = 0; i < data.INIT.DEFAULTS.length; i++) {
      const defaultValue = data.INIT.DEFAULTS[i];
      if (typeof defaultValue !== 'object' || defaultValue === null) {
        result.isValid = false;
        result.errors.push(`INIT.DEFAULTS[${i}] must be an object`);
        continue;
      }

      const keys = Object.keys(defaultValue);
      if (keys.length !== 1) {
        result.isValid = false;
        result.errors.push(`INIT.DEFAULTS[${i}] must have exactly one key-value pair`);
        continue;
      }

      const key = keys[0];
      const value = defaultValue[key];
      
      if (typeof value !== 'string') {
        result.isValid = false;
        result.errors.push(`INIT.DEFAULTS[${i}].${key} must be a string`);
      }
    }
  }
}

function validateInterfacesSection(data: any, result: ValidationResult): void {
  const interfacesSection = data.INTERFACES || data.METHODS;
  const sectionName = data.INTERFACES ? 'INTERFACES' : 'METHODS';

  if (!interfacesSection) {
    result.isValid = false;
    result.errors.push('Missing required INTERFACES or METHODS section');
    return;
  }

  if (typeof interfacesSection !== 'object') {
    result.isValid = false;
    result.errors.push(`${sectionName} must be an object`);
    return;
  }

  const interfaces = Object.keys(interfacesSection);
  if (interfaces.length === 0) {
    result.warnings.push('INTERFACES section is empty');
    return;
  }

  for (const interfaceName of interfaces) {
    validateInterface(interfacesSection[interfaceName], interfaceName, result);
  }
}

function validateInterface(interfaceData: any, interfaceName: string, result: ValidationResult): void {
  if (typeof interfaceData !== 'object' || interfaceData === null) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}' must be an object`);
    return;
  }

  // Required fields for interfaces (V2 uses SUMMARY/DESC and HTTP)
  const hasDesc = 'DESC' in interfaceData || 'SUMMARY' in interfaceData;
  const hasHttp = 'HTTP' in interfaceData;
  
  if (!hasDesc) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}' missing required field: DESC or SUMMARY`);
  }
  if (!hasHttp) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}' missing required field: HTTP`);
  }

  // Validate DESC / SUMMARY
  if (interfaceData.DESC && typeof interfaceData.DESC !== 'string') {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.DESC must be a string`);
  }
  if (interfaceData.SUMMARY && typeof interfaceData.SUMMARY !== 'string') {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.SUMMARY must be a string`);
  }

  // ENDPOINT and VISIBILITY are optional in V2 (ENDPOINT moved to HTTP)

  // Validate VISIBILITY
  if (interfaceData.VISIBILITY) {
    const validVisibilities = ['PUBLIC', 'PRIVATE', 'INTERNAL'];
    if (!validVisibilities.includes(interfaceData.VISIBILITY)) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.VISIBILITY must be one of: ${validVisibilities.join(', ')}`);
    }
  }

  // Validate HTTP section
  if (interfaceData.HTTP) {
    validateHttpSection(interfaceData.HTTP, interfaceName, result);
  }

  // Validate INPUTS
  if (interfaceData.INPUTS) {
    validateInputs(interfaceData.INPUTS, interfaceName, result);
  }

  // Validate RETURNS
  if (interfaceData.RETURNS) {
    validateReturns(interfaceData.RETURNS, interfaceName, result);
  }
}

function validateHttpSection(httpData: any, interfaceName: string, result: ValidationResult): void {
  if (typeof httpData !== 'object' || httpData === null) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.HTTP must be an object`);
    return;
  }

  // Required HTTP fields (V2 uses METHOD and ENDPOINT)
  const hasMethod = 'METHOD' in httpData;
  const hasEndpoint = 'ENDPOINT' in httpData;
  
  if (!hasMethod) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.HTTP missing required field: METHOD`);
  }
  if (!hasEndpoint) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.HTTP missing required field: ENDPOINT`);
  }

  // Validate METHOD
  if (httpData.METHOD) {
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (!validMethods.includes(httpData.METHOD)) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.HTTP.METHOD must be one of: ${validMethods.join(', ')}`);
    }
  }

  // Validate HEADERS (can be object in V2)
  if (httpData.HEADERS) {
    if (typeof httpData.HEADERS !== 'object' || Array.isArray(httpData.HEADERS)) {
      // It's allowed to be an array in V1, but in V2 it's usually an object.
      // If it's an array, we'll just allow it for backward compatibility.
      if (Array.isArray(httpData.HEADERS)) {
        for (let i = 0; i < httpData.HEADERS.length; i++) {
          const header = httpData.HEADERS[i];
          if (typeof header !== 'object' || header === null) {
            result.isValid = false;
            result.errors.push(`Interface '${interfaceName}'.HTTP.HEADERS[${i}] must be an object`);
          }
        }
      }
    }
  }

  // Validate BODYTYPE
  if (httpData.BODYTYPE) {
    if (typeof httpData.BODYTYPE !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.HTTP.BODYTYPE must be a string`);
    }
  }
}

function validateInputs(inputs: any, interfaceName: string, result: ValidationResult): void {
  if (!Array.isArray(inputs)) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.INPUTS must be an array`);
    return;
  }

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (typeof input !== 'object' || input === null) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}] must be an object`);
      continue;
    }

    // Determine if V1 or V2 format
    const keys = Object.keys(input);
    const hasNameKey = 'name' in input;

    if (hasNameKey) {
        // V1 Format or V2 if the param name literally is "name" and it has a string value for name
        if (typeof input.name === 'string') {
            const hasType = 'type' in input || 'TYPE' in input;
            const hasRequired = 'required' in input || 'REQUIRED' in input;
            
            if (!hasType) {
                result.isValid = false;
                result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}] missing required field: type/TYPE`);
            }
            if (!hasRequired) {
                result.isValid = false;
                result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}] missing required field: required/REQUIRED`);
            }
        } else {
            // V2 format where the parameter name itself is literally "name"
            validateV2InputParam(input.name, 'name', i, interfaceName, result);
        }
    } else if (keys.length === 1) {
        // V2 Format with dynamic key
        const paramName = keys[0];
        const paramProps = input[paramName];
        validateV2InputParam(paramProps, paramName, i, interfaceName, result);
    } else {
        result.isValid = false;
        result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}] format not recognized`);
    }
  }
}

function validateV2InputParam(paramProps: any, paramName: string, i: number, interfaceName: string, result: ValidationResult): void {
    if (typeof paramProps !== 'object' || paramProps === null) {
        // In some cases it might just be the type string directly, but V2 usually wraps it
        if (typeof paramProps === 'string') {
            return; // Valid simple form
        }
        result.isValid = false;
        result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}].${paramName} must be an object or string`);
        return;
    }

    const typeVal = paramProps.type || paramProps.TYPE;
    const reqVal = paramProps.required || paramProps.REQUIRED;
    const locVal = paramProps.location || paramProps.LOCATION;

    if (!typeVal) {
        result.isValid = false;
        result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}] missing required field: type/TYPE`);
    }
    
    if (typeVal && typeof typeVal !== 'string') {
        result.isValid = false;
        result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}].type must be a string`);
    }

    if (reqVal !== undefined && typeof reqVal !== 'string' && typeof reqVal !== 'boolean') {
        result.isValid = false;
        result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}].required must be a string or boolean`);
    }

    if (locVal && typeof locVal !== 'string') {
        result.isValid = false;
        result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}].location must be a string`);
    }
}

function validateReturns(returns: any, interfaceName: string, result: ValidationResult): void {
  if (!Array.isArray(returns)) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.RETURNS must be an array`);
    return;
  }

  if (returns.length === 0) {
    result.warnings.push(`Interface '${interfaceName}'.RETURNS is empty`);
    return;
  }

  for (let i = 0; i < returns.length; i++) {
    const ret = returns[i];
    if (typeof ret !== 'object' || ret === null) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}] must be an object`);
      continue;
    }

    // Required return fields (V2 uses RETURNTYPE, RETURNVAR, STATUS)
    const hasType = 'RETURNTYPE' in ret || 'type' in ret || 'TYPE' in ret;
    const hasName = 'RETURNNAME' in ret || 'RETURNVAR' in ret;
    const hasCode = 'CODE' in ret || 'STATUS' in ret;
    
    if (!hasType) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}] missing required field: RETURNTYPE`);
    }
    if (!hasName) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}] missing required field: RETURNNAME or RETURNVAR`);
    }
    if (!hasCode) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}] missing required field: CODE or STATUS`);
    }

    const retType = ret.RETURNTYPE || ret.type || ret.TYPE;
    const retName = ret.RETURNNAME || ret.RETURNVAR;
    const retCode = ret.CODE || ret.STATUS;

    // Validate RETURNTYPE
    if (retType && typeof retType !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}].RETURNTYPE must be a string`);
    }

    // Validate RETURNNAME/RETURNVAR
    if (retName && typeof retName !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}].RETURNNAME must be a string`);
    }

    // Validate CODE/STATUS
    if (retCode && typeof retCode !== 'string' && typeof retCode !== 'number') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}].CODE must be a string or number`);
    }
  }
}

function validateStructsSection(data: WrekenfileStructure, result: ValidationResult): void {
  if (!data.STRUCTS) {
    result.warnings.push('Missing STRUCTS section (optional but recommended)');
    return;
  }

  if (typeof data.STRUCTS !== 'object') {
    result.isValid = false;
    result.errors.push('STRUCTS must be an object');
    return;
  }

  const structs = Object.keys(data.STRUCTS);
  if (structs.length === 0) {
    result.warnings.push('STRUCTS section is empty');
    return;
  }

  for (const structName of structs) {
    validateStruct(data.STRUCTS[structName], structName, result);
  }
}

function validateStruct(structData: any, structName: string, result: ValidationResult): void {
  if (!Array.isArray(structData)) {
    result.isValid = false;
    result.errors.push(`Struct '${structName}' must be an array`);
    return;
  }

  for (let i = 0; i < structData.length; i++) {
    const field = structData[i];
    if (typeof field !== 'object' || field === null) {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}] must be an object`);
      continue;
    }

    // Required struct field properties
    const hasType = 'type' in field || 'TYPE' in field;
    const hasRequired = 'required' in field || 'REQUIRED' in field;

    if (!('name' in field)) {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}] missing required property: name`);
    }
    if (!hasType) {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}] missing required property: type/TYPE`);
    }
    if (!hasRequired) {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}] missing required property: required/REQUIRED`);
    }

    // Validate name
    if (field.name && typeof field.name !== 'string') {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}].name must be a string`);
    }

    const typeVal = field.type || field.TYPE;
    const reqVal = field.required || field.REQUIRED;

    // Validate type
    if (typeVal && typeof typeVal !== 'string') {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}].type must be a string`);
    }

    // Validate required - be more flexible with actual values
    if (reqVal !== undefined) {
      if (typeof reqVal === 'boolean') {
        // OK
      } else if (typeof reqVal === 'string') {
        if (!['TRUE', 'FALSE', 'true', 'false', 'OPTIONAL'].includes(reqVal)) {
          result.warnings.push(`Struct '${structName}'[${i}].required '${reqVal}' should be a boolean or 'TRUE', 'FALSE', 'OPTIONAL'`);
        }
      } else {
        result.isValid = false;
        result.errors.push(`Struct '${structName}'[${i}].required must be a boolean or string`);
      }
    }
  }
}

function validateCrossReferences(data: WrekenfileStructure, result: ValidationResult): void {
  if (!data.INTERFACES || !data.STRUCTS) {
    return; // Skip if either section is missing
  }

  const availableStructs = Object.keys(data.STRUCTS);
  const referencedStructs = new Set<string>();

  // Collect all struct references from interfaces
  for (const interfaceName of Object.keys(data.INTERFACES)) {
    const interfaceData = data.INTERFACES[interfaceName];
    
    // Check INPUTS
    if (interfaceData.INPUTS && Array.isArray(interfaceData.INPUTS)) {
      for (const input of interfaceData.INPUTS) {
        if (input.type && input.type.startsWith('STRUCT(')) {
          const structName = input.type.replace('STRUCT(', '').replace(')', '');
          referencedStructs.add(structName);
        }
      }
    }

    // Check RETURNS
    if (interfaceData.RETURNS && Array.isArray(interfaceData.RETURNS)) {
      for (const ret of interfaceData.RETURNS) {
        if (ret.RETURNTYPE && ret.RETURNTYPE.startsWith('STRUCT(')) {
          const structName = ret.RETURNTYPE.replace('STRUCT(', '').replace(')', '');
          referencedStructs.add(structName);
        }
      }
    }
  }

  // Check for undefined structs
  for (const referencedStruct of referencedStructs) {
    if (!availableStructs.includes(referencedStruct)) {
      result.warnings.push(`Referenced struct '${referencedStruct}' is not defined in STRUCTS section`);
    }
  }

  // Check for unused structs
  for (const availableStruct of availableStructs) {
    if (!referencedStructs.has(availableStruct)) {
      result.warnings.push(`Struct '${availableStruct}' is defined but not referenced in any interface`);
    }
  }
}

function printValidationResult(result: ValidationResult): void {
  console.log('Wrekenfile Validation Results:');
  console.log('=====================================');
  
  if (result.isValid) {
    console.log('Wrekenfile is VALID');
  } else {
    console.log('Wrekenfile is INVALID');
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach((warning, index) => {
      console.log(`  ${index + 1}. ${warning}`);
    });
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log('\nNo issues found!');
  }
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node wrekenfile-validator.js <wrekenfile.yaml> [--fix]');
    console.error('');
    console.error('Arguments:');
    console.error('  wrekenfile.yaml  Path to the Wrekenfile to validate');
    console.error('  --fix            Automatically fix indentation, quotes, and spacing issues');
    process.exit(1);
  }
  
  // Find the file path (first non-flag argument)
  const filePath = args.find(arg => !arg.startsWith('--'));
  const shouldFix = args.includes('--fix');
  
  if (!filePath) {
    console.error('Error: No Wrekenfile path provided');
    process.exit(1);
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File '${filePath}' does not exist`);
    process.exit(1);
  }
  
  if (shouldFix) {
    try {
      console.log('Attempting to fix Wrekenfile...');
      
      // Read the original file
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // Try to fix the YAML formatting
      const fixedContent = fixYamlContent(fileContent);
      
      // Try to parse the fixed content
      const data = yaml.load(fixedContent) as WrekenfileStructure;
      
      if (!data) {
        console.error('Error: Could not parse the file even after fixing');
        process.exit(1);
      }
      
      // Create backup
      const backupPath = `${filePath}.backup`;
      fs.writeFileSync(backupPath, fileContent);
      console.log(`Backup created at: ${backupPath}`);
      
      // Write fixed file
      fs.writeFileSync(filePath, fixedContent);
      console.log('Wrekenfile has been fixed and saved!');
      
      // Validate the fixed file
      console.log('\nValidating fixed Wrekenfile...');
      const result = validateWrekenfile(filePath);
      printValidationResult(result);
      
    } catch (error: any) {
      console.error(`Error fixing Wrekenfile: ${error.message}`);
      process.exit(1);
    }
  } else {
    const result = validateWrekenfile(filePath);
    printValidationResult(result);
  }
  
  process.exit(0);
}

if (require.main === module) {
  main();
}

export {
  validateWrekenfile,
  fixWrekenfile,
  ValidationResult,
  WrekenfileStructure,
  printValidationResult
}; 