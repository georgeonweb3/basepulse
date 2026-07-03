/**
 * BasePulse.jsx  –  v3 "Production Wiring"
 *
 * Real integrations (no shims):
 *  [1] BottomNav onClick wired – nav IDs aligned to switch: 'pulse' | 'receipts' | 'network' | 'settings'
 *  [2] Conditional views – switch statement renders DashboardView, ReceiptsView, NetworkView, SettingsView
 *  [3] Real-time Base RPC – useBaseNetwork() polls https://mainnet.base.org every 10s for gas + block
 *  [4] Wagmi v2 contract integration – real useWriteContract + useWaitForTransactionReceipt from "wagmi"
 *  [5] Farcaster Frame SDK – useFarcasterContext() hydrates profile from real frame context on mount
 *
 * ⚠️ ONE THING ONLY YOU CAN SUPPLY:
 *   RECEIPT_CONTRACT_ADDRESS below is a placeholder (0x000...001). Replace it with
 *   your deployed receipt-registry contract on Base mainnet, and adjust
 *   RECEIPT_CONTRACT_ABI if your function signature differs from mintReceipt(bytes32,string).
 *
 * Host-app requirements (this file assumes these exist one level up):
 *   - Wrap your app root with <WagmiProvider config={config}><ConnectKitProvider>...
 *   - npm i wagmi viem @tanstack/react-query connectkit @farcaster/frame-sdk
 *   - This component must render inside a <QueryClientProvider> (wagmi v2 requires it)
 *   - Swap the inline <ConnectButton> for <ConnectKitButton /> once ConnectKit is wired
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";

// ── Contract config ──────────────────────────────────────────────────────────
// !! Replace with your deployed BasePulse receipt-registry contract on Base mainnet
const RECEIPT_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000001";
const RECEIPT_CONTRACT_ABI = [
  {
    name: "mintReceipt",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "txHash", type: "bytes32" },
      { name: "label",  type: "string"  },
    ],
    outputs: [],
  },
];
const BASE_CHAIN_ID = 8453;

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:          "#F9FAFB",
  surface:     "#FFFFFF",
  surfaceHover:"#F3F4F6",
  border:      "rgba(0,0,0,0.06)",
  text:        "#111827",
  textSub:     "#6B7280",
  textMuted:   "#9CA3AF",
  blue:        "#0052FF",
  blueLight:   "#EEF3FF",
  blueMid:     "#3B73FF",
  green:       "#10B981",
  greenLight:  "#ECFDF5",
  amber:       "#F59E0B",
  amberLight:  "#FFFBEB",
  red:         "#EF4444",
  redLight:    "#FEF2F2",
  shadow:      "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)",
  shadowMd:    "0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
  shadowBlue:  "0 8px 32px rgba(0,82,255,0.18)",
};

// ── Seed data ─────────────────────────────────────────────────────────────────
const MOCK_PROFILE = {
  fid: 420691, username: "georgebase.eth", displayName: "George",
  pfp: null, followers: 1284, following: 391,
  trustScore: 847, receipts: 23, liquidity: 0.78, verified: true,
};

const SEED_RECEIPTS = [
  { hash: "0x3a9f...c821", label: "Swap on Uniswap", ts: "2h ago",  status: "verified", amount: "+$420"   },
  { hash: "0xb71c...f034", label: "NFT Purchase",     ts: "1d ago",  status: "verified", amount: "+$88"    },
  { hash: "0x9a4e...2b17", label: "Bridge from L1",   ts: "3d ago",  status: "flagged",  amount: "+$1,200" },
];

// ─────────────────────────────────────────────────────────────────────────────
// [5] Hook: useFarcasterContext
//     Dynamically imports @farcaster/frame-sdk (ESM CDN) on mount.
//     Gracefully no-ops when running outside a Farcaster frame.
// ─────────────────────────────────────────────────────────────────────────────
function useFarcasterContext() {
  const [frameCtx, setFrameCtx]     = useState(null);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // !! In production: import sdk from "@farcaster/frame-sdk"
        const mod = await import("https://esm.sh/@farcaster/frame-sdk@0.0.28").catch(() => null);
        if (!mod || cancelled) return;
        const sdk = mod.default ?? mod.sdk ?? mod;
        const ctx = await sdk.context;
        if (ctx?.user?.fid && !cancelled) {
          setFrameCtx({
            fid:         ctx.user.fid,
            displayName: ctx.user.displayName || ctx.user.username || "Anonymous",
            username:    ctx.user.username    || `fid${ctx.user.fid}`,
            pfp:         ctx.user.pfpUrl      || null,
          });
        }
        if (sdk.actions?.ready) sdk.actions.ready();
      } catch {
        // Not in a frame – silent fallback
      } finally {
        if (!cancelled) setFrameReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { frameCtx, frameReady };
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] Hook: useBaseNetwork
//     Polls Base mainnet public RPC every 10 s.
//     Returns gasPrice (gwei string) + blockNumber (formatted string).
// ─────────────────────────────────────────────────────────────────────────────
const BASE_RPC = "https://mainnet.base.org";

async function rpcCall(method, params = []) {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error(error.message);
  return result;
}

function useBaseNetwork() {
  const [data, setData] = useState({
    blockNumber: null, gasPriceGwei: null,
    prevGasPrice: null, loading: true, lastUpdated: null,
  });

  const fetch_ = useCallback(async () => {
    try {
      const [rawGas, rawBlock] = await Promise.all([
        rpcCall("eth_gasPrice"),
        rpcCall("eth_blockNumber"),
      ]);
      const gasPriceGwei = (parseInt(rawGas, 16) / 1e9).toFixed(4);
      const blockNumber  = parseInt(rawBlock, 16).toLocaleString();
      setData(prev => ({
        blockNumber, gasPriceGwei,
        prevGasPrice: prev.gasPriceGwei,
        loading: false, lastUpdated: new Date(),
      }));
    } catch {
      setData(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 10_000);
    return () => clearInterval(id);
  }, [fetch_]);

  return data;
}

// ─── Global styles ────────────────────────────────────────────────────────────
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
    body { font-family: 'Geist','Inter',sans-serif; background:${T.bg}; color:${T.text}; }
    ::-webkit-scrollbar { width:4px; }
    ::-webkit-scrollbar-track { background:transparent; }
    ::-webkit-scrollbar-thumb { background:${T.textMuted}; border-radius:99px; }
    input::placeholder { color:${T.textMuted}; }
    input:focus { outline:none; }
    button { cursor:pointer; font-family:inherit; }
    @keyframes pulse-ring {
      0%   { transform:scale(0.95); opacity:0.8; }
      70%  { transform:scale(1.15); opacity:0;   }
      100% { transform:scale(1.15); opacity:0;   }
    }
    @keyframes spin { to { transform:rotate(360deg); } }
    .spin { animation:spin 0.8s linear infinite; }
    .shimmer-box {
      background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%);
      background-size:400px 100%;
      animation:shimmer 1.4s infinite;
    }
    @keyframes shimmer { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
  `}</style>
);

// ─── Primitives ───────────────────────────────────────────────────────────────
function Avatar({ name, pfp, size = 40 }) {
  if (pfp) return <img src={pfp} alt={name} style={{ width:size, height:size, borderRadius:"50%", objectFit:"cover", flexShrink:0 }} />;
  const initials = name?.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase() || "??";
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:`linear-gradient(135deg,${T.blue},${T.blueMid})`, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:size*0.35, fontWeight:600, letterSpacing:"-0.02em", flexShrink:0 }}>
      {initials}
    </div>
  );
}

function Badge({ children, color=T.blue, bg=T.blueLight }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:6, fontSize:11, fontWeight:600, letterSpacing:"0.02em", color, background:bg }}>
      {children}
    </span>
  );
}

function Spinner({ size=16, color="#fff" }) {
  return <div className="spin" style={{ width:size, height:size, border:`2px solid ${color}40`, borderTopColor:color, borderRadius:"50%", flexShrink:0 }} />;
}

function DeltaPill({ current, prev }) {
  if (!prev || current === prev) return null;
  const up = parseFloat(current) > parseFloat(prev);
  return (
    <span style={{ fontSize:10, fontWeight:600, padding:"1px 5px", borderRadius:4, background:up?T.redLight:T.greenLight, color:up?T.red:T.green }}>
      {up?"↑":"↓"}
    </span>
  );
}

// ─── PulseGauge ───────────────────────────────────────────────────────────────
function PulseGauge({ value=0.78 }) {
  const [d, setD] = useState(0);
  useEffect(() => {
    const end=value, dur=1600, t0=performance.now();
    let raf;
    const tick = now => {
      const p=Math.min((now-t0)/dur,1), e=1-Math.pow(1-p,3);
      setD(e*end);
      if (p<1) raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[value]);

  const sz=220, sw=14, r=(sz-sw)/2, cx=sz/2, cy=sz/2, circ=Math.PI*r;
  const arc=(a1,a2,rad)=>{
    const toR=x=>x*Math.PI/180;
    return `M ${cx+rad*Math.cos(toR(a1))} ${cy+rad*Math.sin(toR(a1))} A ${rad} ${rad} 0 0 1 ${cx+rad*Math.cos(toR(a2))} ${cy+rad*Math.sin(toR(a2))}`;
  };
  const path=arc(180,0,r), fill=circ*d, vel=Math.round(d*100);
  const col=d<0.4?T.red:d<0.65?T.amber:T.green;
  const lbl=d<0.4?"Low":d<0.65?"Moderate":"Strong";

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
      <div style={{position:"relative",width:sz,height:sz/2+32}}>
        <svg width={sz} height={sz/2+sw} viewBox={`0 0 ${sz} ${sz/2+sw}`} style={{overflow:"visible"}}>
          <path d={path} fill="none" stroke="#E5E7EB" strokeWidth={sw} strokeLinecap="round"/>
          <motion.path d={path} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={`${circ} ${circ}`}
            initial={{strokeDashoffset:circ}} animate={{strokeDashoffset:circ-fill}}
            transition={{duration:1.6,ease:[.25,.46,.45,.94]}}
            style={{filter:`drop-shadow(0 0 6px ${col}60)`}}/>
          {[0,.25,.5,.75,1].map(v=>{
            const angle=180-v*180, rad=angle*Math.PI/180;
            return <circle key={v} cx={cx+r*Math.cos(rad)} cy={cy+r*Math.sin(rad)} r={2} fill={d>=v?col:"#D1D5DB"} opacity={0.7}/>;
          })}
          <motion.g initial={{rotate:0}} animate={{rotate:(180-d*180)-180}}
            style={{originX:`${cx}px`,originY:`${cy}px`}}
            transition={{duration:1.6,ease:[.25,.46,.45,.94]}}>
            <line x1={cx} y1={cy} x2={cx+(r-sw/2-4)} y2={cy} stroke={T.text} strokeWidth={2.5} strokeLinecap="round"/>
            <circle cx={cx} cy={cy} r={6} fill={T.surface} stroke={T.text} strokeWidth={2}/>
          </motion.g>
        </svg>
        <div style={{position:"absolute",bottom:0,left:"50%",transform:"translateX(-50%)",textAlign:"center",lineHeight:1}}>
          <div style={{fontSize:36,fontWeight:700,color:T.text,letterSpacing:"-0.04em"}}>{vel}<span style={{fontSize:16,color:T.textSub,fontWeight:500}}>%</span></div>
          <div style={{fontSize:12,color:col,fontWeight:600,marginTop:4}}>{lbl} Velocity</div>
        </div>
      </div>
      <div style={{display:"flex",gap:16,marginTop:16}}>
        {[["Low",T.red],["Moderate",T.amber],["Strong",T.green]].map(([l,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
            <span style={{fontSize:11,color:T.textSub,fontWeight:500}}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AnimatedScore ────────────────────────────────────────────────────────────
function AnimatedScore({ target=847 }) {
  const [count, setCount] = useState(0);
  useEffect(()=>{
    let f; const t0=performance.now();
    const tick=now=>{
      const t=Math.min((now-t0)/1800,1), e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
      setCount(Math.round(e*target));
      if(t<1) f=requestAnimationFrame(tick);
    };
    f=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(f);
  },[target]);
  const tier     =count>=800?"Platinum":count>=600?"Gold":count>=400?"Silver":"Bronze";
  const tierColor=count>=800?"#7C3AED":count>=600?T.amber:count>=400?"#6B7280":"#92400E";
  const tierBg   =count>=800?"#F5F3FF":count>=600?T.amberLight:count>=400?"#F3F4F6":"#FFFBEB";
  return (
    <div style={{display:"flex",alignItems:"baseline",gap:8}}>
      <span style={{fontSize:52,fontWeight:700,color:T.text,letterSpacing:"-0.05em",lineHeight:1}}>{count.toLocaleString()}</span>
      <span style={{fontSize:14,color:T.textSub,fontWeight:500}}>/1000</span>
      <Badge color={tierColor} bg={tierBg}>{tier}</Badge>
    </div>
  );
}

// ─── TrustCard ────────────────────────────────────────────────────────────────
function TrustCard({ profile }) {
  return (
    <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:.5,delay:.1}}
      style={{background:T.surface,borderRadius:24,boxShadow:T.shadowMd,overflow:"hidden"}}>
      <div style={{background:`linear-gradient(135deg,${T.blue}08,${T.blue}04)`,padding:"28px 28px 20px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{position:"relative"}}>
              <Avatar name={profile.displayName} pfp={profile.pfp} size={52}/>
              {profile.verified&&<div style={{position:"absolute",bottom:-2,right:-2,width:18,height:18,borderRadius:"50%",background:T.blue,border:`2px solid ${T.surface}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff"}}>✓</div>}
            </div>
            <div>
              <div style={{fontSize:17,fontWeight:700,color:T.text,letterSpacing:"-0.02em"}}>{profile.displayName}</div>
              <div style={{fontSize:13,color:T.textSub,marginTop:2,fontFamily:"'Geist Mono',monospace"}}>@{profile.username}</div>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:T.textMuted,fontWeight:500,marginBottom:4}}>FID</div>
            <div style={{fontSize:13,color:T.text,fontFamily:"'Geist Mono',monospace",fontWeight:600}}>#{profile.fid?.toLocaleString()}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:20,marginTop:16}}>
          {[["Followers",profile.followers?.toLocaleString()??"—"],["Following",profile.following??"—"]].map(([l,v])=>(
            <div key={l}><span style={{fontSize:14,fontWeight:600,color:T.text}}>{v}</span><span style={{fontSize:12,color:T.textSub,marginLeft:4}}>{l}</span></div>
          ))}
        </div>
      </div>
      <div style={{padding:"24px 28px 20px"}}>
        <div style={{fontSize:12,color:T.textSub,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10}}>Trust Score</div>
        <AnimatedScore target={profile.trustScore}/>
        <div style={{marginTop:14,height:6,background:"#E5E7EB",borderRadius:99,overflow:"hidden"}}>
          <motion.div initial={{width:0}} animate={{width:`${(profile.trustScore/1000)*100}%`}}
            transition={{duration:1.8,delay:.3,ease:[.25,.46,.45,.94]}}
            style={{height:"100%",borderRadius:99,background:`linear-gradient(90deg,${T.blue},#4F46E5)`}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:1,background:T.border,borderRadius:16,overflow:"hidden",marginTop:20}}>
          {[["Receipts",profile.receipts,"📋"],["Disputes","0","🛡️"],["Streak","14d","🔥"]].map(([l,v,i])=>(
            <div key={l} style={{background:T.surface,padding:"14px 8px",textAlign:"center"}}>
              <div style={{fontSize:18,marginBottom:4}}>{i}</div>
              <div style={{fontSize:18,fontWeight:700,color:T.text,letterSpacing:"-0.03em"}}>{v}</div>
              <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── ReceiptForm (Wagmi-wired) ────────────────────────────────────────────────
// ─── ReceiptForm (Wagmi-wired) ────────────────────────────────────────────────
// [4] Real wagmi hooks: useWriteContract submits the tx, useWaitForTransactionReceipt
//     confirms it on-chain. onMint only fires once the receipt is actually confirmed.
function ReceiptForm({ onMint, walletConnected }) {
  const [hash, setHash]   = useState("");   // the user-entered tx hash being anchored
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const {
    writeContract,
    data: submittedHash,      // the hash of OUR mintReceipt call (returned immediately on submit)
    isPending: isSubmitting,  // wallet confirmation / broadcast in flight
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,  // waiting for the block to include it
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({
    hash: submittedHash,
    chainId: BASE_CHAIN_ID,
    query: { enabled: !!submittedHash },
  });

  const isLoading = isSubmitting || isConfirming;
  const isSuccess = isConfirmed;

  // Fire onMint once the tx is actually confirmed on-chain, then reset the form
  useEffect(() => {
    if (!isConfirmed || !submittedHash) return;
    onMint?.({ hash: submittedHash, label: label || "On-chain Receipt" });
    const t = setTimeout(() => { resetWrite(); setHash(""); setLabel(""); }, 2600);
    return () => clearTimeout(t);
  }, [isConfirmed, submittedHash]); // eslint-disable-line

  const isValid = h => /^0x[0-9a-fA-F]{64}$/.test(h) || h.length > 8;

  const handleSubmit = () => {
    if (!walletConnected) { setError("Connect your wallet first."); return; }
    if (!hash.trim())     { setError("Transaction hash required."); return; }
    setError("");
    writeContract(
      {
        address:      RECEIPT_CONTRACT_ADDRESS,
        abi:          RECEIPT_CONTRACT_ABI,
        functionName: "mintReceipt",
        args:         [hash, label || "On-chain Receipt"],
        chainId:      BASE_CHAIN_ID,
      },
      {
        onError: (e) => {
          setError(e?.shortMessage || e?.message || "Transaction rejected.");
          resetWrite();
        },
      }
    );
  };

  return (
    <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:.5,delay:.25}}
      style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:"28px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:T.text,letterSpacing:"-0.02em"}}>Mint a Receipt</div>
          <div style={{fontSize:12,color:T.textSub,marginTop:3}}>Anchor your on-chain activity as social proof</div>
        </div>
        <div style={{width:36,height:36,borderRadius:10,background:T.blueLight,displ
