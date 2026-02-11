## Dynamic Portfolio Dashboard

Full‑stack case‑study project that shows a live equity portfolio with:

- CMP (Current Market Price) from **Yahoo Finance**
- P/E Ratio and Latest Earnings from **Google Finance**
- Sector‑wise allocation, gains, and portfolio weights

Built with **Next.js (App Router), TypeScript, Tailwind CSS, and a Node.js API route**.

---

## 1. Features

- **Portfolio table**
  - Particulars, Exchange, Purchase Price, Qty, Investment, Portfolio %, CMP, Present Value, Gain/Loss, P/E Ratio, Latest Earnings
  - Color‑coded gains (green) and losses (red)
- **Sector grouping**
  - Holdings grouped by sector (e.g. Financials, Technology)
  - Sector‑level totals: investment, present value, gain/loss, and weight in portfolio
- **Live data**
  - CMP from Yahoo Finance via the `yahoo-finance2` library
  - P/E Ratio and Latest Earnings scraped from Google Finance using Axios
  - UI refreshes automatically every **15 seconds**
- **Resilient backend**
  - In‑memory caching on the server to limit external API calls
  - Graceful fallback to the last good cached values if a provider fails or rate‑limits

---

## 2. Tech Stack

- **Frontend**: Next.js 16 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API route (`app/api/portfolio/route.ts`)
- **Market data**
  - Yahoo Finance (via `yahoo-finance2`) – **CMP only**
  - Google Finance (scraped HTML via Axios) – **P/E Ratio + Latest Earnings**

This separation follows the case‑study requirement that CMP must come from Yahoo Finance and P/E + Latest Earnings from Google Finance.

---

## 3. Getting Started (Local)

Install dependencies:

```bash
cd frontend
npm install
```

Run the dev server:

```bash
npm run dev
```

Then open `http://localhost:3000` in your browser.

The main dashboard is rendered from `app/page.tsx`, which mounts the `PortfolioDashboard` component at `app/components/PortfolioDashboard.tsx`.

---

## 4. Deployment (Render)

This project is intended to be deployed on **Render**.

High‑level steps:

1. Push the `frontend` project to a Git repository (GitHub, GitLab, etc.).
2. On Render:
   - Create a **New Web Service**.
   - Connect the repo and select the `frontend` directory as the root.
   - Set **Build Command**: `npm install && npm run build`
   - Set **Start Command**: `npm start`
   - Environment: Node 20+ (or the default stable version that supports Next.js 16).
3. After the first successful deploy, Render will give you a public URL, for example:
   - `https://your-portfolio-dashboard.onrender.com`

If you need server‑side environment variables later (e.g. for proxies), you can configure them under **Environment > Environment Variables** in Render.

---

## 5. API Strategy & Limitations

- **Yahoo Finance**
  - Uses the unofficial `yahoo-finance2` library.
  - No API key required, but responses are cached in memory (`CACHE_TTL_MS`) to reduce the chance of being blocked.
- **Google Finance**
  - There is no official public API.
  - The backend uses Axios to fetch the Google Finance quote page HTML and parses:
    - **P/E ratio**: extracted from the section labeled “P/E ratio”.
    - **Latest earnings**: approximated from the most recent **Net income** value in the Income Statement section.
  - Because the HTML structure can change, these values are **best‑effort** and may require maintenance if Google updates its markup.

For a production‑grade system, a paid market‑data provider with a stable API would be preferable. Here, the focus is on demonstrating API integration, scraping, caching, and error‑handling patterns.

---

## 6. How to Extend the Portfolio

Holdings are currently configured on the server in `app/api/portfolio/route.ts` inside the `HOLDINGS_CONFIG` array.

To add a new hard‑coded holding:

1. Copy one of the existing entries.
2. Adjust:
   - `sector`
   - `name`
   - `purchasePrice`
   - `quantity`
   - `yahooSymbol` (e.g. `SBIN.NS`)
   - `googleSymbol` (e.g. `SBIN:NSE`)
3. Save and restart the dev server if needed.

The new company will automatically appear in the dashboard, with CMP from Yahoo Finance and P/E + Latest Earnings from Google Finance.

---

## 7. Evaluation Criteria Mapping

**Functionality**  
The dashboard shows a live equity portfolio with CMP from Yahoo Finance, P/E ratio and latest earnings from Google Finance, sector‑wise grouping, portfolio weights, and gain/loss calculations, matching the defined case‑study requirements.

**Code Quality**  
The codebase uses TypeScript types for holdings and sector groups, isolates pure helpers such as `computePortfolio`, `formatCurrency`, and `formatPercent`, and cleanly separates concerns between the UI (`PortfolioDashboard` component) and the backend API route (`app/api/portfolio/route.ts`), making the code easy to maintain and extend.

**Performance**  
Server‑side in‑memory caching (`CACHE_TTL_MS`) and a small delay between provider calls (`REQUEST_DELAY_MS`) keep the API fast and reduce external requests, while the frontend polls every 15 seconds so the dashboard stays responsive without overloading Yahoo or Google.

**Error Handling**  
When any external call fails or is rate‑limited, the API falls back to the last good cached values per holding, and the frontend displays a clear, user‑friendly error message if the portfolio cannot be loaded, ensuring failures are handled smoothly.

**API Strategy (Scraping / Rate Limits)**  
CMP is fetched using the unofficial `yahoo-finance2` library, and P/E ratio plus latest earnings are scraped from Google Finance via Axios with a browser‑like user agent. Combined with caching and throttling at the API layer, this strategy respects rate limits and reduces the risk of being blocked.

**User Interface**  
The dashboard uses a modern Tailwind‑based layout with clear typography, color‑coded gains and losses, sector cards, and responsive tables, providing an intuitive and visually appealing experience across screen sizes.

**Problem Solving**  
The implementation demonstrates practical solutions to real‑world constraints—working with unofficial data sources, handling HTML scraping fragility via fallbacks and caching, and presenting useful portfolio analytics (sector weights, total returns) in a single, coherent view.
