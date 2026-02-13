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
  try {
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
      console.error(`[Yahoo] No CMP available for ${symbol}. Summary:`, JSON.stringify(summary?.price || {}));
      throw new Error(`No CMP available for ${symbol}`);
    }

    console.log(`[Yahoo] Successfully fetched CMP for ${symbol}: ${price}`);
    return { cmp: price };
  } catch (error: any) {
    console.error(`[Yahoo] Error fetching CMP for ${symbol}:`, error?.message || error);
    throw error;
  }
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

  try {
    const response = await axios.get(url, {
      headers: {
        // Use a more realistic browser user agent to reduce the chance of being blocked.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      timeout: 10000, // 10 second timeout
      maxRedirects: 5,
      // We handle our own caching at the API level.
      validateStatus: (status: number) => status >= 200 && status < 400,
    });

    // Check if we got blocked or got an error page
    if (response.status !== 200) {
      console.error(`[Google Finance] Returned status ${response.status} for ${symbol}`);
      throw new Error(`Google Finance returned status ${response.status}`);
    }

    const html = String(response.data);

    // Check if we got blocked (common indicators)
    if (html.includes("Our systems have detected unusual traffic") || 
        html.includes("Sorry, we can't verify that you're not a robot") ||
        html.includes("unusual traffic from your computer network") ||
        html.length < 1000) {
      console.error(`[Google Finance] Appears to have blocked the request for ${symbol}. HTML length: ${html.length}`);
      throw new Error("Google Finance blocked the request");
    }

  // ---- P/E Ratio parsing ----
  // Runtime HTML (from your terminal) shows a structure like:
  //
  //   P/E ratio</div><div class="EY8ABd-...">...</div>...</span>
  //   <div class="P6K39c">20.79</div>
  //
  // So we specifically look for the first number that appears in a
  // <div> with class "P6K39c" after the "P/E ratio" label.
  let peRatio = 0;
  const peClassMatch = html.match(
    /P\/E\s*ratio[\s\S]*?<div[^>]*class="P6K39c"[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/div>/i
  );

  if (peClassMatch && peClassMatch[1]) {
    const parsed = Number(peClassMatch[1]);
    if (!Number.isNaN(parsed)) {
      peRatio = parsed;
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
  } catch (error: any) {
    console.error(`[Google Finance] Error fetching data for ${symbol}:`, {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: url,
    });
    throw error;
  }
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
      } catch (err: any) {
        console.error(`Error processing holding ${holding.name} (${holding.id}):`, {
          error: err.message,
          stack: err.stack,
          yahooSymbol: holding.yahooSymbol,
          googleSymbol: holding.googleSymbol,
        });

        // IMPORTANT: if we have a previous successful cached value, keep using it.
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
