"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount, useBytecode, usePublicClient, useReadContracts, useSignTypedData, useSwitchChain, useWriteContract,
} from "wagmi";
import { formatUnits, parseSignature, parseUnits } from "viem";
import {
  SAVINGS_ADDRESS, SAVINGS_ABI, USDC_ADDRESS, USDC_DECIMALS, ERC20_ABI, BASE_CHAIN_ID,
  USDC_PERMIT_DOMAIN, PERMIT_TYPES, PERMIT_DEADLINE_SECONDS, MIN_DAILY_USD, MAX_DAILY_USD,
} from "./savingsConfig";
import { DATA_SUFFIX } from "./contract";

const savings = { address: SAVINGS_ADDRESS, abi: SAVINGS_ABI, chainId: BASE_CHAIN_ID };
const usdc = { address: USDC_ADDRESS, abi: ERC20_ABI, chainId: BASE_CHAIN_ID };

// ── Formatting ────────────────────────────────────────────────────────────────
export function fmtUsd(units, { precise = false } = {}) {
  if (units === undefined || units === null) return "—";
  const n = Number(formatUnits(BigInt(units), USDC_DECIMALS));
  if (precise && n > 0 && n < 0.01) return `$${n.toFixed(6).replace(/0+$/, "")}`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse a user-entered dollar amount into USDC units, or return an error string. */
export function parseUsd(input, { min = MIN_DAILY_USD, max = MAX_DAILY_USD } = {}) {
  const s = String(input ?? "").trim().replace(/^\$/, "");
  if (!s) return { error: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return { error: "Enter a valid number." };
  if ((s.split(".")[1] || "").length > USDC_DECIMALS) return { error: "Up to 6 decimal places." };
  const units = parseUnits(s, USDC_DECIMALS);
  if (min !== null && units < parseUnits(String(min), USDC_DECIMALS)) return { error: `Minimum is $${min.toFixed(2)}.` };
  if (max !== null && units > parseUnits(String(max), USDC_DECIMALS)) return { error: `Maximum is $${max.toLocaleString()}.` };
  return { units };
}

export const utcDay = (ms = Date.now()) => Math.floor(ms / 86_400_000);

/** Seconds until the next UTC midnight, ticking every second. */
export function useUtcCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const secs = Math.max(0, Math.ceil(((utcDay(now) + 1) * 86_400_000 - now) / 1000));
  const h = String(Math.floor(secs / 3600)).padStart(2, "0");
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return { secs, label: `${h}:${m}:${s}` };
}

// ── Errors ────────────────────────────────────────────────────────────────────
const ERROR_TEXT = {
  AlreadySavedToday: "You've already saved today. Come back after 00:00 UTC to keep your streak going.",
  CapExceeded: "Savings are at the deposit cap right now. Try a smaller amount or check back soon.",
  InvalidAmount: `Amount must be between $${MIN_DAILY_USD.toFixed(2)} and $${MAX_DAILY_USD.toLocaleString()}.`,
  NoPlan: "Pick a daily amount first.",
  InsufficientBalance: "That's more than your savings balance.",
  TransferFailed: "USDC transfer failed. Check your USDC balance and try again.",
  BadCircle: "That circle doesn't exist. Check the circle ID.",
  CircleFull: "That circle is full (50 members max).",
  AlreadyInCircle: "You're already in a circle. Leave it first to join or create another.",
  NotInCircle: "You're not in a circle.",
  NameLength: "Circle name must be 1–32 characters.",
};

function revertName(e) {
  let cur = e;
  for (let i = 0; cur && i < 8; i++) {
    const name = cur.data?.errorName || cur.errorName;
    if (name) return name;
    cur = cur.cause;
  }
  const m = `${e?.shortMessage || ""} ${e?.message || ""}`;
  return Object.keys(ERROR_TEXT).find((k) => m.includes(k)) || null;
}

export function isUserRejection(e) {
  let cur = e;
  for (let i = 0; cur && i < 8; i++) {
    if (cur.code === 4001 || cur.name === "UserRejectedRequestError") return true;
    cur = cur.cause;
  }
  return /user rejected|user denied|rejected the request|request rejected|cancel/i.test(e?.shortMessage || e?.message || "");
}

export function savingsError(e) {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (isUserRejection(e)) return "Request cancelled in your wallet.";
  const name = revertName(e);
  if (name && ERROR_TEXT[name]) return ERROR_TEXT[name];
  const m = `${e?.shortMessage || ""} ${e?.message || ""}`;
  if (/exceeds balance/i.test(m)) return "Not enough USDC in your wallet.";
  if (/exceeds allowance/i.test(m)) return "USDC approval is missing. Please try again.";
  if (/insufficient funds/i.test(m)) return "Not enough ETH on Base to pay gas. Add a little ETH on Base and try again.";
  if (/chain mismatch|does not match the target chain|ChainMismatch/i.test(m)) return "Switch your wallet to Base to continue.";
  return e?.shortMessage || "Something went wrong. Please try again.";
}

// ── Deployment check ──────────────────────────────────────────────────────────
/** "loading" | "live" | "missing" — whether BasePulseSavings has bytecode on Base. */
export function useSavingsDeployment() {
  const q = useBytecode({ address: SAVINGS_ADDRESS, chainId: BASE_CHAIN_ID, query: { staleTime: 60_000, retry: 2 } });
  if (q.isLoading) return "loading";
  if (q.isError) return "missing";
  return q.data && q.data !== "0x" ? "live" : "missing";
}

// ── Reads ─────────────────────────────────────────────────────────────────────
export function useSavingsData(address, live) {
  const global = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...savings, functionName: "totalSavers" },
      { ...savings, functionName: "totalAssets" },
      { ...savings, functionName: "depositCap" },
      { ...savings, functionName: "today" },
    ],
    query: { enabled: live, refetchInterval: 30_000 },
  });
  const user = useReadContracts({
    allowFailure: true,
    contracts: address ? [
      { ...savings, functionName: "balanceOf", args: [address] },
      { ...savings, functionName: "earned", args: [address] },
      { ...savings, functionName: "currentStreak", args: [address] },
      { ...savings, functionName: "savers", args: [address] },
      { ...savings, functionName: "canSaveToday", args: [address] },
      { ...usdc, functionName: "balanceOf", args: [address] },
      { ...usdc, functionName: "allowance", args: [address, SAVINGS_ADDRESS] },
    ] : [],
    query: { enabled: live && !!address, refetchInterval: 20_000 },
  });

  const g = global.data || [];
  const u = user.data || [];
  const pick = (arr, i) => (arr[i]?.status === "success" ? arr[i].result : undefined);
  const saverRaw = pick(u, 3);
  const saver = saverRaw ? {
    dailyAmount: saverRaw[0], totalDeposited: saverRaw[1], lastDay: Number(saverRaw[2]), streak: Number(saverRaw[3]),
    bestStreak: Number(saverRaw[4]), daysSaved: Number(saverRaw[5]), circleId: Number(saverRaw[6]),
  } : null;
  const today = pick(g, 3) !== undefined ? Number(pick(g, 3)) : utcDay();
  const savedToday = !!saver && saver.daysSaved > 0 && saver.lastDay === today;

  const refetch = useCallback(() => { global.refetch(); user.refetch(); }, [global, user]);

  return {
    loading: global.isLoading || (!!address && user.isLoading),
    totalSavers: pick(g, 0), totalAssets: pick(g, 1), depositCap: pick(g, 2), today,
    balance: pick(u, 0), earned: pick(u, 1), currentStreak: pick(u, 2) !== undefined ? Number(pick(u, 2)) : undefined,
    saver, canSaveToday: pick(u, 4), usdcBalance: pick(u, 5), allowance: pick(u, 6),
    savedToday,
    refetch,
  };
}

