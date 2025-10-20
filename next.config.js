/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // appDir: true, // Удалите или закомментируйте эту строку
  },
}

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  ...nextConfig,
  assetPrefix: isProd ? '/mgtu_bozhko_lab1/' : '',
  basePath: isProd ? '/mgtu_bozhko_lab1' : '',
  output: 'export',
};