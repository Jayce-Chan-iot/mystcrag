import { CurrencySchema, type SupportedCurrency } from "@mystcrag/design-contract";

export function formatMinorAmount({
  amountMinor,
  currency: currencyInput,
  locale = currencyInput === "CNY" ? "zh-CN" : "zh-TW"
}: {
  amountMinor: number;
  currency: SupportedCurrency;
  locale?: string;
}): string {
  const currency = CurrencySchema.parse(currencyInput);

  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("amountMinor must be a non-negative safe integer");
  }

  if (currency === "CNY") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amountMinor / 100);
  }

  return `NT$${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amountMinor)}`;
}
