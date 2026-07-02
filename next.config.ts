import type { NextConfig } from "next";

const backendBaseUrl = (process.env.MEETING_BACKEND_BASE_URL || "http://124.223.100.178").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${backendBaseUrl}/api/:path*`
        }
      ]
    };
  }
};

export default nextConfig;
