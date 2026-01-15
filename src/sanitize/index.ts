/**
 * Sanitizer module - Removes personal/sensitive data from memories before export
 *
 * Strips:
 * - File paths (Windows/Unix)
 * - Usernames and home directories
 * - Email addresses
 * - API keys and tokens
 * - Project-specific paths
 * - IP addresses
 * - URLs with personal identifiers
 */

export interface SanitizeOptions {
  /** Keep file paths as-is */
  keepPaths?: boolean;
  /** Keep usernames/emails */
  keepIdentifiers?: boolean;
  /** Keep URLs */
  keepUrls?: boolean;
  /** Custom patterns to remove (regex strings) */
  customPatterns?: string[];
  /** Custom replacements: { pattern: replacement } */
  customReplacements?: Record<string, string>;
}

// Common patterns for personal/sensitive data
const PATTERNS = {
  // Windows paths: C:\Users\Username\..., D:\Projects\...
  windowsUserPath: /[A-Za-z]:\\Users\\[^\\]+\\[^\s,;)}\]"']+/g,
  windowsPath: /[A-Za-z]:\\[^\s,;)}\]"']+/g,

  // Unix paths: /home/username/..., /Users/username/...
  unixHomePath: /\/(?:home|Users)\/[^\/]+\/[^\s,;)}\]"']+/g,
  unixAbsPath: /\/(?:var|opt|srv|etc|usr)\/[^\s,;)}\]"']+/g,

  // Usernames in common patterns
  usernameInPath: /(?:Users|home)[\/\\]([a-zA-Z0-9_-]+)/gi,

  // Email addresses
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

  // API keys and tokens (common formats)
  apiKey: /(?:sk-|pk_|api[_-]?key[_-]?)[a-zA-Z0-9_-]{20,}/gi,
  bearer: /Bearer\s+[a-zA-Z0-9_-]+/gi,

  // Generic tokens/secrets
  secretPattern: /(?:secret|token|password|apikey|api_key)["\s:=]+["']?[a-zA-Z0-9_-]{8,}["']?/gi,

  // IP addresses (v4)
  ipv4: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,

  // URLs with potential user info
  urlWithAuth: /https?:\/\/[^:]+:[^@]+@[^\s]+/g,

  // GitHub/GitLab usernames in URLs
  gitUserUrl: /(?:github|gitlab)\.com\/[a-zA-Z0-9_-]+/gi,

  // Localhost with ports (often dev-specific)
  localhost: /(?:localhost|127\.0\.0\.1):\d+/g,

  // Environment variable references with values
  envVar: /(?:process\.env\.|ENV\[)[A-Z_]+["\]]?\s*(?:=|:)\s*["'][^"']+["']/gi,
};

// Replacement placeholders
const REPLACEMENTS = {
  windowsUserPath: '<USER_PATH>',
  windowsPath: '<PATH>',
  unixHomePath: '<USER_PATH>',
  unixAbsPath: '<PATH>',
  email: '<EMAIL>',
  apiKey: '<API_KEY>',
  bearer: 'Bearer <TOKEN>',
  secretPattern: '<SECRET>',
  ipv4: '<IP_ADDRESS>',
  urlWithAuth: '<URL_WITH_AUTH>',
  gitUserUrl: 'github.com/<USER>',
  localhost: 'localhost:<PORT>',
  envVar: '<ENV_VAR>',
};

/**
 * Sanitize a single string of personal/sensitive data
 */
export function sanitizeContent(content: string, options: SanitizeOptions = {}): string {
  let result = content;

  // Apply custom replacements first (highest priority)
  if (options.customReplacements) {
    for (const [pattern, replacement] of Object.entries(options.customReplacements)) {
      try {
        const regex = new RegExp(pattern, 'gi');
        result = result.replace(regex, replacement);
      } catch (e) {
        // Invalid regex, skip
      }
    }
  }

  // Remove custom patterns
  if (options.customPatterns) {
    for (const pattern of options.customPatterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        result = result.replace(regex, '<REDACTED>');
      } catch (e) {
        // Invalid regex, skip
      }
    }
  }

  // Sanitize paths unless keepPaths is true
  if (!options.keepPaths) {
    result = result.replace(PATTERNS.windowsUserPath, REPLACEMENTS.windowsUserPath);
    result = result.replace(PATTERNS.unixHomePath, REPLACEMENTS.unixHomePath);
    result = result.replace(PATTERNS.windowsPath, REPLACEMENTS.windowsPath);
    result = result.replace(PATTERNS.unixAbsPath, REPLACEMENTS.unixAbsPath);
  }

  // Sanitize identifiers unless keepIdentifiers is true
  if (!options.keepIdentifiers) {
    result = result.replace(PATTERNS.email, REPLACEMENTS.email);

    // Extract and replace usernames from paths
    const usernameMatches = content.match(PATTERNS.usernameInPath);
    if (usernameMatches) {
      const usernames = new Set(usernameMatches.map(m => {
        const match = m.match(/[\/\\]([a-zA-Z0-9_-]+)$/);
        return match ? match[1] : null;
      }).filter(Boolean));

      for (const username of usernames) {
        if (username && username.length > 2) {
          // Replace standalone username occurrences (but not common words)
          const commonWords = new Set(['admin', 'user', 'root', 'home', 'users', 'local', 'system']);
          if (!commonWords.has(username.toLowerCase())) {
            result = result.replace(new RegExp(`\\b${username}\\b`, 'g'), '<USER>');
          }
        }
      }
    }
  }

  // Sanitize URLs unless keepUrls is true
  if (!options.keepUrls) {
    result = result.replace(PATTERNS.urlWithAuth, REPLACEMENTS.urlWithAuth);
    result = result.replace(PATTERNS.gitUserUrl, REPLACEMENTS.gitUserUrl);
    result = result.replace(PATTERNS.localhost, REPLACEMENTS.localhost);
  }

  // Always sanitize secrets (never export these)
  result = result.replace(PATTERNS.apiKey, REPLACEMENTS.apiKey);
  result = result.replace(PATTERNS.bearer, REPLACEMENTS.bearer);
  result = result.replace(PATTERNS.secretPattern, REPLACEMENTS.secretPattern);
  result = result.replace(PATTERNS.ipv4, REPLACEMENTS.ipv4);
  result = result.replace(PATTERNS.envVar, REPLACEMENTS.envVar);

  return result;
}

