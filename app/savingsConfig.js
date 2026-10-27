// BasePulseSavings config (Base mainnet, chain 8453).
// The contract is not deployed yet. NEXT_PUBLIC_SAVINGS_ADDRESS overrides the predicted
// CREATE2 address; the UI checks for bytecode and shows "Savings launching soon" until it exists.
export { SAVINGS_ABI } from "./savingsAbi";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const PREDICTED_SAVINGS_ADDRESS = "0xe5b13C9F33a3e7E7Ce489f3518086dc642bc50c0";
const envSavings = process.env.NEXT_PUBLIC_SAVINGS_ADDRESS;
export const SAVINGS_ADDRESS = envSavings && ADDR_RE.test(envSavings) ? envSavings : PREDICTED_SAVINGS_ADDRESS;

export const BASE_CHAIN_ID = 8453;

// Native USDC on Base (6 decimals, EIP-2612 permit, domain name "USD Coin", version "2").
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;
export const USDC_PERMIT_DOMAIN = {
  name: "USD Coin",
  version: "2",
  chainId: BASE_CHAIN_ID,
  verifyingContract: USDC_ADDRESS,
};
export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
export const PERMIT_DEADLINE_SECONDS = 30 * 60;

// Limits mirrored from the contract (MIN_DAILY / MAX_DAILY).
export const MIN_DAILY_USD = 0.1;
export const MAX_DAILY_USD = 1000;
export const DAILY_PRESETS = ["1", "2", "5"];
export const CIRCLE_NAME_MAX = 32;
export const CIRCLE_GOAL_MAX = 366;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
];

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://basepulse.vercel.app";
