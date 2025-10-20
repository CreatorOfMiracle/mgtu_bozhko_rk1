/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // appDir: true, // Удалите или закомментируйте эту строку
  },
}

const isProd = process.env.NODE_ENV === 'production';

// Derive repository name when running on GitHub Actions; fallback to the
// actual repository name. This keeps asset paths correct for GitHub Pages.
const repoName = process.env.GITHUB_REPOSITORY
  ? process.env.GITHUB_REPOSITORY.split('/')[1]
  : 'mgtu_bozhko_rk1';

module.exports = {
  ...nextConfig,
  assetPrefix: isProd ? `/${repoName}/` : '',
  basePath: isProd ? `/${repoName}` : '',
  output: 'export',
};