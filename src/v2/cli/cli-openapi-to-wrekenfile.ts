#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { generateWrekenfile } from '../openapi-to-wreken';

function printUsage() {
  console.log(`Usage: npx ts-node src/v2/cli/cli-openapi-to-wrekenfile.ts --input <openapi.yaml|json> [--output <wrekenfile.yaml>] [--cwd <dir>]`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: any = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      opts.input = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      opts.output = args[++i];
    } else if (args[i] === '--cwd') {
      opts.cwd = args[++i];
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (!opts.input) {
    printUsage();
    process.exit(1);
  }
  const inputPath = path.resolve(opts.input);
  const outputPath = path.resolve(opts.output || 'output_wrekenfile.yaml');
  const baseDir = opts.cwd ? path.resolve(opts.cwd) : path.dirname(inputPath);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  let openapiSpec: any;
  try {
    const raw = fs.readFileSync(inputPath, 'utf8');
    if (inputPath.endsWith('.json')) {
      openapiSpec = JSON.parse(raw);
    } else {
      openapiSpec = load(raw);
    }
  } catch (err) {
    console.error('Failed to load OpenAPI file:', err);
    process.exit(1);
  }

  let wrekenfileYaml: string;
  try {
    wrekenfileYaml = generateWrekenfile(openapiSpec, baseDir);
  } catch (err: any) {
    if (err?.code === 'OPENAPI_V2_DETECTED') {
      console.error('Error: OpenAPI v2 (Swagger) spec supplied. Use the v2 converter:');
      console.error(`  npx ts-node src/v2/cli/cli-openapi-v2-to-wrekenfile.ts --input ${opts.input} --output ${opts.output || 'output_wrekenfile.yaml'}`);
      process.exit(1);
    }
    console.error('Failed to generate Wrekenfile:', err);
    process.exit(1);
  }

  try {
    fs.writeFileSync(outputPath, wrekenfileYaml, 'utf8');
    console.log(`Wrekenfile v2.0.1 written to ${outputPath}`);
  } catch (err) {
    console.error('Failed to write output file:', err);
    process.exit(1);
  }
}

main();

