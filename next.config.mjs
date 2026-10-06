/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Testler ayrı klasörde derler (geliştirme sunucusunun .next klasörüne dokunmaz)
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
