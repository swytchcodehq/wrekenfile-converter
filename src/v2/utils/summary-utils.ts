/**
 * Shared summary generation utilities for v2 converters
 */
import { SUMMARY_VERBS } from './constants';

/**
 * Generate summary from OpenAPI operation (v2 and v3)
 */
export function generateOpenApiSummary(op: any, method: string, path: string): string {
  if (op.summary) return op.summary;
  if (op.description) {
    // Use first sentence of description as summary
    const firstSentence = op.description.split(/[.!?]\s/)[0];
    return firstSentence || op.description.substring(0, 100);
  }
  if (op.operationId) return `Perform operation ${op.operationId}`;
  const verb = SUMMARY_VERBS[method.toLowerCase()] || 'Execute';
  
  // Extract resource name from path
  const pathParts = path.split('/').filter(p => p && !p.startsWith('{'));
  const resource = pathParts[pathParts.length - 1] || 'resource';
  const resourceName = resource.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  return `${verb} ${resourceName}`;
}

