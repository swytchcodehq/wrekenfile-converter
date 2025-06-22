import { generateMiniWrekenfiles, MiniWrekenfile } from './mini-wrekenfile-generator';

/**
 * Example usage of the mini Wrekenfile generator
 * This shows how to integrate with a vector database
 */

async function exampleUsage() {
  try {
    // Generate mini Wrekenfiles from the main Wrekenfile
    const miniWrekenfiles: MiniWrekenfile[] = generateMiniWrekenfiles('./Wrekenfile.yaml');
    
    console.log(`Generated ${miniWrekenfiles.length} mini Wrekenfiles`);
    
    // Example: Prepare data for vector DB upload
    const vectorDBData = miniWrekenfiles.map((miniFile, index) => ({
      id: `wrekenfile-chunk-${index}`,
      content: miniFile.content,
      metadata: {
        ...miniFile.metadata,
        source: 'wrekenfile',
        chunk_type: 'endpoint_group',
        created_at: new Date().toISOString()
      }
    }));
    
    // Example: Upload to vector DB in batches
    const batchSize = 5;
    for (let i = 0; i < vectorDBData.length; i += batchSize) {
      const batch = vectorDBData.slice(i, i + batchSize);
      
      console.log(`\nUploading batch ${Math.floor(i / batchSize) + 1}:`);
      for (const item of batch) {
        console.log(`  - ${item.metadata.filename} (${item.metadata.methods.join(', ')})`);
      }
      
      // Here you would call your vector DB upload function
      // await uploadToVectorDB(batch);
    }
    
    // Example: Search for specific endpoints
    const projectsEndpoint = miniWrekenfiles.find(
      file => file.metadata.endpoint === '/v2/app/projects'
    );
    
    if (projectsEndpoint) {
      console.log('\nFound projects endpoint:');
      console.log(`  Methods: ${projectsEndpoint.metadata.methods.join(', ')}`);
      console.log(`  Structs: ${projectsEndpoint.metadata.structs.length}`);
    }
    
  } catch (error) {
    console.error('Error in example usage:', error);
  }
}

// Example: Function to get mini Wrekenfiles for specific endpoints
export function getMiniWrekenfilesForEndpoints(
  wrekenfilePath: string, 
  targetEndpoints: string[]
): MiniWrekenfile[] {
  const allMiniFiles = generateMiniWrekenfiles(wrekenfilePath);
  
  return allMiniFiles.filter(miniFile => 
    targetEndpoints.includes(miniFile.metadata.endpoint)
  );
}

// Example: Function to get mini Wrekenfiles for specific methods
export function getMiniWrekenfilesForMethods(
  wrekenfilePath: string, 
  targetMethods: string[]
): MiniWrekenfile[] {
  const allMiniFiles = generateMiniWrekenfiles(wrekenfilePath);
  
  return allMiniFiles.filter(miniFile => 
    miniFile.metadata.methods.some(method => 
      targetMethods.includes(method)
    )
  );
}

// Example: Function to get mini Wrekenfile content as string for AI context
export function getMiniWrekenfileContent(
  wrekenfilePath: string, 
  endpoint: string
): string | null {
  const allMiniFiles = generateMiniWrekenfiles(wrekenfilePath);
  
  const miniFile = allMiniFiles.find(
    file => file.metadata.endpoint === endpoint
  );
  
  return miniFile ? miniFile.content : null;
}

// Run example if this file is executed directly
if (require.main === module) {
  exampleUsage();
} 