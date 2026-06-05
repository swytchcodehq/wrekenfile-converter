/**
 * Shared constants for v2 converters
 */
import { WREKENFILE_V2_VERSION } from '../../versions';

/**
 * Wrekenfile version to use for v2 converters
 */
export const WREKENFILE_VERSION = WREKENFILE_V2_VERSION;

/**
 * Default base URL when none can be extracted
 */
export const DEFAULT_BASE_URL = 'https://api.default.com';

/**
 * Common base URL variable names in Postman collections
 */
export const BASE_URL_VARIABLE_NAMES = [
  'url',
  'baseUrl',
  'base_url',
  'baseURL',
  'api_url',
  'apiUrl',
];

/**
 * Sensitive keys that should be masked in DEFAULTS
 */
export const SENSITIVE_KEYS = [
  'api_key',
  'api-key',
  'x-api-key',
  'signature',
  'x-signature',
  'authorization',
  'token',
  'password',
  'secret',
];

/**
 * YAML dump options
 */
export const YAML_DUMP_OPTIONS = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
  quotingType: '"' as const,
  forceQuotes: false,
};

/**
 * Execution mode constants
 */
export const EXECUTION_MODE_SYNC = 'sync';
export const EXECUTION_MODE_ASYNC = 'async';

/**
 * ASYNC section constants
 */
export const ASYNC_RETURNS_RESULT = 'result';

/**
 * Type constants
 */
export const TYPE_VOID = 'VOID';
export const TYPE_ANY = 'ANY';

/**
 * Body type constants
 */
export const BODYTYPE_RAW = 'raw';

/**
 * Default HTTP scheme
 */
export const DEFAULT_HTTP_SCHEME = 'https';

/**
 * YAML document separators to remove
 */
export const YAML_DOCUMENT_SEPARATOR_START = '---';
export const YAML_DOCUMENT_SEPARATOR_END = '...';
export const YAML_SEPARATOR_LINES = ['===', '___'];

/**
 * Method group type prefixes
 */
export const GROUP_PREFIX_HTTP = 'http:';
export const GROUP_PREFIX_SDK = 'sdk:';
export const GROUP_PREFIX_OTHER = 'other:';

/**
 * Mini-wrekenfile filename prefix
 */
export const MINI_FILENAME_PREFIX = 'mini-';

/**
 * YAML file extension
 */
export const YAML_EXTENSION = '.yaml';

/**
 * Default mini-wrekenfiles output directory
 */
export const DEFAULT_MINI_OUTPUT_DIR = './mini-wrekenfiles';

/**
 * Filename sanitization regex patterns
 */
export const FILENAME_INVALID_CHARS = /[^a-zA-Z0-9-_]/g;
export const FILENAME_MULTIPLE_HYPHENS = /-+/g;
export const FILENAME_LEADING_TRAILING_HYPHENS = /^-|-$/g;
export const FILENAME_LEADING_SLASHES = /^\/+/;
export const FILENAME_TRAILING_SLASHES = /\/+$/;

/**
 * Content type constants (MIME types)
 */
export const CONTENT_TYPE_JSON = 'application/json';
export const CONTENT_TYPE_FORM_DATA = 'multipart/form-data';
export const CONTENT_TYPE_URLENCODED = 'application/x-www-form-urlencoded';
export const CONTENT_TYPE_XML = 'application/xml';
export const CONTENT_TYPE_TEXT_XML = 'text/xml';
export const CONTENT_TYPE_TEXT_PLAIN = 'text/plain';
export const CONTENT_TYPE_TEXT_HTML = 'text/html';
export const CONTENT_TYPE_TEXT_CSV = 'text/csv';
export const CONTENT_TYPE_APPLICATION_PDF = 'application/pdf';
export const CONTENT_TYPE_APPLICATION_OCTET_STREAM = 'application/octet-stream';
export const CONTENT_TYPE_IMAGE_JPEG = 'image/jpeg';
export const CONTENT_TYPE_IMAGE_PNG = 'image/png';
export const CONTENT_TYPE_IMAGE_GIF = 'image/gif';
export const CONTENT_TYPE_APPLICATION_ZIP = 'application/zip';
export const CONTENT_TYPE_APPLICATION_JAVASCRIPT = 'application/javascript';
export const CONTENT_TYPE_TEXT_JAVASCRIPT = 'text/javascript';

/**
 * Header name constants (common HTTP headers)
 */
