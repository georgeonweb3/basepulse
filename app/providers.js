"use client";
import { WagmiProvider, http } from "wagmi";
import { base } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

// Free WalletConnect project ID from https://cloud.reown.com — needed for mobile wallets.
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "077790c9ce50381f09e13b97f8e88155";

const config = getDefaultConfig({
  appName: "BasePulse",
  projectId,
  chains: [base],
  transports: { [base.id]: http("https://mainnet.base.org") },
  ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={base}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
