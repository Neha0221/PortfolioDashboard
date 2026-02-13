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
const REQUEST_DELAY_MS = 400; // delay between holdings to avoid rate limits

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

// ---- Singleton Yahoo Finance instance ----
// Re-using a single instance avoids repeated crumb/cookie negotiation
// which is a common cause of failures on cloud servers.
let _yahooFinance: any = null;

async function getYahooFinance() {
  if (!_yahooFinance) {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default as any;
    _yahooFinance = new YahooFinance();

    // Suppress strict validation so the library logs warnings instead of
    // throwing on unexpected response shapes (common on cloud servers).
    try {
      if (typeof _yahooFinance.setGlobalConfig === "function") {
        _yahooFinance.setGlobalConfig({
          validation: { logErrors: true, logOptionsErrors: true },
        });
      }
    } catch {
      // Ignore – the config API may differ across versions
    }
  }
  return _yahooFinance;
}

// ---- Google Finance: optional enrichment for P/E Ratio and Earnings ----
// Scrapes the quote page HTML. Works great from residential IPs (localhost),
// but may be blocked from cloud server IPs (Render, etc.). That's fine –
// Yahoo provides a baseline PE, and Google enriches it when available.
async function fetchGoogleFundamentals(
  symbol: string
): Promise<{ peRatio: number; latestEarnings: string } | null> {
  const url = `https://www.google.com/finance/quote/${encodeURIComponent(symbol)}?hl=en`;

  const axiosModule = await import("axios");
  const axios = axiosModule.default;

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: (status: number) => status >= 200 && status < 400,
    });

    if (response.status !== 200) return null;

    const html = String(response.data);

    // Check for bot-blocking pages
    if (
      html.includes("Our systems have detected unusual traffic") ||
      html.includes("Sorry, we can't verify that you're not a robot") ||
      html.includes("unusual traffic from your computer network") ||
      html.length < 1000
    ) {
      console.warn(`[Google Finance] Blocked for ${symbol}`);
      return null;
    }

    // P/E Ratio
    let peRatio = 0;
    const peMatch = html.match(
      /P\/E\s*ratio[\s\S]*?<div[^>]*class="P6K39c"[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/div>/i
    );
    if (peMatch?.[1]) {
      const parsed = Number(peMatch[1]);
      if (!Number.isNaN(parsed)) peRatio = parsed;
    }

    // Latest Earnings (Net income from Income Statement)
    let latestEarnings = "N/A";
    const niMatch = html.match(
      /Net income[\s\S]*?Company's earnings[\s\S]*?([0-9]+(?:\.[0-9]+)?(?:[KMBT])?)/i
    );
    if (niMatch?.[1]) latestEarnings = niMatch[1];

    console.log(`[Google Finance] ${symbol}: PE=${peRatio}, Earnings=${latestEarnings}`);
    return { peRatio, latestEarnings };
  } catch (err: any) {
    console.warn(`[Google Finance] Failed for ${symbol}:`, err?.message || "unknown error");
    return null;
  }
}

