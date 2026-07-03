"use client";
import { useState, useEffect } from "react";

const API = "https://basepulse-trust.onrender.com";

export function useTrustScore(address) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    fetch(`${API}/score/${address}`)
      .then(r => r.json())
      .then(data => {
        setProfile({
          address: data.address,
          trustScore: data.score,
          receipts: data.raw.txCount,
          liquidity: Math.min(data.score / 100, 1),
          verified: data.score > 50,
          breakdown: data.breakdown,
          raw: data.raw,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [address]);

  return { profile, loading };
}
