import { NextResponse } from "next/server";

type Exchange = "NSE" | "BSE";

type HoldingConfig = {
  id: string;
  sector: string;
  name: string;
  exchange: Exchange;
  purchasePrice: number;
  quantity: number;
  yahooSymbol: string;
  googleSymbol: string;
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
    yahooSymbol: "HDFCBANK.NS",
    googleSymbol: "HDFCBANK:NSE",
  },
  {
    id: "infosys",
    sector: "Technology",
    name: "Infosys",
    exchange: "NSE",
    purchasePrice: 1350,
    quantity: 8,
    yahooSymbol: "INFY.NS",
    googleSymbol: "INFY:NSE",
  },
  {
    id: "tcs",
    sector: "Technology",
    name: "TCS",
    exchange: "NSE",
    purchasePrice: 3600,
    quantity: 5,
    yahooSymbol: "TCS.NS",
    googleSymbol: "TCS:NSE",
  },
  {
    id: "icici-bank",
    sector: "Financials",
    name: "ICICI Bank",
    exchange: "NSE",
    purchasePrice: 980,
    quantity: 12,
    yahooSymbol: "ICICIBANK.NS",
    googleSymbol: "ICICIBANK:NSE",
  },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Yahoo Finance: used ONLY for CMP (Current Market Price)
async function fetchYahooCmp(symbol: string): Promise<{
  cmp: number;
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

  return { cmp: price };
}

// Google Finance: used for P/E Ratio and Latest Earnings
// Uses Axios to fetch the quote page HTML and lightweight regexes to
// extract values near specific labels. This avoids relying on dynamic
// CSS class names and keeps the scraper reasonably robust.
async function fetchGoogleFundamentals(
  symbol: string
): Promise<{
  peRatio: number;
  latestEarnings: string;
}> {
  const url = `https://www.google.com/finance/quote/${encodeURIComponent(
    symbol
  )}?hl=en`;

  // Lazy‑load axios so that this route stays tree‑shake‑friendly.
  const axiosModule = await import("axios");
  const axios = axiosModule.default;

  const response = await axios.get(url, {
    headers: {
      // Use a browser-like user agent to reduce the chance of being blocked.
      "User-Agent":
        "Mozilla/5.0 (compatible; PortfolioDashboard/1.0; +https://example.com)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    // We handle our own caching at the API level.
    validateStatus: (status: number) => status >= 200 && status < 400,
  });

  const html = String(response.data);

  // ---- P/E Ratio parsing ----
  // Strategy:
  // 1. Find the first occurrence of the "P/E ratio" label.
  // 2. Take a small slice of HTML starting at that label (to avoid
  //    accidentally matching numbers from other parts of the page,
  //    like index values).
  // 3. Within that slice, capture the first decimal number that appears
  //    after the label.
  let peRatio = 0;
  const peLabelIndex = html.indexOf("P/E ratio");
  if (peLabelIndex !== -1) {
    const peWindow = html.slice(peLabelIndex, peLabelIndex + 350);

    // Example structure in this window (simplified):
    // "P/E ratio</div><div>...description...</div><div>19.17</div>"
    const peMatch = peWindow.match(
      /P\/E\s*ratio[\s\S]*?([0-9]+(?:\.[0-9]+)?)/i
    );

    if (peMatch && peMatch[1]) {
      const parsed = Number(peMatch[1]);
      if (!Number.isNaN(parsed)) {
        peRatio = parsed;
      }
    }
  }

  // ---- Latest Earnings parsing ----
  // Google Finance doesn't expose a clean "latest earnings" label.
  // As a pragmatic interpretation, we approximate "latest earnings"
  // as the most recent "Net income" value from the Income Statement table.
  let latestEarnings = "N/A";
  const niMatch = html.match(
    /Net income[\s\S]*?Company’s earnings[\s\S]*?([0-9]+(?:\.[0-9]+)?(?:[KMBT])?)/i
  );
  if (niMatch && niMatch[1]) {
    latestEarnings = niMatch[1];
  }

  return { peRatio, latestEarnings };
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
        // Fetch CMP from Yahoo Finance and fundamentals from Google Finance in parallel
        const [yahooCmp, googleFundamentals] = await Promise.all([
          fetchYahooCmp(holding.yahooSymbol),
          fetchGoogleFundamentals(holding.googleSymbol),
        ]);

        results.push({
          id: holding.id,
          sector: holding.sector,
          name: holding.name,
          exchange: holding.exchange,
          purchasePrice: holding.purchasePrice,
          quantity: holding.quantity,
          cmp: yahooCmp.cmp,
          peRatio: googleFundamentals.peRatio,
          latestEarnings: googleFundamentals.latestEarnings,
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
          source: "cached-error",
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
