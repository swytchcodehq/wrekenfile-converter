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

/** Field names that carry the page size on page-numbered responses, in priority order. */
const PAGE_SIZE_FIELDS = ['pageSize', 'page_size', 'perPage', 'per_page', 'limit', 'size'];

/**
 * PAGINATION hint for a success response from its schema's properties, or
 * undefined when it doesn't look paginated. Field values are property names.
 */
export function detectPagination(properties: any): Record<string, string> | undefined {
  if (!properties || typeof properties !== 'object') return undefined;
  const has = (name: string) => properties[name] !== undefined && properties[name] !== null;

  if (has('next_cursor') || has('cursor')) {
    return { TYPE: 'cursor', CURSOR_FIELD: has('next_cursor') ? 'next_cursor' : 'cursor' };
  }
  if (has('offset') || has('skip')) {
    return { TYPE: 'offset', OFFSET_FIELD: has('offset') ? 'offset' : 'skip' };
  }
  if (has('page') || has('pageNumber')) {
    return { TYPE: 'page', PAGE_SIZE_FIELD: PAGE_SIZE_FIELDS.find(has) || 'limit' };
  }
  return undefined;
}

/**
 * Well-known HTTP status code descriptions for richer error messages
 */
const HTTP_STATUS_DESCRIPTIONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * Generate descriptive WHEN clause for error responses with HTTP status code.
 * Uses the spec description when available, falls back to well-known HTTP
 * status descriptions, and finally to generic client/server error labels.
 */
export function generateErrorWhen(response: any, code: string): string {
  const statusCode = parseInt(code);

  if (response && typeof response === 'object' && response.description) {
    return `${response.description} (HTTP ${code})`;
  }

  const knownDescription = HTTP_STATUS_DESCRIPTIONS[statusCode];
  if (knownDescription) {
    return `${knownDescription} (HTTP ${code})`;
  }

  if (statusCode >= 400 && statusCode < 500) {
    return `Client error (HTTP ${code})`;
  } else if (statusCode >= 500) {
    return `Server error (HTTP ${code})`;
  } else {
    return `HTTP ${code}`;
  }
}

