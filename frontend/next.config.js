/** @type {import('next').NextConfig} */
// Standalone output produces a self-contained server bundle in .next/standalone
// that the Docker runtime image copies as-is. Without this the image needs full
// node_modules at runtime.
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Reduce image size by skipping image optimization runtime in production builds
  // unless we need it; serving images from S3 directly bypasses next/image anyway.
  images: { unoptimized: true },
};

module.exports = nextConfig;
