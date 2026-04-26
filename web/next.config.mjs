/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output → minimal Docker image (Fargate ARM64)
  output: 'standalone',
  // /api/* in CloudFront/ALB routes to FastAPI (compute-stack listener rule
  // priority 10), so Next.js does not own that prefix. We still expose
  // /api/auth/callback and /api/health-web for ALB tg-web health checks.
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['cytoscape', 'react-cytoscapejs'],
  },
};

export default nextConfig;
