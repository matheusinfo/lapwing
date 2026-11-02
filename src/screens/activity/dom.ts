const HTML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' };

/** Escapes text for use inside HTML (names and notes come from user files). */
export const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => HTML_ESCAPES[c]);
