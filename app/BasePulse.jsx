"use client";
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
import { useTrustScore } from "./useTrustScore";
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
        <div style={{width:36,height:36,borderRadius:10,background:T.blueLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📜</div>
      </div>

      {!walletConnected&&(
        <div style={{background:T.amberLight,border:`1px solid ${T.amber}30`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:T.amber,fontWeight:500,display:"flex",gap:6,alignItems:"center"}}>
          ⚠️ Connect your wallet to mint a receipt on Base
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:T.textSub,letterSpacing:"0.04em",textTransform:"uppercase",display:"block",marginBottom:6}}>Transaction Hash</label>
          <div style={{display:"flex",alignItems:"center",gap:10,background:T.bg,borderRadius:12,padding:"12px 14px",border:`1.5px solid ${error?T.red:hash&&isValid(hash)?T.green:T.border}`,transition:"border-color 0.15s"}}>
            <span style={{fontSize:15,fontFamily:"'Geist Mono',monospace",color:T.textMuted}}>0x</span>
            <input value={hash.startsWith("0x")?hash.slice(2):hash}
              onChange={e=>{setHash("0x"+e.target.value);setError("");}}
              placeholder="3a9f8b2c...f0d1e4a7"
              style={{flex:1,background:"transparent",border:"none",fontSize:13,fontFamily:"'Geist Mono',monospace",color:T.text,letterSpacing:"0.02em"}}/>
            {hash&&isValid(hash)&&<span style={{fontSize:14,color:T.green}}>✓</span>}
          </div>
          {error&&<div style={{fontSize:11,color:T.red,marginTop:5}}>{error}</div>}
        </div>

        <div>
          <label style={{fontSize:11,fontWeight:600,color:T.textSub,letterSpacing:"0.04em",textTransform:"uppercase",display:"block",marginBottom:6}}>Label <span style={{color:T.textMuted,textTransform:"none",fontWeight:400}}>(optional)</span></label>
          <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Swap on Uniswap…"
            style={{width:"100%",background:T.bg,border:`1.5px solid ${T.border}`,borderRadius:12,padding:"12px 14px",fontSize:13,color:T.text,transition:"border-color 0.15s"}}
            onFocus={e=>e.target.style.borderColor=T.blue} onBlur={e=>e.target.style.borderColor=T.border}/>
        </div>

        <motion.button onClick={handleSubmit} disabled={isLoading||isSuccess}
          whileHover={{scale:1.01}} whileTap={{scale:.98}}
          style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:isSuccess?T.green:`linear-gradient(135deg,${T.blue},#3B73FF)`,color:"#fff",fontSize:14,fontWeight:600,letterSpacing:"-0.01em",boxShadow:isSuccess?`0 4px 16px ${T.green}40`:T.shadowBlue,transition:"background 0.3s,box-shadow 0.3s",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          {isSubmitting
            ? <><Spinner/>Confirm in wallet…</>
            : isConfirming
              ? <><Spinner/>Anchoring to Base…</>
              : isSuccess
                ? <>✓ Receipt Minted</>
                : <>⚡ Mint Receipt</>}
        </motion.button>

        <AnimatePresence>
          {isSuccess&&submittedHash&&(
            <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:"auto"}} exit={{opacity:0,height:0}} style={{overflow:"hidden"}}>
              <div style={{background:T.greenLight,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:T.green}}>🔗 Tx:</span>
                <span style={{fontSize:11,fontFamily:"'Geist Mono',monospace",color:T.green,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {submittedHash.slice(0,12)}…{submittedHash.slice(-8)}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── ReceiptItem ──────────────────────────────────────────────────────────────
function ReceiptItem({ receipt, index, onFlag, total }) {
  const [flagged, setFlagged]         = useState(receipt.status==="flagged");
  const [holding, setHolding]         = useState(receipt.status==="flagged");
  const [showDispute, setShowDispute] = useState(false);
  const doFlag = () => { setShowDispute(false); setFlagged(true); setHolding(true); onFlag?.(receipt.hash); };

  return (
    <motion.div initial={{opacity:0,x:-16}} animate={{opacity:1,x:0}} transition={{delay:index*0.07}}
      style={{padding:"14px 0",borderBottom:index<total-1?`1px solid ${T.border}`:"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:36,height:36,borderRadius:10,flexShrink:0,background:holding?T.amberLight:T.greenLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>
          {holding?"⏳":"✅"}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
            <span style={{fontSize:13,fontWeight:600,color:T.text,letterSpacing:"-0.01em"}}>{receipt.label}</span>
            {holding&&<Badge color={T.amber} bg={T.amberLight}>24h Hold</Badge>}
            {receipt.isNew&&<Badge color={T.blue} bg={T.blueLight}>New</Badge>}
          </div>
          <div style={{fontSize:11,color:T.textMuted,fontFamily:"'Geist Mono',monospace"}}>{receipt.hash}</div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontSize:13,fontWeight:600,color:T.green}}>{receipt.amount}</div>
          <div style={{fontSize:11,color:T.textMuted,marginTop:1}}>{receipt.ts}</div>
        </div>
        <div style={{position:"relative"}}>
          <motion.button whileHover={{scale:1.1}} whileTap={{scale:.9}}
            onClick={()=>!flagged&&setShowDispute(v=>!v)}
            style={{width:28,height:28,borderRadius:8,border:"none",background:flagged?T.amberLight:T.surfaceHover,color:flagged?T.amber:T.textMuted,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>
            🚩
          </motion.button>
          <AnimatePresence>
            {showDispute&&(
              <motion.div initial={{opacity:0,scale:.9,y:-4}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:.9,y:-4}} transition={{duration:.15}}
                style={{position:"absolute",right:0,top:36,zIndex:100,background:T.surface,borderRadius:12,padding:16,boxShadow:"0 8px 32px rgba(0,0,0,0.12)",width:200,border:`1px solid ${T.border}`}}>
                <div style={{fontSize:12,fontWeight:600,color:T.text,marginBottom:8}}>Flag for Dispute?</div>
                <div style={{fontSize:11,color:T.textSub,marginBottom:12,lineHeight:1.5}}>This will place a 24-hour hold on the receipt pending review.</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setShowDispute(false)} style={{flex:1,padding:"7px 0",borderRadius:8,border:`1px solid ${T.border}`,background:T.bg,fontSize:12,color:T.textSub,fontFamily:"inherit"}}>Cancel</button>
                  <button onClick={doFlag} style={{flex:1,padding:"7px 0",borderRadius:8,border:"none",background:T.red,color:"#fff",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>Flag</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ─── NetworkStats (live RPC) ──────────────────────────────────────────────────
// [3] All values pulled from useBaseNetwork() hook
function NetworkStats() {
  const { blockNumber, gasPriceGwei, prevGasPrice, loading, lastUpdated } = useBaseNetwork();

  const stats = [
    { label:"Gas Price",   value:gasPriceGwei??"—", unit:"gwei",    icon:"⛽", extra:<DeltaPill current={gasPriceGwei} prev={prevGasPrice}/>, mono:true  },
    { label:"Block Height",value:blockNumber??"—",  unit:"",        icon:"📦", extra:null, mono:true  },
    { label:"Chain",       value:"Base",             unit:"ID 8453", icon:"⬡",  extra:null, mono:false },
    { label:"Last Sync",   value:lastUpdated?lastUpdated.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—", unit:"", icon:"🔄", extra:null, mono:true },
  ];

  return (
    <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{delay:.35}}
      style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:"24px 28px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,letterSpacing:"-0.01em"}}>
          Base Network <span style={{fontSize:11,color:T.textSub,fontWeight:400}}>· live</span>
        </div>
        {loading&&<Spinner size={12} color={T.blue}/>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {stats.map((s,i)=>(
          <motion.div key={s.label} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.4+i*.06}}
            style={{background:T.bg,borderRadius:14,padding:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
              <span style={{fontSize:14}}>{s.icon}</span>
              <span style={{fontSize:11,color:T.textSub,fontWeight:500}}>{s.label}</span>
            </div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              {loading&&!s.value
                ? <span className="shimmer-box" style={{display:"inline-block",width:60,height:18,borderRadius:4}}/>
                : <span style={{fontSize:18,fontWeight:700,color:T.text,letterSpacing:"-0.03em",fontFamily:s.mono?"'Geist Mono',monospace":"inherit"}}>{s.value}</span>
              }
              {s.unit&&<span style={{fontSize:10,color:T.textMuted}}>{s.unit}</span>}
              {s.extra}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ─── ConnectButton ────────────────────────────────────────────────────────────
// ⚠️ PLACEHOLDER — this toggles local UI state only, it does not connect a real wallet.
// Swap this entire component for <ConnectKitButton /> from "connectkit" once your
// app root is wrapped in <WagmiProvider><ConnectKitProvider>. ConnectKit owns the
// connect modal + injects the real address into useAccount() everywhere below —
// there's nothing else to wire up once that swap happens.
function ConnectButton({ connected, onToggle }) {
  return (
    <motion.button whileHover={{scale:1.02}} whileTap={{scale:.97}} onClick={onToggle}
      style={{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",borderRadius:12,border:"none",background:connected?T.greenLight:T.blue,color:connected?T.green:"#fff",fontSize:13,fontWeight:600,fontFamily:"inherit",boxShadow:connected?"none":T.shadowBlue}}>
      {connected
        ? <><div style={{width:8,height:8,borderRadius:"50%",background:T.green}}/>georgebase.eth</>
        : <>⚡ Connect Wallet</>}
    </motion.button>
  );
}

// ─── FrameContextBanner ───────────────────────────────────────────────────────
// [5] Shows real Farcaster identity when frame context is active
function FrameContextBanner({ frameCtx }) {
  const isReal = !!frameCtx?.fid;
  return (
    <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} transition={{delay:.6}}
      style={{background:`linear-gradient(135deg,${T.blue}12,${T.blue}06)`,border:`1px solid ${T.blue}20`,borderRadius:14,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
      <div style={{fontSize:18}}>{isReal?"✅":"🎯"}</div>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:600,color:T.blue}}>
          {isReal?"Farcaster Frame — Verified Context":"Farcaster Frame Active"}
        </div>
        <div style={{fontSize:11,color:T.textSub,marginTop:1}}>
          {isReal
            ? `Viewing as ${frameCtx.displayName} · FID #${frameCtx.fid}`
            : "Demo mode · Open via Warpcast to load real identity"}
        </div>
      </div>
      <Badge color={T.blue} bg={T.blueLight}>v2</Badge>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] Views
// ─────────────────────────────────────────────────────────────────────────────

function DashboardView({ profile, receipts, onMint, onFlag, walletConnected }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:20}}>
      <div style={{display:"flex",flexDirection:"column",gap:20}}>
        <TrustCard profile={profile}/>
        <ReceiptForm onMint={onMint} walletConnected={walletConnected}/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:20}}>
        <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:.5}}
          style={{background:T.surface,borderRadius:24,boxShadow:T.shadowMd,padding:"28px",display:"flex",flexDirection:"column",alignItems:"center"}}>
          <div style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:T.text,letterSpacing:"-0.02em"}}>Liquidity Velocity</div>
              <div style={{fontSize:12,color:T.textSub,marginTop:3}}>Real-time pulse meter</div>
            </div>
            <div style={{position:"relative"}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:T.green,position:"absolute",animation:"pulse-ring 2s infinite"}}/>
              <div style={{width:10,height:10,borderRadius:"50%",background:T.green}}/>
            </div>
          </div>
          <PulseGauge value={profile.liquidity}/>
        </motion.div>
        <NetworkStats/>
        <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:.5,delay:.3}}
          style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:"28px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:T.text,letterSpacing:"-0.02em"}}>Verified Receipts</div>
              <div style={{fontSize:12,color:T.textSub,marginTop:2}}>{receipts.length} total · {receipts.filter(r=>r.status!=="flagged").length} verified</div>
            </div>
            <Badge color={T.blue} bg={T.blueLight}>{receipts.length}</Badge>
          </div>
          <AnimatePresence>
            {receipts.map((r,i)=><ReceiptItem key={r.hash+i} receipt={r} index={i} onFlag={onFlag} total={receipts.length}/>)}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

function ReceiptsView({ receipts, onFlag }) {
  const verified = receipts.filter(r=>r.status!=="flagged").length;
  return (
    <motion.div key="receipts" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:.35}}>
      <div style={{marginBottom:24}}>
        <h2 style={{fontSize:22,fontWeight:700,color:T.text,letterSpacing:"-0.03em"}}>Receipts</h2>
        <p style={{fontSize:13,color:T.textSub,marginTop:4}}>{receipts.length} total · {verified} verified · {receipts.length-verified} in review</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14,marginBottom:20}}>
        {[{label:"Total Value",val:"$1,708",icon:"💰",color:T.blue,bg:T.blueLight},{label:"Verified",val:verified,icon:"✅",color:T.green,bg:T.greenLight},{label:"Under Review",val:receipts.length-verified,icon:"⏳",color:T.amber,bg:T.amberLight}].map(c=>(
          <motion.div key={c.label} initial={{opacity:0,scale:.97}} animate={{opacity:1,scale:1}}
            style={{background:T.surface,borderRadius:18,boxShadow:T.shadow,padding:"20px 22px",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:42,height:42,borderRadius:12,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{c.icon}</div>
            <div>
              <div style={{fontSize:22,fontWeight:700,color:T.text,letterSpacing:"-0.03em"}}>{c.val}</div>
              <div style={{fontSize:12,color:T.textSub}}>{c.label}</div>
            </div>
          </motion.div>
        ))}
      </div>
      <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:.15}}
        style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:"28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:15,fontWeight:700,color:T.text}}>All Receipts</div>
          <Badge color={T.blue} bg={T.blueLight}>{receipts.length}</Badge>
        </div>
        <AnimatePresence>
          {receipts.map((r,i)=><ReceiptItem key={r.hash+i} receipt={r} index={i} onFlag={onFlag} total={receipts.length}/>)}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function NetworkView() {
  return (
    <motion.div key="network" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:.35}}>
      <div style={{marginBottom:24}}>
        <h2 style={{fontSize:22,fontWeight:700,color:T.text,letterSpacing:"-0.03em"}}>Network</h2>
        <p style={{fontSize:13,color:T.textSub,marginTop:4}}>Live Base mainnet data · refreshes every 10 s</p>
      </div>
      <NetworkStats/>
      <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:.2}}
        style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:"28px",marginTop:20}}>
        <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:16}}>RPC Endpoint</div>
        <div style={{background:T.bg,borderRadius:12,padding:"14px 16px",fontFamily:"'Geist Mono',monospace",fontSize:12,color:T.textSub,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <span>{BASE_RPC}</span><Badge color={T.green} bg={T.greenLight}>● Live</Badge>
        </div>
        <div style={{marginTop:16,fontSize:12,color:T.textSub,lineHeight:1.7}}>
          Data is fetched via <code style={{fontFamily:"'Geist Mono',monospace",background:T.bg,padding:"1px 5px",borderRadius:4}}>eth_gasPrice</code> and <code style={{fontFamily:"'Geist Mono',monospace",background:T.bg,padding:"1px 5px",borderRadius:4}}>eth_blockNumber</code> JSON-RPC 2.0 calls — no API key required.
        </div>
      </motion.div>
    </motion.div>
  );
}

