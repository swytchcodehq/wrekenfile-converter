#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { generateWrekenfile as generateOpenAPI } from './src/v2/openapi-to-wreken';
import { generateWrekenfile as generatePostman } from './src/v2/postman-to-wrekenfile';
import { generateMiniWrekenfiles, saveMiniWrekenfiles } from './src/v2/mini-wrekenfile-generator';

interface ExampleConfig {
  input: string;
  output: string;
  miniOutputDir: string;
  type: 'openapi' | 'postman';
}

const EXAMPLES: ExampleConfig[] = [
  {
    input: './examples/3n.yaml',
    output: './examples/3n_wrekenfile_v2.yaml',
    miniOutputDir: './examples/3n_mini-wrekenfiles-v2',
    type: 'openapi',
  },
  {
    input: './examples/Nium APIpostman_collection.json',
    output: './examples/nium_wrekenfile_v2.yaml',
    miniOutputDir: './examples/nium_mini-wrekenfiles-v2',
    type: 'postman',
  },
];

function processExample(config: ExampleConfig): void {
  const inputPath = path.resolve(config.input);
  const inputContent = fs.readFileSync(inputPath, 'utf8');
  
  let wrekenfileYaml: string;
  if (config.type === 'openapi') {
    const spec = load(inputContent);
    const baseDir = path.dirname(inputPath);
    wrekenfileYaml = generateOpenAPI(spec, baseDir);
  } else {
    const collection = JSON.parse(inputContent);
    wrekenfileYaml = generatePostman(collection, {});
  }
  
  fs.writeFileSync(config.output, wrekenfileYaml);
  
  const miniFiles = generateMiniWrekenfiles(wrekenfileYaml);
  saveMiniWrekenfiles(miniFiles, config.miniOutputDir);
}

function main(): void {
  for (const example of EXAMPLES) {
    try {
      processExample(example);
    } catch (error: any) {
      console.error(`Error processing ${example.input}: ${error.message}`);
      throw error;
    }
  }
}

main();

