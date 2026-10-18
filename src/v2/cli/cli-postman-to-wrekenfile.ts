#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { load } from 'js-yaml';
import { generateWrekenfile, loadEnvironmentFile } from '../postman-to-wrekenfile';
import { WREKENFILE_V2_VERSION } from '../../versions';

function printUsage() {
  console.log('Usage: npx ts-node src/v2/cli/cli-postman-to-wrekenfile.ts --input <postman_collection.json> [--output <wrekenfile.yaml>] [--env <postman_environment.json>] [--signing <signing_recipe.json|yaml>]');
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
    } else if (args[i] === '--signing') {
      // An x-swytchcode-signing recipe for collections signed by pre-request scripts.
      opts.signing = args[++i];
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

  let signing: any;
  if (opts.signing) {
    const recipeFile = path.resolve(opts.signing);
    if (!fs.existsSync(recipeFile)) {
      console.error(`Signing recipe not found: ${recipeFile}`);
      process.exit(1);
    }
    try {
      signing = load(fs.readFileSync(recipeFile, 'utf8'));
    } catch (error) {
      console.error(`Could not read signing recipe ${recipeFile}: ${(error as any).message}`);
      process.exit(1);
    }
  }

  try {
    const postmanContent = fs.readFileSync(inputFile, 'utf8');
    const postmanCollection = JSON.parse(postmanContent);
    const wrekenfileYaml = generateWrekenfile(postmanCollection, variables, { signing });
    fs.writeFileSync(outputFile, wrekenfileYaml);
    console.log(`Wrekenfile v${WREKENFILE_V2_VERSION} generated: ${outputFile}`);
  } catch (error) {
    console.error(`Error generating Wrekenfile: ${(error as any).message}`);
    process.exit(1);
  }
}

main();