// ---- Fetch all stock data ----
// Priority chain:
//   CMP:      Yahoo quote() -> Yahoo quoteSummary() -> throw
//   PE Ratio: Google Finance -> Yahoo quote/summary -> 0
//   Earnings: Google Finance -> Yahoo calendarEvents -> "N/A"
async function fetchStockData(
  yahooSymbol: string,
  googleSymbol: string
): Promise<{
  cmp: number;
  peRatio: number;
  latestEarnings: string;
}> {
  const yf = await getYahooFinance();

  let cmp: number | undefined;
  let yahooPE = 0;
  let latestEarnings = "N/A";

  // ---- Step 1: Yahoo quote() – lightweight, reliable on cloud servers ----
  try {
    const quote = await yf.quote(yahooSymbol);
    if (quote?.regularMarketPrice && typeof quote.regularMarketPrice === "number") {
      cmp = quote.regularMarketPrice;
      yahooPE = typeof quote.trailingPE === "number" ? quote.trailingPE : 0;
      console.log(`[Yahoo quote] ${yahooSymbol}: CMP=${cmp}, PE=${yahooPE}`);
    }
  } catch (err: any) {
    console.warn(`[Yahoo quote] Failed for ${yahooSymbol}:`, err?.message || err);
  }

  // ---- Step 2: Yahoo quoteSummary() – fallback if quote() didn't return CMP ----
  if (typeof cmp !== "number") {
    try {
      const summary = await yf.quoteSummary(yahooSymbol, {
        modules: ["price", "summaryDetail"],
      });

      const price =
        summary?.price?.regularMarketPrice ??
        summary?.price?.regularMarketPrice?.raw;

      if (typeof price === "number") cmp = price;

      if (!yahooPE) {
        yahooPE =
          summary?.summaryDetail?.trailingPE ??
          summary?.summaryDetail?.forwardPE ??
          0;
      }

      console.log(`[Yahoo quoteSummary] ${yahooSymbol}: CMP=${cmp}, PE=${yahooPE}`);
    } catch (err: any) {
      console.warn(`[Yahoo quoteSummary] Failed for ${yahooSymbol}:`, err?.message || err);
    }
  }

  if (typeof cmp !== "number") {
    throw new Error(`All Yahoo Finance methods failed to return CMP for ${yahooSymbol}`);
  }

  // ---- Step 3: Yahoo calendarEvents – baseline earnings date ----
  try {
    const summary = await yf.quoteSummary(yahooSymbol, {
      modules: ["calendarEvents"],
    });
    const earningsDate = summary?.calendarEvents?.earnings?.earningsDate;
    if (Array.isArray(earningsDate) && earningsDate.length > 0) {
      const d = earningsDate[0];
      latestEarnings =
        d instanceof Date
          ? d.toLocaleDateString("en-IN")
          : new Date(d).toLocaleDateString("en-IN");
    } else if (earningsDate instanceof Date) {
      latestEarnings = earningsDate.toLocaleDateString("en-IN");
    }
  } catch {
    // Non-critical
  }

  // ---- Step 4: Google Finance – optional enrichment (non-blocking) ----
  // If Google Finance responds, its PE ratio and earnings override Yahoo's
  // since Google tends to show more granular / up-to-date fundamentals.
  // If it fails (common on cloud servers), we gracefully keep Yahoo's data.
  try {
    const google = await fetchGoogleFundamentals(googleSymbol);
    if (google) {
      if (google.peRatio > 0) yahooPE = google.peRatio;
      if (google.latestEarnings !== "N/A") latestEarnings = google.latestEarnings;
    }
  } catch {
    // Google enrichment failed – no problem, Yahoo data is already set.
  }

  return { cmp, peRatio: yahooPE, latestEarnings };
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
        const data = await fetchStockData(holding.yahooSymbol, holding.googleSymbol);

        results.push({
          id: holding.id,
          sector: holding.sector,
          name: holding.name,
          exchange: holding.exchange,
          purchasePrice: holding.purchasePrice,
          quantity: holding.quantity,
          cmp: data.cmp,
          peRatio: data.peRatio,
          latestEarnings: data.latestEarnings,
        });
      } catch (err: any) {
        console.error(`Error processing holding ${holding.name} (${holding.id}):`, {
          error: err.message,
          yahooSymbol: holding.yahooSymbol,
        });

        // Use previous cached value if available, otherwise defaults.
        const cached = cachedHoldings?.find((h) => h.id === holding.id);

        if (cached) {
          console.log(`Using cached values for ${holding.name}:`, {
            cmp: cached.cmp,
            peRatio: cached.peRatio,
            latestEarnings: cached.latestEarnings,
          });
        } else {
          console.warn(`No cached values available for ${holding.name}, using defaults`);
        }

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
  } catch (error: any) {
    console.error("Portfolio API error:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    // If the provider rate-limits or fails, return last good cached values if we have them.
    if (cachedHoldings) {
      console.log("Returning cached holdings due to error");
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

    console.error("No cached holdings available, returning error");
    return NextResponse.json(
      {
        error: "Failed to load portfolio data",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
