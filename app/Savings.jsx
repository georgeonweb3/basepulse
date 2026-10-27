"use client";
/**
 * Streak savings UI: hero, my savings, daily save (permit → one tx), withdraw, share, circles.
 * All writes go through useSavings hooks, which append the ERC-8021 Builder Code (DATA_SUFFIX).
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { T, Badge, Spinner, Card, Notice, PrimaryButton, inputStyle, labelStyle } from "./ui";
import {
  SAVINGS_ADDRESS, DAILY_PRESETS, MIN_DAILY_USD, MAX_DAILY_USD, CIRCLE_NAME_MAX, CIRCLE_GOAL_MAX, USDC_DECIMALS, APP_URL,
} from "./savingsConfig";
import {
  fmtUsd, parseUsd, useUtcCountdown, useSavingsData, useEnsureBase, useSaveAction, useSavingsWrite, useCircle,
} from "./useSavings";

const BASESCAN = "https://basescan.org";
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const usdInput = (units) => (units ? String(Number(formatUnits(units, USDC_DECIMALS))) : "");

function appOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return APP_URL;
}
export const circleLink = (id) => `${appOrigin()}/?circle=${id}`;

// ── Hero ──────────────────────────────────────────────────────────────────────
export function SavingsHero({ isConnected, streak }) {
  return (
    <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:.45}}
      style={{background:`linear-gradient(145deg,${T.blue},#3B73FF 60%,#6D8CFF)`,borderRadius:28,padding:"28px 22px",color:"#fff",boxShadow:T.shadowBlue,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",right:-40,top:-40,width:180,height:180,borderRadius:"50%",background:"rgba(255,255,255,0.08)"}}/>
      <div style={{position:"absolute",right:30,bottom:-60,width:140,height:140,borderRadius:"50%",background:"rgba(255,255,255,0.06)"}}/>
      <div style={{position:"relative"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.16)",padding:"4px 10px",borderRadius:99,fontSize:11,fontWeight:600,marginBottom:14}}>
          🔥 Streak savings · USDC on Base
        </div>
        <h1 style={{fontSize:"clamp(26px,7vw,38px)",fontWeight:700,letterSpacing:"-0.04em",lineHeight:1.08}}>
          Save a little every day.<br/>Earn yield. Keep your streak.
        </h1>
        <p style={{fontSize:14,opacity:.85,marginTop:10,lineHeight:1.5,maxWidth:460}}>
          Put aside as little as $0.10 a day. Your USDC earns Aave v3 yield on Base, and you can withdraw anytime.
        </p>
        <div style={{marginTop:18}}>
          {isConnected ? (
            <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.16)",padding:"8px 14px",borderRadius:12,fontSize:13,fontWeight:600}}>
              {streak > 0 ? <>🔥 {streak}-day streak</> : <>Ready to start your streak</>}
            </div>
          ) : (
            <ConnectButton.Custom>
              {({ openConnectModal, mounted }) => (
                <button onClick={openConnectModal} disabled={!mounted}
                  style={{background:"#fff",color:T.blue,border:"none",padding:"13px 22px",borderRadius:14,fontSize:15,fontWeight:700,boxShadow:"0 6px 20px rgba(0,0,0,0.15)"}}>
                  Connect wallet to start
                </button>
              )}
            </ConnectButton.Custom>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Launching soon ────────────────────────────────────────────────────────────
export function LaunchingSoon() {
  const steps = [
    ["💵", "Pick a daily amount", "From $0.10 to $1,000 in USDC."],
    ["✍️", "Save once a day", "One signature + one transaction. No separate approval."],
    ["📈", "Earn Aave v3 yield", "Your savings are supplied to Aave v3 on Base."],
    ["👥", "Save with friends", "Create a Circle, share the link, climb the leaderboard."],
  ];
  return (
    <Card>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:6}}>
        <div style={{fontSize:17,fontWeight:700,letterSpacing:"-0.02em"}}>Savings launching soon</div>
        <Badge color={T.amber} bg={T.amberLight}>Coming soon</Badge>
      </div>
      <p style={{fontSize:13,color:T.textSub,lineHeight:1.5,marginBottom:16}}>
        The BasePulse savings contract isn&apos;t live on Base yet. Here&apos;s how it will work:
      </p>
      <div style={{display:"grid",gap:10}}>
        {steps.map(([i,t,s])=>(
          <div key={t} style={{display:"flex",gap:12,alignItems:"flex-start",background:T.bg,borderRadius:14,padding:"12px 14px"}}>
            <div style={{fontSize:20}}>{i}</div>
            <div><div style={{fontSize:13.5,fontWeight:600}}>{t}</div><div style={{fontSize:12,color:T.textSub,marginTop:2}}>{s}</div></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function WrongNetworkBanner() {
  const { wrongNetwork, ensureBase, switching } = useEnsureBase();
  const [err, setErr] = useState("");
  if (!wrongNetwork) return null;
  return (
    <Notice tone="red" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
      <span>{err || "Your wallet is on another network. BasePulse savings run on Base."}</span>
      <button onClick={()=>ensureBase().then(()=>setErr("")).catch(e=>setErr(e.message))} disabled={switching}
        style={{background:T.red,color:"#fff",border:"none",borderRadius:9,padding:"7px 12px",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>
        {switching ? "Switching…" : "Switch to Base"}
      </button>
    </Notice>
  );
}

// ── My savings ────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, accent }) {
  return (
    <div style={{background:T.bg,borderRadius:14,padding:"12px 14px",minWidth:0}}>
      <div style={{fontSize:11,color:T.textSub,fontWeight:500,marginBottom:4}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700,color:accent||T.text,letterSpacing:"-0.03em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{value}</div>
      {sub&&<div style={{fontSize:10.5,color:T.textMuted,marginTop:2}}>{sub}</div>}
    </div>
  );
}

export function MySavingsCard({ data, isConnected }) {
  const s = data.saver;
  const streak = data.currentStreak ?? 0;
  return (
    <Card>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em"}}>My savings</div>
        {data.loading && isConnected ? <Spinner size={14} color={T.blue}/> : <Badge color={T.green} bg={T.greenLight}>Aave v3 · Base</Badge>}
      </div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:12,color:T.textSub,fontWeight:500}}>Balance</div>
        <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:40,fontWeight:700,letterSpacing:"-0.05em",lineHeight:1.1}}>{isConnected ? fmtUsd(data.balance) : "$0.00"}</span>
          <span style={{fontSize:13,color:T.green,fontWeight:600}}>+{isConnected ? fmtUsd(data.earned,{precise:true}) : "$0.00"} earned</span>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
        <Stat label="🔥 Current streak" value={`${streak} day${streak===1?"":"s"}`} accent={streak>0?T.orange:undefined}/>
        <Stat label="🏆 Best streak" value={`${s?.bestStreak ?? 0} day${s?.bestStreak===1?"":"s"}`}/>
        <Stat label="📅 Days saved" value={s?.daysSaved ?? 0}/>
        <Stat label="💵 Daily amount" value={s?.dailyAmount ? fmtUsd(s.dailyAmount) : "Not set"}/>
      </div>
      <div style={{display:"flex",gap:16,marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}`,fontSize:12,color:T.textSub,flexWrap:"wrap"}}>
        <span><b style={{color:T.text}}>{data.totalSavers !== undefined ? Number(data.totalSavers).toLocaleString() : "—"}</b> savers</span>
        <span><b style={{color:T.text}}>{fmtUsd(data.totalAssets)}</b> total saved</span>
        {data.depositCap !== undefined && <span>Cap {fmtUsd(data.depositCap)}</span>}
      </div>
    </Card>
  );
}

// ── Save flow ─────────────────────────────────────────────────────────────────
const STAGE_TEXT = {
  switching: "Switching to Base…",
  signing: "Sign the USDC permit in your wallet…",
  approving: "Approve USDC in your wallet (step 1 of 2)…",
  saving: "Confirm the save in your wallet…",
};

export function SaveCard({ data, isConnected, onSaved }) {
  const { wrongNetwork } = useEnsureBase();
  const { run, stage, error, busy, reset } = useSaveAction();
  const countdown = useUtcCountdown();
  const current = data.saver?.dailyAmount || 0n;
  const [choice, setChoice] = useState(null); // "1" | "2" | "5" | "custom"
  const [custom, setCustom] = useState("");
  const [preview, setPreview] = useState(false);

  // Default to the saver's existing plan.
  useEffect(() => {
    if (choice !== null) return;
    if (!current) { setChoice("1"); return; }
    const v = usdInput(current);
    if (DAILY_PRESETS.includes(v)) setChoice(v); else { setChoice("custom"); setCustom(v); }
  }, [current, choice]);

  const parsed = parseUsd(choice === "custom" ? custom : choice || "1");
  const amount = parsed.units;
  const hasPlan = current > 0n;
  // canSaveToday is false for wallets that never set a plan, so only treat it as "saved" once a plan exists.
  const blockedToday = data.savedToday || (hasPlan && data.canSaveToday === false);
  const capLeft = data.depositCap !== undefined && data.totalAssets !== undefined ? data.depositCap - data.totalAssets : undefined;
  const capReached = capLeft !== undefined && amount !== undefined && capLeft < amount;
  const lowUsdc = data.usdcBalance !== undefined && amount !== undefined && data.usdcBalance < amount;
  const useAllowance = data.allowance !== undefined && amount !== undefined && data.allowance >= amount;

  const disabled = !isConnected || busy || blockedToday || !amount || capReached || lowUsdc;

  const confirm = async () => {
    const h = await run({ amount, usdcBalance: data.usdcBalance, allowance: data.allowance, totalAssets: data.totalAssets, depositCap: data.depositCap, savedToday: blockedToday });
    if (h) { setPreview(false); data.refetch(); onSaved?.(h); }
  };

  return (
    <Card>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
        <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em"}}>Save today</div>
        <div style={{fontSize:22}}>🐷</div>
      </div>
      <div style={{fontSize:12,color:T.textSub,marginBottom:14}}>Once per UTC day · keep the streak alive</div>

      {blockedToday ? (
        <div style={{background:T.greenLight,borderRadius:16,padding:"18px 16px",textAlign:"center"}}>
          <div style={{fontSize:26}}>✅</div>
          <div style={{fontSize:14,fontWeight:700,color:T.green,marginTop:4}}>Saved for today</div>
          <div style={{fontSize:12,color:T.textSub,marginTop:4}}>Next save opens in</div>
          <div style={{fontSize:26,fontWeight:700,fontFamily:"'Geist Mono',monospace",letterSpacing:"-0.02em",marginTop:2}}>{countdown.label}</div>
          <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>resets at 00:00 UTC</div>
        </div>
      ) : (
        <>
          <label style={labelStyle}>Daily amount</label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
            {[...DAILY_PRESETS, "custom"].map((p) => {
              const active = choice === p;
              return (
                <button key={p} onClick={()=>{setChoice(p); reset();}} disabled={busy}
                  style={{padding:"12px 0",borderRadius:12,border:`1.5px solid ${active?T.blue:T.border}`,background:active?T.blueLight:T.surface,color:active?T.blue:T.text,fontSize:14,fontWeight:600}}>
                  {p === "custom" ? "Custom" : `$${p}`}
                </button>
              );
            })}
          </div>
          {choice === "custom" && (
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6,...inputStyle,padding:"0 14px",borderColor:custom&&parsed.error?T.red:T.border}}>
                <span style={{color:T.textMuted,fontSize:15}}>$</span>
                <input inputMode="decimal" value={custom} onChange={e=>{setCustom(e.target.value.replace(/[^0-9.]/g,"")); reset();}} placeholder={`${MIN_DAILY_USD.toFixed(2)} – ${MAX_DAILY_USD}`}
                  style={{flex:1,border:"none",background:"transparent",fontSize:15,padding:"12px 0",color:T.text,fontFamily:"inherit"}}/>
                <span style={{fontSize:12,color:T.textMuted}}>USDC</span>
              </div>
              {custom && parsed.error && <div style={{fontSize:11.5,color:T.red,marginTop:5}}>{parsed.error}</div>}
            </div>
          )}
          {hasPlan && amount !== undefined && amount !== current && (
            <div style={{fontSize:12,color:T.textSub,marginBottom:10}}>This changes your daily plan from {fmtUsd(current)} to {fmtUsd(amount)}.</div>
          )}
          {isConnected && data.usdcBalance !== undefined && (
            <div style={{fontSize:12,color:lowUsdc?T.red:T.textSub,marginBottom:10}}>Wallet: {fmtUsd(data.usdcBalance)} USDC on Base{lowUsdc?" · not enough for this amount":""}</div>
          )}
        </>
      )}

      <div style={{display:"grid",gap:8,marginTop:blockedToday?12:4}}>
        {!isConnected && <Notice>Connect your wallet to start saving.</Notice>}
        {isConnected && wrongNetwork && !blockedToday && <Notice tone="red">You&apos;ll be asked to switch to Base before saving.</Notice>}
        {capReached && !blockedToday && <Notice tone="red">The savings pool is at its deposit cap{capLeft > 0n ? ` (only ${fmtUsd(capLeft)} left)` : ""}. Try a smaller amount or check back soon.</Notice>}
        {error && <Notice tone="red">{error}</Notice>}
      </div>

      {!blockedToday && (
        <div style={{marginTop:12}}>
          <PrimaryButton onClick={()=>{reset(); setPreview(true);}} disabled={disabled}>
            {amount ? <>Save {fmtUsd(amount)} today</> : <>Save today</>}
          </PrimaryButton>
        </div>
      )}

      <AnimatePresence>
        {preview && amount && (
          <motion.div key="preview" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            onClick={()=>!busy&&setPreview(false)}
            style={{position:"fixed",inset:0,zIndex:300,background:"rgba(17,24,39,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
            <motion.div initial={{y:40}} animate={{y:0}} exit={{y:40}} onClick={e=>e.stopPropagation()}
              style={{background:T.surface,width:"100%",maxWidth:480,borderRadius:"24px 24px 0 0",padding:"22px 20px 28px",boxShadow:T.shadowMd}}>
              <div style={{width:36,height:4,borderRadius:99,background:"#E5E7EB",margin:"0 auto 16px"}}/>
              <div style={{fontSize:17,fontWeight:700,letterSpacing:"-0.02em",marginBottom:4}}>Review your save</div>
              <div style={{fontSize:12.5,color:T.textSub,marginBottom:14}}>Nothing happens until you confirm in your wallet.</div>
              <div style={{background:T.bg,borderRadius:16,padding:"4px 14px",marginBottom:14}}>
                {[
                  ["Amount today", `${fmtUsd(amount)} USDC`],
                  ["Daily plan", `${fmtUsd(amount)} / day`],
                  ["Where it goes", "Aave v3 USDC market on Base"],
                  ["Via", <a key="c" href={`${BASESCAN}/address/${SAVINGS_ADDRESS}`} target="_blank" rel="noreferrer" style={{color:T.blue,textDecoration:"none"}}>BasePulseSavings {short(SAVINGS_ADDRESS)}</a>],
                  ["Withdraw", "Anytime, streak unaffected"],
                  ["Wallet steps", useAllowance ? "1 transaction" : "Sign permit + 1 transaction"],
                ].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"10px 0",borderBottom:`1px solid ${T.border}`,fontSize:13}}>
                    <span style={{color:T.textSub}}>{k}</span><span style={{fontWeight:600,textAlign:"right"}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11.5,color:T.textMuted,lineHeight:1.5,marginBottom:14}}>
                {useAllowance ? "You already approved enough USDC, so this is a single transaction."
                  : `The permit allows exactly ${fmtUsd(amount)} USDC and expires in 30 minutes. If your wallet can't sign permits, we'll ask for an exact-amount approval instead.`}
                {" "}Yield comes from Aave and isn&apos;t guaranteed. Smart contracts carry risk.
              </div>
              {error && <Notice tone="red" style={{marginBottom:12}}>{error}</Notice>}
              <PrimaryButton onClick={confirm} disabled={busy}>
                {busy ? <><Spinner/>{STAGE_TEXT[stage] || "Working…"}</> : <>Confirm & save {fmtUsd(amount)}</>}
              </PrimaryButton>
              <PrimaryButton tone="ghost" onClick={()=>setPreview(false)} disabled={busy} style={{marginTop:8}}>Cancel</PrimaryButton>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ── Withdraw ──────────────────────────────────────────────────────────────────
export function WithdrawCard({ data, isConnected, onDone }) {
  const { write, pending, error, setError } = useSavingsWrite();
  const [val, setVal] = useState("");
  const [max, setMax] = useState(false);
  const bal = data.balance ?? 0n;
  const parsed = parseUsd(val, { min: null, max: null });
  const tooMuch = parsed.units !== undefined && parsed.units > bal;
  const zero = parsed.units !== undefined && parsed.units === 0n;
  const canSubmit = isConnected && bal > 0n && !pending && (max || (parsed.units && !tooMuch && !zero));

  const submit = async () => {
    const h = max ? await write("withdrawAll") : await write("withdraw", [parsed.units]);
    if (h) { setVal(""); setMax(false); data.refetch(); onDone?.(max ? "all" : fmtUsd(parsed.units)); }
  };

  return (
    <Card>
      <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em"}}>Withdraw</div>
      <div style={{fontSize:12,color:T.textSub,marginTop:3,marginBottom:14}}>Back to your wallet anytime. Your streak stays.</div>
      <div style={{display:"flex",alignItems:"center",gap:6,...inputStyle,padding:"0 6px 0 14px",borderColor:(val&&!max&&(parsed.error||tooMuch))?T.red:T.border}}>
        <span style={{color:T.textMuted,fontSize:15}}>$</span>
        <input inputMode="decimal" value={max ? usdInput(bal) : val} disabled={!isConnected}
          onChange={e=>{setMax(false); setError(""); setVal(e.target.value.replace(/[^0-9.]/g,""));}} placeholder="0.00"
          style={{flex:1,minWidth:0,border:"none",background:"transparent",fontSize:15,padding:"12px 0",color:T.text,fontFamily:"inherit"}}/>
        <button onClick={()=>{setMax(true); setError("");}} disabled={!isConnected||bal===0n}
          style={{border:"none",background:max?T.blue:T.blueLight,color:max?"#fff":T.blue,fontSize:12,fontWeight:700,padding:"7px 12px",borderRadius:9}}>Max</button>
      </div>
      <div style={{fontSize:11.5,color:tooMuch?T.red:T.textMuted,marginTop:6}}>
        {tooMuch ? "That's more than your savings balance." : `Available: ${fmtUsd(bal)}`}
      </div>
      {error && <Notice tone="red" style={{marginTop:10}}>{error}</Notice>}
      <PrimaryButton tone="ghost" onClick={submit} disabled={!canSubmit} style={{marginTop:12}}>
        {pending ? <><Spinner color={T.blue}/>Confirm in wallet…</> : max ? <>Withdraw everything</> : <>Withdraw</>}
      </PrimaryButton>
    </Card>
  );
}

// ── Share streak ──────────────────────────────────────────────────────────────
async function getFarcasterSdk() {
  try {
    const mod = await import("@farcaster/frame-sdk");
    return mod.default ?? mod.sdk ?? mod;
  } catch { return null; }
}

export function ShareStreakCard({ streak, daysSaved, circleId, isMiniApp }) {
  const url = circleId ? circleLink(circleId) : appOrigin();
  const text = streak > 0
    ? `I'm on a ${streak}-day saving streak on BasePulse 🔥 Saving a little USDC every day on Base and earning yield.${circleId ? " Join my savings circle:" : " Join me:"}`
    : `I'm starting a daily saving streak on BasePulse 🐷 Save a little USDC every day on Base and earn yield.${circleId ? " Join my savings circle:" : ""}`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const wcUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(url)}`;

  const open = async (href, cast) => {
    if (isMiniApp) {
      const sdk = await getFarcasterSdk();
      try {
        if (cast && sdk?.actions?.composeCast) { await sdk.actions.composeCast({ text, embeds: [url] }); return; }
        if (sdk?.actions?.openUrl) { await sdk.actions.openUrl(href); return; }
      } catch { /* fall back to window.open */ }
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <Card>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <div style={{width:44,height:44,borderRadius:14,background:T.orangeLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🔥</div>
        <div>
          <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em"}}>Share your streak</div>
          <div style={{fontSize:12,color:T.textSub,marginTop:2}}>{streak > 0 ? `${streak}-day streak · ${daysSaved} days saved` : "Invite friends to save with you"}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <button onClick={()=>open(xUrl,false)} style={{padding:"12px",borderRadius:12,border:"none",background:"#111827",color:"#fff",fontSize:13,fontWeight:600}}>Share on X</button>
        <button onClick={()=>open(wcUrl,true)} style={{padding:"12px",borderRadius:12,border:"none",background:"#7C65C1",color:"#fff",fontSize:13,fontWeight:600}}>Share on Farcaster</button>
      </div>
    </Card>
  );
}

