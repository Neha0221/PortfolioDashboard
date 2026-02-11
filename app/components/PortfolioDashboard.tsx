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

  const sectors = Array.from(sectorsMap.values()).map((sector) => ({
    ...sector,
    weightInPortfolio:
      totalInvestment > 0 ? (sector.totalInvestment / totalInvestment) * 100 : 0,
  }));

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

        if (!isCancelled) {
          setHoldings(data.holdings);
          setIsLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error("Failed to load portfolio:", err);
          setError("Failed to load portfolio data. Please try again.");
          setIsLoading(false);
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Portfolio Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Real-time view of your holdings, sector allocation, and performance.
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Data source: Server-side market data API</p>
            <p>Auto-refresh: every 15 seconds</p>
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
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Total Investment
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {formatCurrency(summary.totalInvestment)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Present Value
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {formatCurrency(summary.totalPresentValue)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Total Gain / Loss
            </p>
            <p
              className={`mt-2 text-2xl font-semibold ${
                summary.totalGainLoss >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {formatCurrency(summary.totalGainLoss)}{" "}
              <span className="ml-1 text-sm font-medium">
                ({formatPercent(summary.totalGainLossPercent)})
              </span>
            </p>
          </div>
        </section>

        <section aria-label="Sector allocation" className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Sector Allocation
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {sectors.map((sector) => (
              <div
                key={sector.sector}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-medium text-slate-900">
                  {sector.sector}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Weight in portfolio
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatPercent(sector.weightInPortfolio)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {formatCurrency(sector.totalInvestment)} →{" "}
                  {formatCurrency(sector.totalPresentValue)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Holdings by sector" className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Holdings
          </h2>

          <div className="space-y-6">
            {sectors.map((sector) => (
              <div
                key={sector.sector}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {sector.sector}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {sector.holdings.length} holdings ·{" "}
                      {formatCurrency(sector.totalInvestment)} invested ·{" "}
                      {formatCurrency(sector.totalPresentValue)} current value
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p
                      className={
                        sector.totalGainLoss >= 0
                          ? "font-semibold text-emerald-600"
                          : "font-semibold text-rose-600"
                      }
                    >
                      {sector.totalGainLoss >= 0 ? "Gain" : "Loss"}:{" "}
                      {formatCurrency(sector.totalGainLoss)}
                    </p>
                    <p className="mt-1 text-slate-500">
                      Weight: {formatPercent(sector.weightInPortfolio)}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-t border-slate-100 text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
                        <th className="px-4 py-2 font-medium text-right">
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
                        <th className="px-4 py-2 font-medium text-right">
                          P/E Ratio
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          Latest Earnings
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
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
                          <tr key={h.id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-2 text-sm font-medium text-slate-900">
                              {h.name}
                            </td>
                            <td className="px-4 py-2 text-xs text-slate-500">
                              {h.exchange}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-700">
                              {formatCurrency(h.purchasePrice)}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-700">
                              {h.quantity}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-700">
                              {formatCurrency(investment)}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-700">
                              {formatPercent(portfolioPercent)}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-700">
                              {formatCurrency(h.cmp)}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-700">
                              {formatCurrency(presentValue)}
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-sm tabular-nums ${
                                isGain ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {formatCurrency(gainLoss)}
                            </td>
                            <td className="px-4 py-2 text-right text-sm tabular-nums text-slate-700">
                              {h.peRatio.toFixed(2)}
                            </td>
                            <td className="px-4 py-2 text-right text-xs text-slate-600">
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

