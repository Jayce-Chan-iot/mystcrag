export const SUPPORTED_CURRENCIES = ["CNY", "TWD"] as const;

export const CURRENCY_MINOR_UNITS = {
  CNY: 100,
  TWD: 1
} as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
