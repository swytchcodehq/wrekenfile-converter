/**
 * Shared utilities for processing responses in v2 converters
 */

/**
 * Generate descriptive RETURNVAR name based on operation and response code
 */
export function generateReturnVarName(operationId: string, code: string): string {
  const baseName = operationId.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  
  if (code === '200') {
    // For 200 OK, use operation name with _result suffix
    return `${baseName}_result`;
  } else {
    // For other 2xx codes (201, 202, etc.), use operation name with status code
    return `${baseName}_${code}`;
  }
}

/**
 * Generate descriptive WHEN clause for error responses with HTTP status code
 */
export function generateErrorWhen(response: any, code: string): string {
  const statusCode = parseInt(code);
  
  if (response && typeof response === 'object' && response.description) {
    return `${response.description} (HTTP ${code})`;
  } else if (statusCode >= 400 && statusCode < 500) {
    return `Client error (HTTP ${code})`;
  } else if (statusCode >= 500) {
    return `Server error (HTTP ${code})`;
  } else {
    return `HTTP ${code}`;
  }
}

