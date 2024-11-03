import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.externals = [...(config.externals || []), { "ws": "ws" }];
    return config;
  },
};

export default nextConfig;
