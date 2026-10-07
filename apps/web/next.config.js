/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Installed-app scope is /r/{slug}/ (slash-terminated so W3C prefix
  // matching cannot leak into /r/{slug}-annex). Next's default trailing-slash
  // redirect would 308 that launch URL back to the bare form — an
  // out-of-scope document that drops the installed manifest — so disable the
  // built-in rule. src/middleware.ts re-establishes canonicalization: bare
  // restaurant roots get the slash, every other route keeps the no-slash form.
  skipTrailingSlashRedirect: true,
};

module.exports = nextConfig;
