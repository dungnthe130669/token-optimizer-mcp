/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow importing from workspace packages
  transpilePackages: ['@token-optimizer/core'],
};

export default nextConfig;
