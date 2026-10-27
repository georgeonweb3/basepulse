/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Optional server-only deps pulled in by @coinbase/cdp-sdk via wagmi's baseAccount
    // connector. BasePulse never uses x402 payments, so stub them out.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
