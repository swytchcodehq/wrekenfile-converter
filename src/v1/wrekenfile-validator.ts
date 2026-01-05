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
  } catch (error) {
    console.log('⚠️  Standard YAML parsing failed, attempting to fix formatting...');
    
    try {
      // Try to fix common YAML formatting issues
      const fixedContent = fixYamlContent(fileContent);
      
      // Try parsing the fixed content
      return yaml.load(fixedContent) as WrekenfileStructure;
    } catch (secondError) {
      console.log('❌ Could not parse YAML even after fixing formatting');
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

function validateInitSection(data: WrekenfileStructure, result: ValidationResult): void {
  if (!data.INIT) {
    result.warnings.push('Missing INIT section (optional but recommended)');
    return;
  }

  if (typeof data.INIT !== 'object') {
    result.isValid = false;
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

function validateInterfacesSection(data: WrekenfileStructure, result: ValidationResult): void {
  if (!data.INTERFACES) {
    result.isValid = false;
    result.errors.push('Missing required INTERFACES section');
    return;
  }

  if (typeof data.INTERFACES !== 'object') {
    result.isValid = false;
    result.errors.push('INTERFACES must be an object');
    return;
  }

  const interfaces = Object.keys(data.INTERFACES);
  if (interfaces.length === 0) {
    result.warnings.push('INTERFACES section is empty');
    return;
  }

  for (const interfaceName of interfaces) {
    validateInterface(data.INTERFACES[interfaceName], interfaceName, result);
  }
}

function validateInterface(interfaceData: any, interfaceName: string, result: ValidationResult): void {
  if (typeof interfaceData !== 'object' || interfaceData === null) {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}' must be an object`);
    return;
  }

  // Required fields for interfaces
  const requiredFields = ['DESC', 'ENDPOINT', 'VISIBILITY', 'HTTP', 'INPUTS', 'RETURNS'];
  
  for (const field of requiredFields) {
    if (!(field in interfaceData)) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}' missing required field: ${field}`);
    }
  }

  // Validate DESC
  if (interfaceData.DESC && typeof interfaceData.DESC !== 'string') {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.DESC must be a string`);
  }

  // Validate ENDPOINT
  if (interfaceData.ENDPOINT && typeof interfaceData.ENDPOINT !== 'string') {
    result.isValid = false;
    result.errors.push(`Interface '${interfaceName}'.ENDPOINT must be a string`);
  }

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

  // Required HTTP fields
  const requiredHttpFields = ['METHOD', 'HEADERS', 'BODYTYPE'];
  
  for (const field of requiredHttpFields) {
    if (!(field in httpData)) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.HTTP missing required field: ${field}`);
    }
  }

  // Validate METHOD
  if (httpData.METHOD) {
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (!validMethods.includes(httpData.METHOD)) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.HTTP.METHOD must be one of: ${validMethods.join(', ')}`);
    }
  }

  // Validate HEADERS
  if (httpData.HEADERS) {
    if (!Array.isArray(httpData.HEADERS)) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.HTTP.HEADERS must be an array`);
    } else {
      for (let i = 0; i < httpData.HEADERS.length; i++) {
        const header = httpData.HEADERS[i];
        if (typeof header !== 'object' || header === null) {
          result.isValid = false;
          result.errors.push(`Interface '${interfaceName}'.HTTP.HEADERS[${i}] must be an object`);
          continue;
        }

        const headerKeys = Object.keys(header);
        if (headerKeys.length !== 1) {
          result.isValid = false;
          result.errors.push(`Interface '${interfaceName}'.HTTP.HEADERS[${i}] must have exactly one key-value pair`);
        }
      }
    }
  }

  // Validate BODYTYPE
  if (httpData.BODYTYPE) {
    const validBodyTypes = ['RAW', 'JSON', 'FORM'];
    if (!validBodyTypes.includes(httpData.BODYTYPE)) {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.HTTP.BODYTYPE must be one of: ${validBodyTypes.join(', ')}`);
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

    // Required input fields
    const requiredInputFields = ['name', 'type', 'required'];
    
    for (const field of requiredInputFields) {
      if (!(field in input)) {
        result.isValid = false;
        result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}] missing required field: ${field}`);
      }
    }

    // Validate name
    if (input.name && typeof input.name !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}].name must be a string`);
    }

    // Validate type
    if (input.type && typeof input.type !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}].type must be a string`);
    }

    // Validate required
    if (input.required && typeof input.required !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}].required must be a string`);
    } else if (input.required && !['TRUE', 'FALSE'].includes(input.required)) {
      result.warnings.push(`Interface '${interfaceName}'.INPUTS[${i}].required '${input.required}' should be 'TRUE' or 'FALSE'`);
    }

    // Validate location if present
    if (input.location && typeof input.location !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.INPUTS[${i}].location must be a string`);
    } else if (input.location && !['PATH', 'QUERY', 'HEADER', 'BODY'].includes(input.location)) {
      result.warnings.push(`Interface '${interfaceName}'.INPUTS[${i}].location '${input.location}' should be one of: PATH, QUERY, HEADER, BODY`);
    }
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

    // Required return fields
    const requiredReturnFields = ['RETURNTYPE', 'RETURNNAME', 'CODE'];
    
    for (const field of requiredReturnFields) {
      if (!(field in ret)) {
        result.isValid = false;
        result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}] missing required field: ${field}`);
      }
    }

    // Validate RETURNTYPE
    if (ret.RETURNTYPE && typeof ret.RETURNTYPE !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}].RETURNTYPE must be a string`);
    }

    // Validate RETURNNAME
    if (ret.RETURNNAME && typeof ret.RETURNNAME !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}].RETURNNAME must be a string`);
    }

    // Validate CODE
    if (ret.CODE && typeof ret.CODE !== 'string') {
      result.isValid = false;
      result.errors.push(`Interface '${interfaceName}'.RETURNS[${i}].CODE must be a string`);
    } else if (ret.CODE && !/^\d{3}$/.test(ret.CODE)) {
      result.warnings.push(`Interface '${interfaceName}'.RETURNS[${i}].CODE '${ret.CODE}' may not be a valid HTTP status code`);
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
    const requiredFieldProps = ['name', 'type', 'required'];
    
    for (const prop of requiredFieldProps) {
      if (!(prop in field)) {
        result.isValid = false;
        result.errors.push(`Struct '${structName}'[${i}] missing required property: ${prop}`);
      }
    }

    // Validate name
    if (field.name && typeof field.name !== 'string') {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}].name must be a string`);
    }

    // Validate type
    if (field.type && typeof field.type !== 'string') {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}].type must be a string`);
    }

    // Validate required - be more flexible with actual values
    if (field.required && typeof field.required !== 'string') {
      result.isValid = false;
      result.errors.push(`Struct '${structName}'[${i}].required must be a string`);
    } else if (field.required && !['TRUE', 'FALSE', 'OPTIONAL'].includes(field.required)) {
      result.warnings.push(`Struct '${structName}'[${i}].required '${field.required}' should be 'TRUE', 'FALSE', or 'OPTIONAL'`);
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
  console.log('🔍 Wrekenfile Validation Results:');
  console.log('=====================================');
  
  if (result.isValid) {
    console.log('✅ Wrekenfile is VALID');
  } else {
    console.log('❌ Wrekenfile is INVALID');
  }

  if (result.errors.length > 0) {
    console.log('\n🚨 Errors:');
    result.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach((warning, index) => {
      console.log(`  ${index + 1}. ${warning}`);
    });
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log('\n🎉 No issues found!');
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
    console.error('❌ Error: No Wrekenfile path provided');
    process.exit(1);
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: File '${filePath}' does not exist`);
    process.exit(1);
  }
  
  if (shouldFix) {
    try {
      console.log('🔧 Attempting to fix Wrekenfile...');
      
      // Read the original file
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // Try to fix the YAML formatting
      const fixedContent = fixYamlContent(fileContent);
      
      // Try to parse the fixed content
      const data = yaml.load(fixedContent) as WrekenfileStructure;
      
      if (!data) {
        console.error('❌ Error: Could not parse the file even after fixing');
        process.exit(1);
      }
      
      // Create backup
      const backupPath = `${filePath}.backup`;
      fs.writeFileSync(backupPath, fileContent);
      console.log(`📁 Backup created at: ${backupPath}`);
      
      // Write fixed file
      fs.writeFileSync(filePath, fixedContent);
      console.log('✅ Wrekenfile has been fixed and saved!');
      
      // Validate the fixed file
      console.log('\n🔍 Validating fixed Wrekenfile...');
      const result = validateWrekenfile(filePath);
      printValidationResult(result);
      
    } catch (error: any) {
      console.error(`❌ Error fixing Wrekenfile: ${error.message}`);
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