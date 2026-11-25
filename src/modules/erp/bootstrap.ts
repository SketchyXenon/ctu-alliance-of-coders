// ERP bootstrap — demo seed usable from the CLI script AND the admin UI
// (POST /api/erp/bootstrap). Idempotent: safe to run any number of times.

import { db } from "@/lib/db";
import { erp } from "./container";

export interface ErpBootstrapResult {
  org: string;
  variantSku: string;
  unitPriceMinor: number;
  stock: number;
  planName: string;
  methodsCreated: number;
  providerEnabled: boolean;
  accounts: number;
}

/** Seed the demo campus shop + membership data. See scripts/seed-erp.ts for
 *  the CLI wrapper. Creates: org, chart of accounts, product+variant+stock,
 *  plan, saved payment methods for every admin (with recorded consent), and
 *  the mock provider config (secret generated once). */
export async function seedErpDemo(): Promise<ErpBootstrapResult> {
  // 1. Org anchor.
  const org = await db.erpOrg.upsert({
    where: { slug: "alliance-of-coders" },
    update: {},
    create: {
      publicId: "org-regular-member",
      slug: "alliance-of-coders",
      name: "Alliance of Coders — CTU Danao",
      tenantId: "campus",
    },
  });

  // 2. Chart of accounts (minimal campus set used by settlement journals).
  const accounts: Array<{ code: string; name: string; type: string }> = [
    { code: "1000-CASH", name: "Cash and equivalents", type: "ASSET" },
    { code: "1100-RECEIVABLES", name: "Accounts receivable", type: "ASSET" },
    { code: "2000-PAYABLES", name: "Accounts payable", type: "LIABILITY" },
    { code: "3000-EQUITY", name: "Org equity", type: "EQUITY" },
    { code: "4000-SALES", name: "Merchandise sales", type: "REVENUE" },
    { code: "4100-DUES", name: "Membership dues", type: "REVENUE" },
    { code: "5000-COGS", name: "Cost of goods sold", type: "EXPENSE" },
  ];
  for (const acc of accounts) {
    await db.erpGlAccount.upsert({ where: { code: acc.code }, update: {}, create: acc });
  }

  // 3. Shop product + variant + stock.
  let variant = await db.erpVariant.findUnique({ where: { sku: "AOC-SHIRT-2026" } });
  if (!variant) {
    const product = await db.erpProduct.create({
      data: {
        publicId: "prd-anniv-shirt-2026",
        orgId: org.id,
        name: "AOC Anniversary Shirt 2026",
        description: "Limited campus drop — department shirt for the anniversary week.",
        status: "PUBLISHED",
        variants: {
          create: {
            name: "Default",
            sku: "AOC-SHIRT-2026",
            unitPriceMinor: 35000, // PHP 350.00 in centavos
          },
        },
      },
      include: { variants: true },
    });
    variant = product.variants[0] ?? null;
  }
  if (!variant) {
    throw new Error("ERP bootstrap failed: variant was not created.");
  }
  await db.erpStock.upsert({
    where: { variantId: variant.id },
    update: {},
    create: { variantId: variant.id, onHand: 50, reserved: 0 },
  });

  // 4. Membership plan.
  const plan = await db.erpPlan.upsert({
    where: { publicId: "plan-monthly-regular" },
    update: {},
    create: {
      publicId: "plan-monthly-regular",
      orgId: org.id,
      name: "Regular Member — Monthly",
      amountMinor: 5000, // PHP 50.00 / month
      period: "MONTHLY",
      active: true,
    },
  });

  // 5. Saved payment method (mock provider token) for every admin — with
  //    recorded consent (the "consent moment" rule). tok_fail / tok_timeout
  //    exist only as documented test tokens (docs/erp/PAYMENTS.md).
  const admins = await db.adminUser.findMany({ select: { id: true } });
  let methodsCreated = 0;
  for (const admin of admins) {
    const existing = await db.erpPaymentMethod.findFirst({
      where: { ownerRef: admin.id, provider: "mock", tokenRef: "tok_success" },
    });
    if (!existing) {
      await db.erpPaymentMethod.create({
        data: {
          publicId: `pm-${crypto.randomUUID().slice(0, 8)}`,
          ownerRef: admin.id,
          provider: "mock",
          tokenRef: "tok_success",
          brand: "Mock Card",
          last4: "4242",
          status: "ACTIVE",
          consentVersion: "v1",
          consentedAt: new Date(),
        },
      });
      methodsCreated += 1;
    }
  }

  // 6. Mock provider config (secret generated once; held ONLY by the ingress
  //    + worker paths — the ERP core never reads it).
  const provider = await erp.payments.ensureProviderConfig("mock");

  return {
    org: org.slug,
    variantSku: variant.sku,
    unitPriceMinor: variant.unitPriceMinor,
    stock: 50,
    planName: plan.name,
    methodsCreated,
    providerEnabled: provider.enabled,
    accounts: accounts.length,
  };
}
