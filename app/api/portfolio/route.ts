import { NextResponse } from "next/server";

type Exchange = "NSE" | "BSE";

type HoldingConfig = {
  id: string;
  sector: string;
  name: string;
  exchange: Exchange;
  purchasePrice: number;
  quantity: number;
  symbol: string;
};

type HoldingResponse = {
  id: string;
  sector: string;
  name: string;
  exchange: Exchange;
  purchasePrice: number;
  quantity: number;
  cmp: number;
  peRatio: number;
  latestEarnings: string;
};

// ---- Simple server-side caching (important) ----
// The UI polls every 15 seconds. Without caching, we'd spam the market data provider.
// This cache makes the API fast and reduces the chance of being blocked.
const CACHE_TTL_MS = 15_000;
const REQUEST_DELAY_MS = 300; // small delay between provider calls

let lastFetchAt = 0;
let cachedHoldings: HoldingResponse[] | null = null;

const HOLDINGS_CONFIG: HoldingConfig[] = [
  {
    id: "hdfc-bank",
    sector: "Financials",
    name: "HDFC Bank",
    exchange: "NSE",
    purchasePrice: 1450,
    quantity: 10,
    symbol: "HDFCBANK.NS",
  },
  {
    id: "infosys",
    sector: "Technology",
    name: "Infosys",
    exchange: "NSE",
    purchasePrice: 1350,
    quantity: 8,
    symbol: "INFY.NS",
  },
  {
    id: "tcs",
    sector: "Technology",
    name: "TCS",
    exchange: "NSE",
    purchasePrice: 3600,
    quantity: 5,
    symbol: "TCS.NS",
  },
  {
    id: "icici-bank",
    sector: "Financials",
    name: "ICICI Bank",
    exchange: "NSE",
    purchasePrice: 980,
    quantity: 12,
    symbol: "ICICIBANK.NS",
  },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchYahooHolding(symbol: string): Promise<{
  cmp: number;
  peRatio: number;
  latestEarnings: string;
}> {
  // yahoo-finance2 is an unofficial library that fetches Yahoo Finance data.
  // It usually works without API keys, but still needs caching to avoid blocks.
  const YahooFinance = (await import("yahoo-finance2")).default as any;
  const yahooFinance = new YahooFinance();

  const summary = await yahooFinance.quoteSummary(symbol, {
    modules: ["price", "summaryDetail", "defaultKeyStatistics", "calendarEvents"],
  });

  const price =
    summary?.price?.regularMarketPrice ??
    summary?.price?.regularMarketPrice?.raw;

  if (typeof price !== "number") {
    throw new Error(`No CMP available for ${symbol}`);
  }

  const pe =
    summary?.summaryDetail?.trailingPE ??
    summary?.defaultKeyStatistics?.trailingPE ??
    summary?.summaryDetail?.trailingPE?.raw ??
    summary?.defaultKeyStatistics?.trailingPE?.raw;

  const peRatio = typeof pe === "number" ? pe : 0;

  const earningsDate =
    summary?.calendarEvents?.earnings?.earningsDate?.[0] ??
    summary?.calendarEvents?.earnings?.earningsDate?.[0]?.raw;

  const latestEarnings =
    earningsDate instanceof Date
      ? earningsDate.toISOString().slice(0, 10)
      : typeof earningsDate === "number"
      ? new Date(earningsDate * 1000).toISOString().slice(0, 10)
      : "N/A";

  return { cmp: price, peRatio, latestEarnings };
}

export async function GET() {
  try {
    const now = Date.now();

    // If we have a recent cached response, return it immediately.
    if (cachedHoldings && now - lastFetchAt < CACHE_TTL_MS) {
      return NextResponse.json(
        {
          holdings: cachedHoldings,
          source: "yahoo-cached",
          fetchedAt: new Date(lastFetchAt).toISOString(),
        },
        { status: 200 }
      );
    }

    const results: HoldingResponse[] = [];
    for (const holding of HOLDINGS_CONFIG) {
      try {
        const live = await fetchYahooHolding(holding.symbol);

        results.push({
          id: holding.id,
          sector: holding.sector,
          name: holding.name,
          exchange: holding.exchange,
          purchasePrice: holding.purchasePrice,
          quantity: holding.quantity,
          cmp: live.cmp,
          peRatio: live.peRatio,
          latestEarnings: live.latestEarnings,
        });
      } catch (err) {
        console.error(err);

        // IMPORTANT: if we have a previous successful cached value, keep using it.
        const cached = cachedHoldings?.find((h) => h.id === holding.id);

        results.push({
          id: holding.id,
          sector: holding.sector,
          name: holding.name,
          exchange: holding.exchange,
          purchasePrice: holding.purchasePrice,
          quantity: holding.quantity,
          cmp: cached?.cmp ?? holding.purchasePrice,
          peRatio: cached?.peRatio ?? 0,
          latestEarnings: cached?.latestEarnings ?? "N/A",
        });
      }

      await sleep(REQUEST_DELAY_MS);
    }

    cachedHoldings = results;
    lastFetchAt = now;

    return NextResponse.json(
      {
        holdings: results,
        source: "yahoo",
        fetchedAt: new Date(now).toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Portfolio API error:", error);
    // If the provider rate-limits or fails, return last good cached values if we have them.
    if (cachedHoldings) {
      return NextResponse.json(
        {
          holdings: cachedHoldings,
          source: "yahoo-cached-error",
          fetchedAt: new Date(lastFetchAt).toISOString(),
          warning: "Provider error; served cached values.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: "Failed to load portfolio data" },
      { status: 500 }
    );
  }
}
