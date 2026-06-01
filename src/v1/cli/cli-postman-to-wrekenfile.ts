#!/usr/bin/env node
import fs from 'fs';
import { generateWrekenfile, loadEnvironmentFile } from '../postman-to-wrekenfile';

function printUsage() {
  console.log('Usage: npx ts-node src/cli-postman-to-wrekenfile.ts <postman_collection.json> <output_wrekenfile.yaml> [postman_environment.json]');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    printUsage();
  }
  const [inputFile, outputFile, envFile] = args;

  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  let variables = {};
  if (envFile) {
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
    console.log(`Wrekenfile generated: ${outputFile}`);
  } catch (error) {
    console.error(`Error generating Wrekenfile: ${(error as any).message}`);
    process.exit(1);
  }
}

  main();