export const HEADER_CONTENT_TYPE = 'Content-Type';
export const HEADER_AUTHORIZATION = 'Authorization';
export const HEADER_ACCEPT = 'Accept';
export const HEADER_ACCEPT_LANGUAGE = 'Accept-Language';
export const HEADER_ACCEPT_ENCODING = 'Accept-Encoding';
export const HEADER_USER_AGENT = 'User-Agent';
export const HEADER_X_REQUEST_ID = 'X-Request-Id';
export const HEADER_X_CLIENT_VERSION = 'X-Client-Version';
export const HEADER_X_API_KEY = 'X-API-Key';
export const HEADER_X_SIGNATURE = 'X-Signature';
export const HEADER_CACHE_CONTROL = 'Cache-Control';
export const HEADER_CONTENT_LENGTH = 'Content-Length';
export const HEADER_CONTENT_DISPOSITION = 'Content-Disposition';
export const HEADER_CONTENT_ENCODING = 'Content-Encoding';
export const HEADER_LOCATION = 'Location';
export const HEADER_COOKIE = 'Cookie';
export const HEADER_SET_COOKIE = 'Set-Cookie';
export const HEADER_ETAG = 'ETag';
export const HEADER_IF_NONE_MATCH = 'If-None-Match';
export const HEADER_IF_MATCH = 'If-Match';

/**
 * Authentication header value constants (for HEADERS section)
 * These are the values used in the generated Wrekenfile HEADERS section
 */
export const AUTH_BEARER_TOKEN = 'bearer_token';
export const AUTH_BASIC_AUTH = 'basic_auth';
export const AUTH_DIGEST_AUTH = 'digest_auth';
export const AUTH_API_KEY = 'api_key';
export const AUTH_SIGNATURE = 'signature';
export const AUTH_ID_TOKEN = 'id_token';
export const AUTH_OAUTH1 = 'oauth1_token';
export const AUTH_OAUTH2 = 'oauth2_token';
export const AUTH_JWT = 'jwt_token';
export const AUTH_HOBA = 'hoba_auth';
export const AUTH_MUTUAL = 'mutual_auth';
export const AUTH_AWS4_HMAC_SHA256 = 'aws4_hmac_sha256';

/**
 * Authentication header key constants (for checking)
 */
export const AUTH_HEADER_X_API_KEY = 'x-api-key';
export const AUTH_HEADER_AUTHORIZATION = 'authorization';
export const AUTH_HEADER_X_SIGNATURE = 'x-signature';

/**
 * Authentication template constants (for DEFAULTS section)
 * These are the placeholder values used in the generated Wrekenfile DEFAULTS section
 */
export const AUTH_TEMPLATE_BEARER = 'BEARER <TOKEN>';
export const AUTH_TEMPLATE_BEARER_ACCESS = 'BEARER <ACCESS_TOKEN>';
export const AUTH_TEMPLATE_BASIC = 'Basic <BASE64>';
export const AUTH_TEMPLATE_DIGEST = 'Digest <CREDENTIALS>';
export const AUTH_TEMPLATE_ID_TOKEN = 'ID_TOKEN <JWT>';
export const AUTH_TEMPLATE_OAUTH1 = 'OAuth1 <TOKEN>';
export const AUTH_TEMPLATE_OAUTH2 = 'OAuth2 <ACCESS_TOKEN>';
export const AUTH_TEMPLATE_JWT = 'JWT <TOKEN>';
export const AUTH_TEMPLATE_API_KEY = '<API_KEY>';
export const AUTH_TEMPLATE_SIGNATURE = '<SIGNATURE>';

/**
 * HTTP method constants
 */
export const HTTP_METHOD_GET = 'GET';
export const HTTP_METHOD_POST = 'POST';
export const HTTP_METHOD_PUT = 'PUT';
export const HTTP_METHOD_DELETE = 'DELETE';
export const HTTP_METHOD_PATCH = 'PATCH';

/**
 * HTTP methods that require Content-Type header
 */
export const HTTP_METHODS_WITH_BODY = ['post', 'put', 'patch'];

/**
 * Summary verb mappings for generating summaries
 */
export const SUMMARY_VERBS: Record<string, string> = {
  get: 'Fetch',
  post: 'Create',
  put: 'Update',
  delete: 'Delete',
  patch: 'Modify',
  head: 'Head',
  options: 'Options',
};

