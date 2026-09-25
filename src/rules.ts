// Daylight saving calculations for pre-parsed POSIX TZ rules.
// Mirrors esphome/components/time/posix_tz.cpp so the reported current offset
// matches what the device will compute from the same rules.

export const enum DSTRuleType {
  NONE = 0,
  MONTH_WEEK_DAY = 1, // Mm.w.d
  JULIAN_NO_LEAP = 2, // Jn, 1-365, Feb 29 never counted
  DAY_OF_YEAR = 3, // n, 0-365, Feb 29 counted in leap years
}

export interface DSTRule {
  type: DSTRuleType;
  month: number;
  week: number;
  day_of_week: number;
  day: number;
  time_seconds: number;
}

export interface ParsedTimezone {
  // POSIX offsets: seconds to add to local time to get UTC (positive west of Greenwich)
  std_offset_seconds: number;
  dst_offset_seconds: number;
  dst_start: DSTRule;
  dst_end: DSTRule;
}

const DAY_MS = 86_400_000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** UTC milliseconds of local midnight on the day the rule selects in the given year. */
function ruleDateMs(year: number, rule: DSTRule): number {
  switch (rule.type) {
    case DSTRuleType.MONTH_WEEK_DAY: {
      const first = Date.UTC(year, rule.month - 1, 1);
      const firstDow = new Date(first).getUTCDay();
      let day = 1 + ((rule.day_of_week - firstDow + 7) % 7) + (rule.week - 1) * 7;
      const daysInMonth = new Date(Date.UTC(year, rule.month, 0)).getUTCDate();
      while (day > daysInMonth) day -= 7; // week 5 means the last one in the month
      return Date.UTC(year, rule.month - 1, day);
    }
    case DSTRuleType.JULIAN_NO_LEAP: {
      // Day 60 is always March 1, so skip Feb 29 in leap years
      const skip = isLeapYear(year) && rule.day >= 60 ? 1 : 0;
      return Date.UTC(year, 0, 1) + (rule.day - 1 + skip) * DAY_MS;
    }
    case DSTRuleType.DAY_OF_YEAR:
      return Date.UTC(year, 0, 1) + rule.day * DAY_MS;
    default:
      return NaN;
  }
}

/** UTC epoch milliseconds of a transition. `offsetSeconds` is the offset in force just before it. */
function transitionMs(year: number, rule: DSTRule, offsetSeconds: number): number {
  return ruleDateMs(year, rule) + (rule.time_seconds + offsetSeconds) * 1000;
}

export function hasDst(tz: ParsedTimezone): boolean {
  return tz.dst_start.type !== DSTRuleType.NONE;
}

export function isInDst(epochMs: number, tz: ParsedTimezone): boolean {
  if (!hasDst(tz)) return false;
  // The device uses the UTC year, so do the same
  const year = new Date(epochMs).getUTCFullYear();
  const start = transitionMs(year, tz.dst_start, tz.std_offset_seconds);
  const end = transitionMs(year, tz.dst_end, tz.dst_offset_seconds);
  // Southern hemisphere zones start daylight saving late in the year and end it early
  return start < end ? epochMs >= start && epochMs < end : epochMs >= start || epochMs < end;
}

/** Current offset east of UTC in seconds (the conventional sign, e.g. +3600 for UTC+1). */
export function utcOffsetSeconds(epochMs: number, tz: ParsedTimezone): number {
  // Subtract from 0 so that UTC gives +0 rather than -0
  return 0 - (isInDst(epochMs, tz) ? tz.dst_offset_seconds : tz.std_offset_seconds);
}