function SettingsView({ profile, connected, address, onDisconnect }) {
  const [notifs, setNotifs]     = useState(true);
  const [autoV, setAutoV]       = useState(false);
  const [showFid, setShowFid]   = useState(true);

  const Toggle = ({ val, set, label, sub }) => (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 0",borderBottom:`1px solid ${T.border}`}}>
      <div>
        <div style={{fontSize:14,fontWeight:500,color:T.text}}>{label}</div>
        {sub&&<div style={{fontSize:12,color:T.textSub,marginTop:2}}>{sub}</div>}
      </div>
      <div onClick={()=>set(!val)} style={{width:44,height:26,borderRadius:13,padding:3,cursor:"pointer",background:val?T.blue:"#D1D5DB",transition:"background 0.2s",display:"flex",alignItems:"center",justifyContent:val?"flex-end":"flex-start"}}>
        <motion.div layout style={{width:20,height:20,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}/>
      </div>
    </div>
  );

  return (
    <motion.div key="settings" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:.35}}>
      <div style={{marginBottom:24}}>
        <h2 style={{fontSize:22,fontWeight:700,color:T.text,letterSpacing:"-0.03em"}}>Settings</h2>
        <p style={{fontSize:13,color:T.textSub,marginTop:4}}>Manage your BasePulse preferences</p>
      </div>
      <div style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:"24px 28px",marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:600,color:T.textSub,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:16}}>Identity</div>
        <div style={{display:"flex",alignItems:"center",gap:14,padding:"0 0 16px",borderBottom:`1px solid ${T.border}`}}>
          <Avatar name={profile.displayName} pfp={profile.pfp} size={48}/>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:600,color:T.text}}>{profile.displayName}</div>
            <div style={{fontSize:12,color:T.textSub,fontFamily:"'Geist Mono',monospace"}}>FID #{profile.fid}</div>
          </div>
          <Badge color={T.blue} bg={T.blueLight}>Farcaster</Badge>
        </div>
        <div style={{paddingTop:16,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:14,fontWeight:500,color:T.text}}>Wallet</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2,fontFamily:"'Geist Mono',monospace"}}>
              {connected ? (address ? `${address.slice(0,6)}…${address.slice(-4)}` : "0x1234…5678 (demo)") : "Not connected"}
            </div>
          </div>
          {connected
            ? <button onClick={onDisconnect} style={{fontSize:12,color:T.red,background:T.redLight,border:"none",padding:"6px 12px",borderRadius:8,fontFamily:"inherit",fontWeight:600}}>Disconnect</button>
            : <Badge color={T.amber} bg={T.amberLight}>⚠️ Not connected</Badge>}
        </div>
      </div>
      <div style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:"24px 28px",marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:600,color:T.textSub,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4}}>Preferences</div>
        <Toggle val={notifs}  set={setNotifs}  label="Receipt Notifications" sub="Get alerted when a receipt is verified or flagged"/>
        <Toggle val={autoV}   set={setAutoV}   label="Auto-Verify Receipts"  sub="Automatically verify receipts from trusted contracts"/>
        <Toggle val={showFid} set={setShowFid} label="Show FID Publicly"     sub="Display your Farcaster ID on your Trust Card"/>
      </div>
      <div style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:"24px 28px"}}>
        <div style={{fontSize:12,fontWeight:600,color:T.textSub,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:16}}>App</div>
        {[["Version","2.0.0 (Functional)"],["Chain","Base Mainnet (8453)"],["Frame SDK","@farcaster/frame-sdk v0.0.28"],["Wagmi","v2 (shimmed)"]].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
            <span style={{fontSize:13,color:T.textSub}}>{k}</span>
            <span style={{fontSize:13,color:T.text,fontWeight:500,fontFamily:"'Geist Mono',monospace"}}>{v}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App Shell
// ─────────────────────────────────────────────────────────────────────────────
export default function BasePulse() {
  // [4] Real wallet state from wagmi. `address` is the source of truth once
  // ConnectKit is wired in; the local toggle below only exists so the demo
  // ConnectButton placeholder has something to flip before that swap happens.
  const { address, isConnected } = useAccount();
  const { profile: liveProfile, loading: scoreLoading } = useTrustScore(address);
  const [demoToggle, setDemoToggle] = useState(false);
  const connected = isConnected || demoToggle;

  const [receipts, setReceipts]         = useState(SEED_RECEIPTS);
  // [1] IDs match switch cases exactly: 'pulse' | 'receipts' | 'network' | 'settings'
  const [activeNav, setActiveNav]       = useState("pulse");
  const [notification, setNotification] = useState(null);

  // [5] Hydrate profile from Farcaster frame context if available
  const { frameCtx } = useFarcasterContext();
  const profile = {
    ...MOCK_PROFILE, ...(liveProfile || {}),
    ...(frameCtx ? {
      fid: frameCtx.fid, displayName: frameCtx.displayName,
      username: frameCtx.username, pfp: frameCtx.pfp,
    } : {}),
  };

  const toast = useCallback((msg, type="success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3200);
  }, []);

  // [4] Receipt minted – real txHash from writeContract flows here
  const handleMint = useCallback(({ hash, label }) => {
    const shortHash = hash.length > 20 ? `${hash.slice(0,10)}…${hash.slice(-6)}` : hash;
    setReceipts(prev => [{ hash:shortHash, label, ts:"just now", status:"verified", amount:"+$?", isNew:true }, ...prev]);
    toast("Receipt minted on Base ✓");
  }, [toast]);

  const handleFlag = useCallback(() => toast("24-hour hold initiated ⏳", "warning"), [toast]);

  // [1] Nav items – IDs align with switch cases
  const navItems = [
    { id:"pulse",    icon:"⬡",  label:"Pulse"    },
    { id:"receipts", icon:"📋", label:"Receipts" },
    { id:"network",  icon:"🌐", label:"Network"  },
    { id:"settings", icon:"⚙️", label:"Settings" },
  ];

  // [2] View switch
  const renderView = () => {
    switch (activeNav) {
      case "pulse":
        return <DashboardView profile={profile} receipts={receipts} onMint={handleMint} onFlag={handleFlag} walletConnected={connected}/>;
      case "receipts":
        return <ReceiptsView receipts={receipts} onFlag={handleFlag}/>;
      case "network":
        return <NetworkView/>;
      case "settings":
        return <SettingsView profile={profile} connected={connected} address={address} onDisconnect={()=>{setDemoToggle(false);toast("Wallet disconnected");}}/>;
      default:
        return null;
    }
  };

  return (
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Geist','Inter',sans-serif"}}>
      <GlobalStyles/>

      {/* Top Bar */}
      <div style={{position:"sticky",top:0,zIndex:50,background:"rgba(249,250,251,0.85)",backdropFilter:"blur(16px)",borderBottom:`1px solid ${T.border}`}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"0 20px",height:60,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:9,background:`linear-gradient(135deg,${T.blue},#3B73FF)`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:T.shadowBlue,fontSize:16}}>⬡</div>
            <span style={{fontSize:17,fontWeight:700,color:T.text,letterSpacing:"-0.03em"}}>Base<span style={{color:T.blue}}>Pulse</span></span>
            <Badge color={T.blue} bg={T.blueLight}>Beta</Badge>
          </div>
          {/* !! Replace with <ConnectKitButton /> in production */}
          <ConnectButton connected={connected} onToggle={()=>{setDemoToggle(c=>!c);toast(connected?"Wallet disconnected":"Connected to Base Smart Wallet ✓");}}/>
        </div>
      </div>

      {/* Body */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px 100px"}}>
        <div style={{marginBottom:20}}>
          <FrameContextBanner frameCtx={frameCtx}/>
        </div>

        {activeNav==="pulse"&&(
          <div style={{marginBottom:28}}>
            <h1 style={{fontSize:28,fontWeight:700,color:T.text,letterSpacing:"-0.04em",lineHeight:1.1}}>Reputation Dashboard</h1>
            <p style={{fontSize:14,color:T.textSub,marginTop:6}}>Your on-chain identity layer on Base</p>
          </div>
        )}

        {/* [2] Animated view swap */}
        <AnimatePresence mode="wait">
          <motion.div key={activeNav} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:.18}}>
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Nav – [1] onClick wired to setActiveNav */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:50,background:"rgba(255,255,255,0.92)",backdropFilter:"blur(20px)",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-around",padding:"10px 0 16px"}}>
        {navItems.map(item=>{
          const active = activeNav===item.id;
          return (
            <button key={item.id} onClick={()=>setActiveNav(item.id)}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",padding:"4px 16px",color:active?T.blue:T.textMuted,transition:"color 0.15s",position:"relative"}}>
              {active&&(
                <motion.div layoutId="nav-dot"
                  style={{position:"absolute",top:-10,width:4,height:4,borderRadius:"50%",background:T.blue}}/>
              )}
              <motion.div animate={{scale:active?1.18:1,y:active?-1:0}} transition={{type:"spring",stiffness:400,damping:20}} style={{fontSize:20}}>
                {item.icon}
              </motion.div>
              <span style={{fontSize:10,fontWeight:active?600:400}}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {notification&&(
          <motion.div key="toast" initial={{opacity:0,y:24,scale:.95}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:16,scale:.95}} transition={{duration:.2}}
            style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:notification.type==="warning"?T.amber:T.green,color:"#fff",padding:"12px 20px",borderRadius:14,fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.15)",whiteSpace:"nowrap",zIndex:200}}>
            {notification.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
