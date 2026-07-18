// 자금 흐름 레이더용 시세 프록시
// GET /api/flow?tf=1d   (tf: 1m,15m,30m,1h,4h,6h,12h,1d,1w,1M)
// 응답: { "^GSPC": {pct: -0.8, price: 7534}, ... , _meta:{tf, ts} }

const SYMBOLS = ["^IXIC", "^GSPC", "BTC-USD", "CL=F", "HG=F", "GC=F", "^TNX"];

// 각 기간별로 야후에 요청할 (range, interval)과 '몇 칸 전'과 비교할지
const TF = {
  "1m":  { range: "1d",  interval: "1m",  back: 1 },
  "15m": { range: "5d",  interval: "5m",  back: 3 },
  "30m": { range: "5d",  interval: "5m",  back: 6 },
  "1h":  { range: "5d",  interval: "15m", back: 4 },
  "4h":  { range: "1mo", interval: "1h",  back: 4 },
  "6h":  { range: "1mo", interval: "1h",  back: 6 },
  "12h": { range: "1mo", interval: "1h",  back: 12 },
  "1d":  { range: "1mo", interval: "1d",  back: 1 },
  "1w":  { range: "3mo", interval: "1d",  back: 5 },
  "1M":  { range: "6mo", interval: "1d",  back: 21 },
};

async function fetchChart(sym, range, interval) {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (const h of hosts) {
    try {
      const url = `https://${h}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; DaldongFlow/1.0)" } });
      if (!r.ok) continue;
      const j = await r.json();
      const R = j && j.chart && j.chart.result && j.chart.result[0];
      if (!R) continue;
      const cl = (R.indicators && R.indicators.quote && R.indicators.quote[0] && R.indicators.quote[0].close) || [];
      const vals = cl.filter(v => v != null);
      if (vals.length < 2) continue;
      return { vals, meta: R.meta || {} };
    } catch (e) { /* 다음 호스트 시도 */ }
  }
  return null;
}

module.exports = async (req, res) => {
  const tfKey = TF[req.query.tf] ? req.query.tf : "1d";
  const cfg = TF[tfKey];
  const out = {};

  await Promise.all(SYMBOLS.map(async (sym) => {
    const d = await fetchChart(sym, cfg.range, cfg.interval);
    if (!d) { out[sym] = { error: true }; return; }
    const v = d.vals;
    const last = v[v.length - 1];
    const idx = Math.max(0, v.length - 1 - cfg.back);
    const prev = v[idx];
    const price = d.meta.regularMarketPrice != null ? d.meta.regularMarketPrice : last;
    out[sym] = { pct: prev ? ((last - prev) / prev * 100) : 0, price };
  }));

  out._meta = { tf: tfKey, ts: Date.now() };
  // 짧은 기간은 캐시 짧게, 긴 기간은 길게
  const short = ["1m", "15m", "30m", "1h"].includes(tfKey);
  res.setHeader("Cache-Control", short ? "s-maxage=60, stale-while-revalidate=300" : "s-maxage=300, stale-while-revalidate=900");
  res.status(200).json(out);
};
