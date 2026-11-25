// ERP shared kernel — money rules.
//
// Blueprint rule 5 ("Data layer"): "Money is an integer. Store amounts as
// BIGINT centavos with a currency column; never floats or decimals in
// application code." We store Int centavos (campus-scale amounts fit a 4-byte
// int: 2^31 centavos = ~21.4M PHP; documented deviation in ADR-0007). Every
// arithmetic path goes through these helpers so no route multiplies floats.

export const ERP_CURRENCY = "PHP";

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Assert a value is a non-negative integer centavo amount within Int range. */
export function assertAmountMinor(
  amountMinor: unknown,
  label = "amount"
): number {
  if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor)) {
    throw new MoneyError(`${label} must be an integer number of centavos.`);
  }
  if (amountMinor < 0) {
    throw new MoneyError(`${label} must be non-negative.`);
  }
  if (amountMinor > 2_147_483_647) {
    throw new MoneyError(`${label} exceeds the supported centavo range.`);
  }
  return amountMinor;
}

/** Multiply unit price by qty with an overflow-safe integer result. */
export function lineTotalMinor(unitPriceMinor: number, qty: number): number {
  assertAmountMinor(unitPriceMinor, "unit price");
  if (!Number.isInteger(qty) || qty < 1 || qty > 1_000) {
    throw new MoneyError("qty must be an integer between 1 and 1000.");
  }
  return assertAmountMinor(unitPriceMinor * qty, "line total");
}

/** Format centavos as a peso string for display only (never for storage). */
export function formatMinor(amountMinor: number, currency = ERP_CURRENCY): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const pesos = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, "0");
  return `${sign}${currency} ${pesos.toLocaleString("en-PH")}.${centavos}`;
}
