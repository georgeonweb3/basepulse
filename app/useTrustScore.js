"use client";
import { useState, useEffect, useCallback } from "react";

const API = "https://basepulse-trust.onrender.com";
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 8000; // 8s between retries — gives Render time to wake

export function useTrustScore(address) {
  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [attempt, setAttempt]   = useState(0);

  const fetchScore = useCallback(async (addr, tryNum) => {
    try {
      const res = await fetch(`${API}/score/${addr}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProfile({
        address:    data.address,
        trustScore: data.score,
        receipts:   data.raw.txCount,
        liquidity:  Math.min(data.score / 100, 1),
        verified:   data.score > 50,
        breakdown:  data.breakdown,
        raw:        data.raw,
      });
      setLoading(false);
    } catch {
      if (tryNum < MAX_RETRIES) {
        // Schedule next retry
        setTimeout(() => setAttempt(tryNum + 1), RETRY_DELAY_MS);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setProfile(null);
    setAttempt(0);
    fetchScore(address, 0);
  }, [address, fetchScore]);

  // Handle retries
  useEffect(() => {
    if (attempt === 0 || !address) return;
    fetchScore(address, attempt);
  }, [attempt, address, fetchScore]);

  return { profile, loading };
}