// ── Savings home (main product) ───────────────────────────────────────────────
export function SavingsHome({ deployment, isMiniApp, toast }) {
  const { address, isConnected } = useAccount();
  const live = deployment === "live";
  const data = useSavingsData(address, live);
  const streak = data.currentStreak ?? 0;

  return (
    <div style={{display:"grid",gap:16,maxWidth:560,margin:"0 auto"}}>
      <SavingsHero isConnected={isConnected} streak={streak}/>
      {deployment === "loading" && <Card><div style={{display:"flex",alignItems:"center",gap:10,fontSize:13,color:T.textSub}}><Spinner size={14} color={T.blue}/>Checking savings on Base…</div></Card>}
      {deployment === "missing" && <LaunchingSoon/>}
      {live && (
        <>
          {isConnected && <WrongNetworkBanner/>}
          <MySavingsCard data={data} isConnected={isConnected}/>
          <SaveCard data={data} isConnected={isConnected} onSaved={()=>toast?.(`Saved! 🔥 Streak: ${streak + 1} day${streak + 1 === 1 ? "" : "s"}`)}/>
          {isConnected && <WithdrawCard data={data} isConnected={isConnected} onDone={(a)=>toast?.(a === "all" ? "Withdrew everything to your wallet" : `Withdrew ${a} to your wallet`)}/>}
          {isConnected && <ShareStreakCard streak={streak} daysSaved={data.saver?.daysSaved ?? 0} circleId={data.saver?.circleId || 0} isMiniApp={isMiniApp}/>}
        </>
      )}
    </div>
  );
}