// ── Network guard ─────────────────────────────────────────────────────────────
export function useEnsureBase() {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const wrongNetwork = isConnected && chainId !== BASE_CHAIN_ID;
  const ensureBase = useCallback(async () => {
    if (!wrongNetwork) return;
    try { await switchChainAsync({ chainId: BASE_CHAIN_ID }); }
    catch (e) { throw new Error(isUserRejection(e) ? "Switch to Base to continue." : "Couldn't switch to Base. Please switch networks in your wallet."); }
  }, [wrongNetwork, switchChainAsync]);
  return { wrongNetwork, ensureBase, switching: isPending };
}

// ── Writes ────────────────────────────────────────────────────────────────────
function useTx() {
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const send = useCallback(async (req) => {
    const hash = await writeContractAsync({ chainId: BASE_CHAIN_ID, dataSuffix: DATA_SUFFIX, ...req });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted on Base.");
    return hash;
  }, [writeContractAsync, publicClient]);
  return { send, publicClient };
}

const BUSINESS_ERRORS = new Set(["AlreadySavedToday", "CapExceeded", "InvalidAmount", "NoPlan"]);

/**
 * Save today's amount.
 * Primary: sign an EIP-2612 permit for exactly `amount` and call saveWithPermit (one tx).
 * Fallback (permit unsupported / signature unusable, e.g. some smart wallets): approve exact amount, then setPlanAndSave.
 * If an allowance >= amount already exists, setPlanAndSave is called directly (one tx, no signature).
 */
