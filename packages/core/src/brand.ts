/**
 * Product branding — the ONLY place the product name is defined.
 *
 * To rebrand (e.g. white-label for a reseller), change these values or set the
 * `NEXT_PUBLIC_PRODUCT_NAME` / `NEXT_PUBLIC_VENDOR_NAME` environment variables.
 * Every UI string, report header and email-safe label reads from here.
 */
export const BRAND = {
  /** Display name of the product. Placeholder until final branding is chosen. */
  productName: readEnv('NEXT_PUBLIC_PRODUCT_NAME') ?? 'Lumen AI Insight',
  /** Short tagline shown on the login page and report cover. */
  tagline: 'See where AI creates risk, and where it creates value.',
  /** The organisation that operates / resells the product. */
  vendorName: readEnv('NEXT_PUBLIC_VENDOR_NAME') ?? 'Your IT Partner',
} as const;

function readEnv(key: string): string | undefined {
  // `process` is undefined in some edge runtimes; guard so the module stays universal.
  const value = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return value && value.trim().length > 0 ? value : undefined;
}
