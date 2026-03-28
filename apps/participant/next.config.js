/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  transpilePackages: ['@syncstrike/shared-types', '@syncstrike/ui'],
}
module.exports = nextConfig
