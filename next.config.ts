import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "circulation-batman-affected-alto.trycloudflare.com"
  ],
  reactStrictMode: true,
  devIndicators: false
};

export default nextConfig;
