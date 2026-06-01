#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { generateMiniWrekenfiles, saveMiniWrekenfiles } from '../mini-wrekenfile-generator';

function printUsage() {
  console.log('Usage: wrekenfile-mini --input <wrekenfile.yaml> [--output <dir>]');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: any = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      opts.input = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      opts.output = args[++i];
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
  const outputDir = opts.output ? path.resolve(opts.output) : path.resolve('./mini-wrekenfiles');

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  let wrekenfileContent: string;
  try {
    wrekenfileContent = fs.readFileSync(inputPath, 'utf8');
  } catch (err) {
    console.error('Failed to read input file:', err);
    process.exit(1);
  }

  let miniWrekenfiles;
  try {
    miniWrekenfiles = generateMiniWrekenfiles(wrekenfileContent);
  } catch (err) {
    console.error('Failed to generate mini Wrekenfiles:', err);
    process.exit(1);
  }

  try {
    saveMiniWrekenfiles(miniWrekenfiles, outputDir);
    console.log(`Generated ${miniWrekenfiles.length} mini Wrekenfiles in ${outputDir}`);
    for (const mini of miniWrekenfiles) {
      console.log(`  - ${mini.metadata.filename}`);
    }
  } catch (err) {
    console.error('Failed to save mini Wrekenfiles:', err);
    process.exit(1);
  }
}

main();