// ── Circles ───────────────────────────────────────────────────────────────────
function Leaderboard({ rows, me, goalDays }) {
  if (!rows.length) return <div style={{fontSize:12,color:T.textMuted,padding:"8px 0"}}>No members yet.</div>;
  return (
    <div>
      {rows.map((r, i) => {
        const mine = me && r.member.toLowerCase() === me.toLowerCase();
        const pct = goalDays ? Math.min(100, (Number(r.streak) / goalDays) * 100) : 0;
        return (
          <div key={r.member} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:i<rows.length-1?`1px solid ${T.border}`:"none"}}>
            <div style={{width:26,textAlign:"center",fontSize:i<3?18:13,fontWeight:700,color:T.textSub}}>{["🥇","🥈","🥉"][i] || i + 1}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:13,fontWeight:600,fontFamily:"'Geist Mono',monospace"}}>{short(r.member)}</span>
                {mine && <Badge>You</Badge>}
              </div>
              <div style={{height:4,background:"#E5E7EB",borderRadius:99,marginTop:6,overflow:"hidden"}}>
                <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${T.orange},${T.amber})`,borderRadius:99}}/>
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:13,fontWeight:700}}>🔥 {Number(r.streak)}</div>
              <div style={{fontSize:11,color:T.textMuted}}>{fmtUsd(r.balance)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CircleCard({ id, live, me, isMember, inOtherCircle, onJoin, onLeave, pending, toast }) {
  const { circle, leaderboard, notFound, loading } = useCircle(id, live);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(circleLink(id)); setCopied(true); toast?.("Invite link copied"); setTimeout(()=>setCopied(false), 2000); }
    catch { window.prompt("Copy this invite link:", circleLink(id)); }
  };
  if (loading) return <Card><div style={{display:"flex",gap:10,alignItems:"center",fontSize:13,color:T.textSub}}><Spinner size={14} color={T.blue}/>Loading circle #{id}…</div></Card>;
  if (notFound || !circle) return <Card><Notice tone="red">Circle #{id} doesn&apos;t exist. Check the ID or invite link.</Notice></Card>;
  const goal = Number(circle.goalDays);
  return (
    <Card>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:11,color:T.textMuted,fontWeight:600}}>CIRCLE #{id}</div>
          <div style={{fontSize:19,fontWeight:700,letterSpacing:"-0.02em",wordBreak:"break-word"}}>{circle.name}</div>
          <div style={{fontSize:12,color:T.textSub,marginTop:3}}>{fmtUsd(circle.dailyTarget)}/day target · {goal}-day goal · {circle.members.length}/50 members</div>
        </div>
        {isMember && <Badge color={T.green} bg={T.greenLight}>Joined</Badge>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:isMember?"1fr 1fr":"1fr",gap:8,margin:"14px 0"}}>
        <button onClick={copy} style={{padding:"11px",borderRadius:12,border:`1.5px solid ${T.border}`,background:T.surface,fontSize:13,fontWeight:600,color:T.text}}>
          {copied ? "✓ Copied" : "🔗 Copy invite link"}
        </button>
        {isMember && (
          <button onClick={()=>{ if (window.confirm(`Leave “${circle.name}”? Your savings and streak stay with you.`)) onLeave(); }} disabled={!!pending}
            style={{padding:"11px",borderRadius:12,border:"none",background:T.redLight,color:T.red,fontSize:13,fontWeight:600}}>
            {pending === "leaveCircle" ? "Leaving…" : "Leave circle"}
          </button>
        )}
      </div>
      {!isMember && me && (
        <div style={{marginBottom:14}}>
          {inOtherCircle
            ? <Notice>You&apos;re already in another circle. Leave it first to join this one.</Notice>
            : <PrimaryButton onClick={()=>onJoin(id)} disabled={!!pending}>{pending === "joinCircle" ? <><Spinner/>Joining…</> : <>Join “{circle.name}”</>}</PrimaryButton>}
        </div>
      )}
      <div style={{fontSize:12,fontWeight:600,color:T.textSub,letterSpacing:"0.05em",textTransform:"uppercase",marginBottom:2}}>Leaderboard</div>
      <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Sorted by streak, then balance · bar shows progress to the {goal}-day goal</div>
      <Leaderboard rows={leaderboard} me={me} goalDays={goal}/>
    </Card>
  );
}

function JoinSheet({ id, live, onJoin, onClose, pending, error, inOtherCircle, isConnected }) {
  const { circle, notFound, loading } = useCircle(id, live);
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>!pending&&onClose()}
      style={{position:"fixed",inset:0,zIndex:300,background:"rgba(17,24,39,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <motion.div initial={{y:40}} animate={{y:0}} exit={{y:40}} onClick={e=>e.stopPropagation()}
        style={{background:T.surface,width:"100%",maxWidth:480,borderRadius:"24px 24px 0 0",padding:"22px 20px 28px"}}>
        <div style={{width:36,height:4,borderRadius:99,background:"#E5E7EB",margin:"0 auto 16px"}}/>
        <div style={{fontSize:12,color:T.textMuted,fontWeight:600}}>YOU&apos;RE INVITED · CIRCLE #{id}</div>
        {loading ? <div style={{display:"flex",gap:10,alignItems:"center",fontSize:13,color:T.textSub,padding:"16px 0"}}><Spinner size={14} color={T.blue}/>Loading…</div>
        : notFound || !circle ? <Notice tone="red" style={{margin:"12px 0"}}>This circle doesn&apos;t exist. Check the link.</Notice>
        : (
          <>
            <div style={{fontSize:20,fontWeight:700,letterSpacing:"-0.02em",marginTop:2,wordBreak:"break-word"}}>{circle.name}</div>
            <div style={{fontSize:13,color:T.textSub,marginTop:4,marginBottom:14}}>{fmtUsd(circle.dailyTarget)}/day target · {Number(circle.goalDays)}-day goal · {circle.members.length} member{circle.members.length===1?"":"s"}</div>
            <div style={{fontSize:12,color:T.textSub,lineHeight:1.5,marginBottom:14}}>Joining is free (gas only). Each member saves on their own; the circle is a shared goal and leaderboard.</div>
            {error && <Notice tone="red" style={{marginBottom:12}}>{error}</Notice>}
            {!isConnected ? (
              <ConnectButton.Custom>{({openConnectModal})=><PrimaryButton onClick={openConnectModal}>Connect wallet to join</PrimaryButton>}</ConnectButton.Custom>
            ) : inOtherCircle ? (
              <Notice>You&apos;re already in another circle. Leave it first to join this one.</Notice>
            ) : (
              <PrimaryButton onClick={()=>onJoin(id)} disabled={!!pending}>{pending === "joinCircle" ? <><Spinner/>Joining…</> : <>Join circle</>}</PrimaryButton>
            )}
          </>
        )}
        <PrimaryButton tone="ghost" onClick={onClose} disabled={!!pending} style={{marginTop:8}}>Not now</PrimaryButton>
      </motion.div>
    </motion.div>
  );
}

export function CirclesView({ deployment, inviteId, clearInvite, toast }) {
  const { address, isConnected } = useAccount();
  const live = deployment === "live";
  const data = useSavingsData(address, live);
  const myCircle = data.saver?.circleId || 0;
  const { write, pending, error, setError } = useSavingsWrite();

  const [name, setName] = useState("");
  const [target, setTarget] = useState("1");
  const [goal, setGoal] = useState("30");
  const [joinId, setJoinId] = useState("");
  const [viewId, setViewId] = useState(0);
  const [showInvite, setShowInvite] = useState(!!inviteId);

  useEffect(() => { if (inviteId) { setShowInvite(true); setViewId(inviteId); } }, [inviteId]);

  const shownId = viewId || myCircle;
  const nameBytes = useMemo(() => new TextEncoder().encode(name.trim()).length, [name]);
  const targetParsed = parseUsd(target);
  const goalNum = Number(goal);
  const goalOk = Number.isInteger(goalNum) && goalNum >= 1 && goalNum <= CIRCLE_GOAL_MAX;
  const createOk = isConnected && nameBytes > 0 && nameBytes <= CIRCLE_NAME_MAX && targetParsed.units && goalOk && !myCircle && !pending;

  const after = () => { data.refetch(); };
  const create = async () => {
    const h = await write("createCircle", [name.trim(), targetParsed.units, goalNum]);
    if (h) { setName(""); after(); setViewId(0); toast?.("Circle created. Share the invite link!"); }
  };
  const join = async (id) => {
    const h = await write("joinCircle", [BigInt(id)]);
    if (h) { after(); setShowInvite(false); clearInvite?.(); setViewId(Number(id)); toast?.("You joined the circle 🎉"); }
  };
  const leave = async () => {
    const h = await write("leaveCircle");
    if (h) { after(); setViewId(0); toast?.("You left the circle"); }
  };
  const lookup = () => {
    const n = Number(joinId);
    if (!Number.isInteger(n) || n < 1) { setError("Enter a valid circle ID (a number)."); return; }
    setError(""); setViewId(n);
  };

  if (deployment !== "live") {
    return (
      <div style={{display:"grid",gap:16,maxWidth:560,margin:"0 auto"}}>
        <div><h2 style={{fontSize:24,fontWeight:700,letterSpacing:"-0.03em"}}>Circles</h2><p style={{fontSize:13,color:T.textSub,marginTop:4}}>Save together with friends</p></div>
        {deployment === "loading" ? <Card><Spinner size={14} color={T.blue}/></Card> : <LaunchingSoon/>}
      </div>
    );
  }

  return (
    <div style={{display:"grid",gap:16,maxWidth:560,margin:"0 auto"}}>
      <div><h2 style={{fontSize:24,fontWeight:700,letterSpacing:"-0.03em"}}>Circles</h2><p style={{fontSize:13,color:T.textSub,marginTop:4}}>Save together. Same daily target, shared goal, friendly leaderboard.</p></div>
      {isConnected && <WrongNetworkBanner/>}
      {!isConnected && <Notice>Connect your wallet to create or join a circle.</Notice>}
      {error && !showInvite && <Notice tone="red">{error}</Notice>}

      {shownId > 0 && (
        <>
          {viewId > 0 && viewId !== myCircle && myCircle > 0 && (
            <button onClick={()=>setViewId(0)} style={{justifySelf:"start",border:"none",background:"none",color:T.blue,fontSize:13,fontWeight:600}}>← Back to my circle</button>
          )}
          <CircleCard id={shownId} live={live} me={address} isMember={myCircle === shownId} inOtherCircle={myCircle > 0 && myCircle !== shownId}
            onJoin={join} onLeave={leave} pending={pending} toast={toast}/>
        </>
      )}

      {!myCircle && (
        <Card>
          <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em",marginBottom:12}}>Create a circle</div>
          <div style={{display:"grid",gap:12}}>
            <div>
              <label style={labelStyle}>Name <span style={{textTransform:"none",fontWeight:400,color:nameBytes>CIRCLE_NAME_MAX?T.red:T.textMuted}}>({nameBytes}/{CIRCLE_NAME_MAX})</span></label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Lagos Savers" style={{...inputStyle,borderColor:nameBytes>CIRCLE_NAME_MAX?T.red:T.border}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={labelStyle}>Daily target ($)</label>
                <input inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value.replace(/[^0-9.]/g,""))} style={{...inputStyle,borderColor:target&&targetParsed.error?T.red:T.border}}/>
                {target && targetParsed.error && <div style={{fontSize:11,color:T.red,marginTop:4}}>{targetParsed.error}</div>}
              </div>
              <div>
                <label style={labelStyle}>Goal (days)</label>
                <input inputMode="numeric" value={goal} onChange={e=>setGoal(e.target.value.replace(/[^0-9]/g,""))} style={{...inputStyle,borderColor:goal&&!goalOk?T.red:T.border}}/>
                {goal && !goalOk && <div style={{fontSize:11,color:T.red,marginTop:4}}>1–{CIRCLE_GOAL_MAX} days</div>}
              </div>
            </div>
            <PrimaryButton onClick={create} disabled={!createOk}>{pending === "createCircle" ? <><Spinner/>Creating…</> : <>Create circle</>}</PrimaryButton>
          </div>
        </Card>
      )}

      {!myCircle && (
        <Card>
          <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em",marginBottom:4}}>Join a circle</div>
          <div style={{fontSize:12,color:T.textSub,marginBottom:12}}>Enter the circle ID, or open a friend&apos;s invite link.</div>
          <div style={{display:"flex",gap:8}}>
            <input inputMode="numeric" value={joinId} onChange={e=>setJoinId(e.target.value.replace(/[^0-9]/g,""))} placeholder="Circle ID" style={{...inputStyle,flex:1,minWidth:0}}/>
            <button onClick={lookup} disabled={!joinId} style={{border:"none",borderRadius:12,padding:"0 18px",background:joinId?T.blue:"#E5E7EB",color:joinId?"#fff":T.textMuted,fontWeight:600,fontSize:14}}>Find</button>
          </div>
        </Card>
      )}

      {myCircle > 0 && (
        <Notice tone="blue">You can be in one circle at a time. Leave your circle to create or join another.</Notice>
      )}

      <AnimatePresence>
        {showInvite && inviteId > 0 && myCircle !== inviteId && (
          <JoinSheet key="join" id={inviteId} live={live} onJoin={join} pending={pending} error={error} isConnected={isConnected}
            inOtherCircle={myCircle > 0} onClose={()=>{ setShowInvite(false); setError(""); }}/>
        )}
      </AnimatePresence>
    </div>
  );
}
