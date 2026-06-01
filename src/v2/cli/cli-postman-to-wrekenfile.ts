#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { generateWrekenfile, loadEnvironmentFile } from '../postman-to-wrekenfile';

function printUsage() {
  console.log('Usage: wrekenfile-postman --input <postman_collection.json> [--output <wrekenfile.yaml>] [--env <postman_environment.json>]');
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: any = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      opts.input = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      opts.output = args[++i];
    } else if (args[i] === '--env' || args[i] === '-e') {
      opts.env = args[++i];
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (!opts.input) {
    printUsage();
  }
  const inputFile = path.resolve(opts.input);
  const outputFile = path.resolve(opts.output || 'output_wrekenfile.yaml');

  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  let variables = {};
  if (opts.env) {
    const envFile = path.resolve(opts.env);
    if (!fs.existsSync(envFile)) {
      console.error(`Environment file not found: ${envFile}`);
      process.exit(1);
    }
    variables = loadEnvironmentFile(envFile);
  }

  try {
    const postmanContent = fs.readFileSync(inputFile, 'utf8');
    const postmanCollection = JSON.parse(postmanContent);
    const wrekenfileYaml = generateWrekenfile(postmanCollection, variables);
    fs.writeFileSync(outputFile, wrekenfileYaml);
    console.log(`Wrekenfile v2.0.2 generated: ${outputFile}`);
  } catch (error) {
    console.error(`Error generating Wrekenfile: ${(error as any).message}`);
    process.exit(1);
  }
}

main();

