import type { ReviewRecord } from './types';

export type TrendDirection = 'improving' | 'stable' | 'worsening';

export interface CategoryTrend {
  total: number;
  avg: number;
  trend: TrendDirection;
}

export interface TrendData {
  reviewCount: number;
  avgFindings: number;
  byCategory: Record<string, CategoryTrend>;
  overallTrend: TrendDirection;
}

export function computeTrends(
  reviews: ReviewRecord[],
  windowSize = 10,
): TrendData {
  const window = reviews.slice(-windowSize);
  if (window.length < 2) {
    return {
      reviewCount: window.length,
      avgFindings: window[0]?.findingCount ?? 0,
      byCategory: {},
      overallTrend: 'stable',
    };
  }

  const midpoint = Math.floor(window.length / 2);
  const firstHalf = window.slice(0, midpoint);
  const secondHalf = window.slice(midpoint);

  const avgFirst = average(firstHalf.map((r) => r.findingCount));
  const avgSecond = average(secondHalf.map((r) => r.findingCount));

  const byCategory: TrendData['byCategory'] = {};
  const categories = new Set(
    window.flatMap((r) => r.findings.map((f) => f.category)),
  );

  for (const cat of categories) {
    const catFirstAvg = average(
      firstHalf.map((r) => r.findings.filter((f) => f.category === cat).length),
    );
    const catSecondAvg = average(
      secondHalf.map(
        (r) => r.findings.filter((f) => f.category === cat).length,
      ),
    );

    byCategory[cat] = {
      total: window.reduce(
        (sum, r) => sum + r.findings.filter((f) => f.category === cat).length,
        0,
      ),
      avg: catSecondAvg,
      trend: trendDirection(catFirstAvg, catSecondAvg),
    };
  }

  return {
    reviewCount: window.length,
    avgFindings: avgSecond,
    byCategory,
    overallTrend: trendDirection(avgFirst, avgSecond),
  };
}

function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function trendDirection(before: number, after: number): TrendDirection {
  const delta = after - before;
  const threshold = 0.5;
  if (delta < -threshold) return 'improving';
  if (delta > threshold) return 'worsening';
  return 'stable';
}
