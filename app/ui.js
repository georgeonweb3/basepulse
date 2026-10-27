"use client";
// Shared design tokens + small primitives used by the savings and trust views.

export const T = {
  bg:"#F9FAFB", surface:"#FFFFFF", surfaceHover:"#F3F4F6",
  border:"rgba(0,0,0,0.06)", text:"#111827", textSub:"#6B7280", textMuted:"#9CA3AF",
  blue:"#0052FF", blueLight:"#EEF3FF", blueMid:"#3B73FF",
  green:"#10B981", greenLight:"#ECFDF5",
  amber:"#F59E0B", amberLight:"#FFFBEB",
  red:"#EF4444", redLight:"#FEF2F2",
  purple:"#7C3AED", purpleLight:"#F5F3FF",
  orange:"#F97316", orangeLight:"#FFF7ED",
  shadow:"0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)",
  shadowMd:"0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
  shadowBlue:"0 8px 32px rgba(0,82,255,0.18)",
};

export function Badge({ children, color=T.blue, bg=T.blueLight }) {
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:600,color,background:bg}}>{children}</span>;
}

export function Spinner({ size=16, color="#fff" }) {
  return <div className="spin" style={{width:size,height:size,border:`2px solid ${color}40`,borderTopColor:color,borderRadius:"50%",flexShrink:0}}/>;
}

export function Card({ children, style, pad="22px 20px" }) {
  return <div style={{background:T.surface,borderRadius:24,boxShadow:T.shadow,padding:pad,...style}}>{children}</div>;
}

export function Notice({ tone="amber", children, style }) {
  const map = {
    amber:[T.amber,T.amberLight], red:[T.red,T.redLight], green:[T.green,T.greenLight], blue:[T.blue,T.blueLight],
  };
  const [c,bg] = map[tone] || map.amber;
  return <div style={{background:bg,border:`1px solid ${c}30`,borderRadius:12,padding:"10px 14px",fontSize:12.5,color:c,fontWeight:500,lineHeight:1.45,...style}}>{children}</div>;
}

export function PrimaryButton({ children, onClick, disabled, tone="blue", style, type="button" }) {
  const bg = disabled ? "#E5E7EB"
    : tone==="green" ? `linear-gradient(135deg,${T.green},#059669)`
    : tone==="ghost" ? T.surfaceHover
    : `linear-gradient(135deg,${T.blue},${T.blueMid})`;
  const color = disabled ? T.textMuted : tone==="ghost" ? T.text : "#fff";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:bg,color,fontSize:14,fontWeight:600,
        display:"flex",alignItems:"center",justifyContent:"center",gap:8,
        boxShadow:disabled||tone==="ghost"?"none":tone==="green"?`0 6px 20px ${T.green}40`:T.shadowBlue,
        cursor:disabled?"not-allowed":"pointer",transition:"all .2s",...style}}>
      {children}
    </button>
  );
}

export const inputStyle = {
  width:"100%",background:T.bg,border:`1.5px solid ${T.border}`,borderRadius:12,padding:"12px 14px",fontSize:15,color:T.text,fontFamily:"inherit",
};

export const labelStyle = {
  fontSize:11,fontWeight:600,color:T.textSub,letterSpacing:"0.05em",textTransform:"uppercase",display:"block",marginBottom:6,
};