export function useSaveAction() {
  const { address } = useAccount();
  const { send, publicClient } = useTx();
  const { signTypedDataAsync } = useSignTypedData();
  const { ensureBase } = useEnsureBase();
  const [stage, setStage] = useState("idle"); // idle | switching | signing | saving | approving | done
  const [error, setError] = useState("");
  const [lastHash, setLastHash] = useState(null);

  const run = useCallback(async ({ amount, usdcBalance, allowance, totalAssets, depositCap, savedToday }) => {
    setError(""); setLastHash(null);
    try {
      if (!address) throw new Error("Connect your wallet first.");
      if (savedToday) throw new Error(ERROR_TEXT.AlreadySavedToday);
      if (usdcBalance !== undefined && usdcBalance < amount) throw new Error(`Not enough USDC. You have ${fmtUsd(usdcBalance)} on Base.`);
      if (depositCap !== undefined && totalAssets !== undefined && totalAssets + amount > depositCap) throw new Error(ERROR_TEXT.CapExceeded);
      setStage("switching");
      await ensureBase();

      // Existing allowance: no signature needed.
      if (allowance !== undefined && allowance >= amount) {
        setStage("saving");
        const h = await send({ address: SAVINGS_ADDRESS, abi: SAVINGS_ABI, functionName: "setPlanAndSave", args: [amount] });
        setLastHash(h); setStage("done"); return h;
      }

      // Primary path: EIP-2612 permit for exactly `amount`.
      let permitArgs = null;
      setStage("signing");
      try {
        const nonce = await publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "nonces", args: [address] });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_DEADLINE_SECONDS);
        const sig = await signTypedDataAsync({
          domain: USDC_PERMIT_DOMAIN, types: PERMIT_TYPES, primaryType: "Permit",
          message: { owner: address, spender: SAVINGS_ADDRESS, value: amount, nonce, deadline },
        });
        // saveWithPermit takes (v, r, s): only a plain 65-byte ECDSA signature works.
        if (typeof sig === "string" && sig.length === 132) {
          const p = parseSignature(sig);
          const v = p.v !== undefined ? Number(p.v) : 27 + Number(p.yParity);
          const args = [amount, amount, deadline, v, p.r, p.s];
          // Simulate: the contract swallows permit failures, so a bad permit shows up as a transfer revert.
          try {
            await publicClient.simulateContract({ account: address, address: SAVINGS_ADDRESS, abi: SAVINGS_ABI, functionName: "saveWithPermit", args });
            permitArgs = args;
          } catch (simErr) {
            const n = revertName(simErr);
            if (n && BUSINESS_ERRORS.has(n)) throw simErr;
            // otherwise fall through to approve path
          }
        }
      } catch (e) {
        if (isUserRejection(e) || BUSINESS_ERRORS.has(revertName(e))) throw e;
        // permit signing unsupported → fall back
      }

      if (permitArgs) {
        setStage("saving");
        const h = await send({ address: SAVINGS_ADDRESS, abi: SAVINGS_ABI, functionName: "saveWithPermit", args: permitArgs });
        setLastHash(h); setStage("done"); return h;
      }

      // Fallback: exact approval, then save.
      setStage("approving");
      await send({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [SAVINGS_ADDRESS, amount] });
      setStage("saving");
      const h = await send({ address: SAVINGS_ADDRESS, abi: SAVINGS_ABI, functionName: "setPlanAndSave", args: [amount] });
      setLastHash(h); setStage("done"); return h;
    } catch (e) {
      setError(savingsError(e)); setStage("idle");
      return null;
    }
  }, [address, ensureBase, publicClient, send, signTypedDataAsync]);

  const reset = useCallback(() => { setStage("idle"); setError(""); }, []);
  return { run, stage, error, lastHash, reset, busy: !["idle", "done"].includes(stage) };
}

/** Generic savings-contract write (withdraw, circles) with Base guard, builder code, and friendly errors. */
export function useSavingsWrite() {
  const { send } = useTx();
  const { ensureBase } = useEnsureBase();
  const [pending, setPending] = useState(null); // functionName in flight
  const [error, setError] = useState("");
  const write = useCallback(async (functionName, args = []) => {
    setError(""); setPending(functionName);
    try {
      await ensureBase();
      const h = await send({ address: SAVINGS_ADDRESS, abi: SAVINGS_ABI, functionName, args });
      setPending(null); return h;
    } catch (e) {
      setError(savingsError(e)); setPending(null); return null;
    }
  }, [ensureBase, send]);
  return { write, pending, error, setError };
}

// ── Circles reads ─────────────────────────────────────────────────────────────
export function useCircle(circleId, live) {
  const id = circleId ? BigInt(circleId) : 0n;
  const q = useReadContracts({
    allowFailure: true,
    contracts: id ? [
      { ...savings, functionName: "getCircle", args: [id] },
      { ...savings, functionName: "circleStats", args: [id] },
    ] : [],
    query: { enabled: live && id > 0n, refetchInterval: 30_000 },
  });
  const [c, s] = q.data || [];
  const circle = c?.status === "success" ? { ...c.result[0], members: c.result[1] } : null;
  const notFound = c?.status === "failure";
  const leaderboard = useMemo(() => {
    const rows = s?.status === "success" ? [...s.result] : [];
    return rows.sort((a, b) => (b.streak - a.streak) || (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  }, [s]);
  return { circle, leaderboard, notFound, loading: q.isLoading, refetch: q.refetch };
}