/**
 * Sanitize a memory object
 */
export function sanitizeMemory<T extends { content: string }>(
  memory: T,
  options: SanitizeOptions = {}
): T {
  return {
    ...memory,
    content: sanitizeContent(memory.content, options),
  };
}

/**
 * Sanitize an array of memories
 */
export function sanitizeMemories<T extends { content: string }>(
  memories: T[],
  options: SanitizeOptions = {}
): T[] {
  return memories.map(m => sanitizeMemory(m, options));
}

/**
 * Check if content contains potential sensitive data
 */
export function containsSensitiveData(content: string): {
  hasSensitiveData: boolean;
  detectedTypes: string[];
} {
  const detectedTypes: string[] = [];

  if (PATTERNS.windowsUserPath.test(content) || PATTERNS.unixHomePath.test(content)) {
    detectedTypes.push('user_paths');
  }
  if (PATTERNS.email.test(content)) {
    detectedTypes.push('email');
  }
  if (PATTERNS.apiKey.test(content) || PATTERNS.secretPattern.test(content)) {
    detectedTypes.push('api_keys');
  }
  if (PATTERNS.ipv4.test(content)) {
    detectedTypes.push('ip_addresses');
  }
  if (PATTERNS.gitUserUrl.test(content)) {
    detectedTypes.push('git_usernames');
  }

  // Reset regex lastIndex (they're global)
  Object.values(PATTERNS).forEach(p => p.lastIndex = 0);

  return {
    hasSensitiveData: detectedTypes.length > 0,
    detectedTypes,
  };
}
