"use strict";

const _SANITIZE_PATTERNS = [
  /<script[^>]*googletagmanager[^>]*>[\s\S]*?<\/script>/gi,
  /<script[^>]*>[\s\S]*?window\.dataLayer[\s\S]*?<\/script>/gi,
  /<script[^>]*>[\s\S]*?gtag\([\s\S]*?<\/script>/gi,
  /<div[^>]*id=["']sidebarad[12]["'][^>]*>[\s\S]*?<\/div>/gi,
  /#sidebarad1\s*,[\s\S]{0,20}#sidebarad2\s*\{[\s\S]*?\}/gi,
  /#sidebarad[12]\s*\{[\s\S]*?\}/gi,
  /\.sidebar-(?:close|frame)\s*\{[\s\S]*?\}/gi,
  /<script>\s*\(function\s*\(_0x[\s\S]*?<\/script>/gi,
  /<script>\s*\(function\s*\(\s*\)[\s\S]*?<\/script>/gi,
  /<script[^>]*src=["'][^"']*(ads|analytics|tracker|doubleclick|adsbygoogle|pagead)[^"']*["'][^>]*><\/script>/gi,
  /<iframe[^>]*ads?[^>]*>[\s\S]*?<\/iframe>/gi,
  /<link[^>]*rel=["']stylesheet["'][^>]*href=["'][^"']*(ads|adservice|doubleclick|pagead|analytics)[^"']*["'][^>]*\/?>/gi,
  /<link[^>]*href=["'][^"']*(ads|adservice|doubleclick|pagead|analytics)[^"']*["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
];

function sanitizeHTML(html) {
  for (const re of _SANITIZE_PATTERNS) {
    re.lastIndex = 0;
    html = html.replace(re, "");
  }
  return html;
}
