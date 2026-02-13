"use client";

import React, { useEffect, useState } from "react";

type Exchange = "NSE" | "BSE";

type Holding = {
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

type SectorGroup = {
  sector: string;
  holdings: Holding[];
  totalInvestment: number;
  totalPresentValue: number;
  totalGainLoss: number;
  weightInPortfolio: number;
};

type PortfolioSummary = {
  totalInvestment: number;
  totalPresentValue: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
};

function computePortfolio(
  holdings: Holding[]
): { summary: PortfolioSummary; sectors: SectorGroup[] } {
  const withComputedValues = holdings.map((h) => {
    const investment = h.purchasePrice * h.quantity;
    const presentValue = h.cmp * h.quantity;
    const gainLoss = presentValue - investment;
    return {
      ...h,
      investment,
      presentValue,
      gainLoss,
    };
  });

  const totalInvestment = withComputedValues.reduce(
    (sum, h) => sum + h.investment,
    0
  );
  const totalPresentValue = withComputedValues.reduce(
    (sum, h) => sum + h.presentValue,
    0
  );
  const totalGainLoss = totalPresentValue - totalInvestment;
  const totalGainLossPercent =
    totalInvestment > 0 ? (totalGainLoss / totalInvestment) * 100 : 0;

  const sectorsMap = new Map<string, SectorGroup>();

  withComputedValues.forEach((h) => {
    const existing = sectorsMap.get(h.sector);
    const investment = h.investment;
    const presentValue = h.presentValue;
    const gainLoss = h.gainLoss;

    if (!existing) {
      sectorsMap.set(h.sector, {
        sector: h.sector,
        holdings: [h],
        totalInvestment: investment,
        totalPresentValue: presentValue,
        totalGainLoss: gainLoss,
        weightInPortfolio: 0,
      });
    } else {
      existing.holdings.push(h);
      existing.totalInvestment += investment;
      existing.totalPresentValue += presentValue;
      existing.totalGainLoss += gainLoss;
    }
  });

  const sectors: SectorGroup[] = Array.from(sectorsMap.values()).map(
    (sectorGroup) => ({
      ...sectorGroup,
      weightInPortfolio:
        totalInvestment > 0
          ? (sectorGroup.totalInvestment / totalInvestment) * 100
          : 0,
    })
  );

  // #region agent log (development only)
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    fetch(
      "http://127.0.0.1:7242/ingest/a77d4c33-76c4-4f9c-b3c6-2eb7a53e04ac",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: `log_${Date.now()}_computePortfolio`,
          timestamp: Date.now(),
          runId: "pre-fix",
          hypothesisId: "H1",
          location: "PortfolioDashboard.tsx:computePortfolio",
          message: "computePortfolio summary",
          data: {
            holdingsCount: holdings.length,
            totalInvestment,
            totalPresentValue,
            totalGainLoss,
            sectorsCount: sectors.length,
          },
        }),
      }
    ).catch(() => {});
  }
  // #endregion agent log

  return {
    summary: {
      totalInvestment,
      totalPresentValue,
      totalGainLoss,
      totalGainLossPercent,
    },
    sectors,
  };
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export const PortfolioDashboard: React.FC = () => {
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isCancelled = false;

    // fetch the portfolio data from the API
    const fetchPortfolio = async () => {
      // #region agent log (development only)
      if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
        fetch(
          "http://127.0.0.1:7242/ingest/a77d4c33-76c4-4f9c-b3c6-2eb7a53e04ac",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: `log_${Date.now()}_fetchPortfolio_start`,
              timestamp: Date.now(),
              runId: "pre-fix",
              hypothesisId: "H2",
              location: "PortfolioDashboard.tsx:fetchPortfolio",
              message: "fetchPortfolio start",
              data: {},
            }),
          }
        ).catch(() => {});
      }
      // #endregion agent log
      try {
        setError(null);
        const res = await fetch("/api/portfolio");

        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }

        const data: {
          holdings: Holding[];
          source?: string;
        } = await res.json();

        // #region agent log (development only)
        if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
          fetch(
            "http://127.0.0.1:7242/ingest/a77d4c33-76c4-4f9c-b3c6-2eb7a53e04ac",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                id: `log_${Date.now()}_fetchPortfolio_success`,
                timestamp: Date.now(),
                runId: "pre-fix",
                hypothesisId: "H2",
                location: "PortfolioDashboard.tsx:fetchPortfolio",
                message: "fetchPortfolio success",
                data: {
                  holdingsCount: data.holdings?.length ?? 0,
                  source: data.source ?? null,
                },
              }),
            }
          ).catch(() => {});
        }
        // #endregion agent log

        if (!isCancelled) {
          setHoldings(data.holdings);
          setIsLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error("Failed to load portfolio:", err);
          setError("Failed to load portfolio data. Please try again.");
          setIsLoading(false);
          // #region agent log (development only)
          if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
            fetch(
              "http://127.0.0.1:7242/ingest/a77d4c33-76c4-4f9c-b3c6-2eb7a53e04ac",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  id: `log_${Date.now()}_fetchPortfolio_error`,
                  timestamp: Date.now(),
                  runId: "pre-fix",
                  hypothesisId: "H3",
                  location: "PortfolioDashboard.tsx:fetchPortfolio",
                  message: "fetchPortfolio error",
                  data: {
                    // Intentionally not logging error details to avoid sensitive info
                    hasError: true,
                  },
                }),
              }
            ).catch(() => {});
          }
          // #endregion agent log
        }
      }
    };

    // Initial load
    fetchPortfolio();

    // Refresh every 15 seconds for live CMP / values
    const intervalId = setInterval(fetchPortfolio, 15000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  // data arrives after the initial load, so we need to compute the portfolio
  const { summary, sectors } = holdings
    ? computePortfolio(holdings)
    : {
        summary: {
          totalInvestment: 0,
          totalPresentValue: 0,
          totalGainLoss: 0,
          totalGainLossPercent: 0,
        },
        sectors: [] as SectorGroup[],
      };

  return (
    <div className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center rounded-full bg-slate-900/60 px-3 py-1 text-xs font-medium text-cyan-300 ring-1 ring-cyan-400/40 backdrop-blur">
              Live portfolio · refreshed every 15s
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-50">
              Equity Portfolio Overview
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300">
              Track current market value, P/E ratios from Google Finance, and
              real-time gains across sectors in a single view.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 text-xs text-slate-300 sm:items-end">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/40 px-3 py-1 ring-1 ring-slate-700/70 backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Market data active</span>
            </div>
            <div className="rounded-lg bg-slate-900/40 px-3 py-2 ring-1 ring-slate-700/70 backdrop-blur">
              <p className="font-medium text-slate-200">Sources</p>
              <p className="mt-1 text-[11px] text-slate-400">
                CMP · Yahoo Finance&nbsp;&middot;&nbsp; P/E &amp; Earnings · Google Finance
              </p>
            </div>
          </div>
        </header>

        {isLoading && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
            Loading portfolio data...
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <section
          aria-label="Portfolio summary"
          className="mb-8 grid gap-4 sm:grid-cols-3"
        >
          <div className="rounded-2xl bg-slate-900/70 p-5 ring-1 ring-slate-700/70 shadow-lg shadow-slate-900/40 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Total Investment
            </p>
            <p className="mt-3 text-2xl font-semibold text-slate-50">
              {formatCurrency(summary.totalInvestment)}
            </p>
          </div>

          <div className="rounded-2xl bg-slate-900/70 p-5 ring-1 ring-slate-700/70 shadow-lg shadow-slate-900/40 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Present Value
            </p>
            <p className="mt-3 text-2xl font-semibold text-slate-50">
              {formatCurrency(summary.totalPresentValue)}
            </p>
          </div>

          <div className="rounded-2xl bg-slate-900/70 p-5 ring-1 ring-slate-700/70 shadow-lg shadow-slate-900/40 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Total Gain / Loss
            </p>
            <p
              className={`mt-3 text-2xl font-semibold ${
                summary.totalGainLoss >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatCurrency(summary.totalGainLoss)}{" "}
              <span className="ml-1 text-sm font-medium text-slate-300">
                ({formatPercent(summary.totalGainLossPercent)})
              </span>
            </p>
          </div>
        </section>

        <section aria-label="Sector allocation" className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Sector Allocation
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {sectors.map((sector) => (
              <div
                key={sector.sector}
                className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-slate-800 shadow-lg shadow-slate-900/40 backdrop-blur"
              >
                <p className="text-sm font-semibold text-slate-50">
                  {sector.sector}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Weight in portfolio
                </p>
                <p className="mt-2 text-lg font-semibold text-cyan-300">
                  {formatPercent(sector.weightInPortfolio)}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {formatCurrency(sector.totalInvestment)} →{" "}
                  {formatCurrency(sector.totalPresentValue)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Holdings by sector" className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Holdings
          </h2>

          <div className="space-y-6">
            {sectors.map((sector) => (
              <div
                key={sector.sector}
                className="overflow-hidden rounded-2xl bg-slate-950/70 ring-1 ring-slate-800 shadow-xl shadow-slate-900/60 backdrop-blur"
              >
                <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-50">
                      {sector.sector}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {sector.holdings.length} holdings ·{" "}
                      {formatCurrency(sector.totalInvestment)} invested ·{" "}
                      {formatCurrency(sector.totalPresentValue)} current value
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p
                      className={
                        sector.totalGainLoss >= 0
                          ? "font-semibold text-emerald-400"
                          : "font-semibold text-rose-400"
                      }
                    >
                      {sector.totalGainLoss >= 0 ? "Gain" : "Loss"}:{" "}
                      {formatCurrency(sector.totalGainLoss)}
                    </p>
                    <p className="mt-1 text-slate-400">
                      Weight: {formatPercent(sector.weightInPortfolio)}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-t border-slate-800 text-left text-sm">
                    <thead className="sticky top-0 bg-slate-900/95 text-[11px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-4 py-2 font-medium">Particulars</th>
                        <th className="px-4 py-2 font-medium">Exchange</th>
                        <th className="px-4 py-2 font-medium text-right">
                          Purchase Price
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          Qty
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          Investment
                        </th>
                        <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                          Portfolio (%)
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          CMP
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          Present Value
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          Gain / Loss
                        </th>
                        <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                          P/E Ratio
                        </th>
                        <th className="hidden px-4 py-2 text-right font-medium lg:table-cell">
                          Latest Earnings
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {sector.holdings.map((h) => {
                        const investment = h.purchasePrice * h.quantity;
                        const presentValue = h.cmp * h.quantity;
                        const gainLoss = presentValue - investment;
                        const isGain = gainLoss >= 0;
                        const portfolioPercent =
                          summary.totalInvestment > 0
                            ? (investment / summary.totalInvestment) * 100
                            : 0;

                        return (
                          <tr
                            key={h.id}
                            className="bg-slate-900/40 hover:bg-slate-800/80"
                          >
                            <td className="px-4 py-2 text-sm font-medium text-slate-50">
                              {h.name}
                            </td>
                            <td className="px-4 py-2 text-xs text-slate-400">
                              {h.exchange}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-200">
                              {formatCurrency(h.purchasePrice)}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-200">
                              {h.quantity}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-200">
                              {formatCurrency(investment)}
                            </td>
                            <td className="hidden px-4 py-2 text-right text-sm tabular-nums text-slate-200 md:table-cell">
                              {formatPercent(portfolioPercent)}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-200">
                              {formatCurrency(h.cmp)}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-200">
                              {formatCurrency(presentValue)}
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-sm tabular-nums ${
                                isGain ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {formatCurrency(gainLoss)}
                            </td>
                            <td className="hidden px-4 py-2 text-right text-sm tabular-nums text-slate-200 md:table-cell">
                              {h.peRatio.toFixed(2)}
                            </td>
                            <td className="hidden px-4 py-2 text-right text-xs text-slate-300 lg:table-cell">
                              {h.latestEarnings}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

