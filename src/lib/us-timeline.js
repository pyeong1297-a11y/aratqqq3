import { intersectBars } from "./metrics.js";

function findLatestIndexOnOrBefore(sortedDates, targetDate) {
  let lo = 0;
  let hi = sortedDates.length - 1;
  let answer = -1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sortedDates[mid] <= targetDate) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return answer;
}

function attachFxBars(baseTimeline, fxBars) {
  if (!fxBars || fxBars.length === 0) {
    return baseTimeline.map((row) => ({
      ...row,
      fx: {
        date: row.date,
        adjClose: 1
      }
    }));
  }

  const fxDates = fxBars.map((bar) => bar.date);

  return baseTimeline.flatMap((row) => {
    const fxIndex = findLatestIndexOnOrBefore(fxDates, row.date);
    if (fxIndex < 0) {
      return [];
    }

    return [{ ...row, fx: fxBars[fxIndex] }];
  });
}

function resolveLatestBarOnOrBefore(bars, sortedDates, targetDate) {
  if (!bars || bars.length === 0) {
    return null;
  }

  const index = findLatestIndexOnOrBefore(sortedDates, targetDate);
  return index < 0 ? null : bars[index];
}

export function buildAlignedUsTimeline(seriesMap, fxBars) {
  return attachFxBars(intersectBars(seriesMap), fxBars);
}

export function buildAlignedUsTimelineWithParkingFallback(
  { riskBars, spymBars, parkingBars, parkingFallbackBars },
  fxBars
) {
  const baseTimeline = intersectBars({
    risk: riskBars,
    spym: spymBars
  });
  const parkingDates = (parkingBars || []).map((bar) => bar.date);
  const parkingFallbackDates = (parkingFallbackBars || []).map((bar) => bar.date);

  const timelineWithParking = baseTimeline.flatMap((row) => {
    const parkingBar = resolveLatestBarOnOrBefore(parkingBars, parkingDates, row.date);
    const fallbackBar = resolveLatestBarOnOrBefore(
      parkingFallbackBars,
      parkingFallbackDates,
      row.date
    );
    const resolvedParkingBar = parkingBar || fallbackBar;

    if (!resolvedParkingBar) {
      return [];
    }

    return [
      {
        ...row,
        sgov: resolvedParkingBar
      }
    ];
  });

  return attachFxBars(timelineWithParking, fxBars);
}
