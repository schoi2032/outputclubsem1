import type { NextConfig } from 'next'

const API_URL = process.env.API_URL ?? 'http://localhost:4000'

const config: NextConfig = {
  // Vercel builds its own output; standalone is for the Docker image.
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  transpilePackages: ['@quid/ui', '@quid/shared'],
  poweredByHeader: false,
  agentRules: false,
  // Lets end-to-end tests run their own dev server next to yours.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  devIndicators: false,
  // The browser only ever talks to this origin; /api/* is proxied to the API
  // service so session cookies stay first-party (run.app is a public suffix).
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      // OAuth discovery for connected apps (the Quid MCP server).
      { source: '/.well-known/:path*', destination: `${API_URL}/.well-known/:path*` },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
    ]
  },
}

export default config
