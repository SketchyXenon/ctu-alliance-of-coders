// ERP Catalog module (cat_) — products, variants, prices, pre-order windows.
// Publishes: ProductPublished, PriceChanged. Consumes: none.
// Owns ONLY cat_ tables. Inventory stock lives in the inv_ module (referenced
// by variant id, no FK — boundary rule 1).

import { ulid } from "../shared/ulid";
import { recordOutboxEvent } from "../shared/outbox";
import { ERP_EVENTS } from "../shared/events";
import { ErpError } from "../shared/errors";
import { assertAmountMinor } from "../shared/money";
import { db } from "@/lib/db";

export interface ProductView {
  id: string;
  publicId: string;
  orgId: string;
  name: string;
  description: string;
  status: string;
  variants: VariantView[];
}

export interface VariantView {
  id: string;
  publicId: string;
  name: string;
  sku: string;
  unitPriceMinor: number;
  currency: string;
}

export interface CreateProductInput {
  tenantId: string;
  orgId: string;
  name: string;
  description?: string;
  variant: {
    name: string;
    sku: string;
    unitPriceMinor: number;
    currency?: string;
  };
  correlationId?: string | null;
}

export interface CatalogApi {
  createProduct(input: CreateProductInput): Promise<ProductView>;
  publishProduct(productId: string, correlationId?: string | null): Promise<ProductView>;
  listPublishedProducts(orgId?: string): Promise<ProductView[]>;
  /** Variant + product lookup used by the checkout flow (read-only). */
  getVariantForCheckout(variantId: string): Promise<{
    variantId: string;
    sku: string;
    unitPriceMinor: number;
    currency: string;
    productStatus: string;
    orgId: string;
  } | null>;
}

export class CatalogService implements CatalogApi {
  async createProduct(input: CreateProductInput): Promise<ProductView> {
    assertAmountMinor(input.variant.unitPriceMinor, "unit price");
    if (!input.name || input.name.length > 200) {
      throw new ErpError("VALIDATION", "Product name is required (max 200 chars).");
    }
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(input.variant.sku)) {
      throw new ErpError("VALIDATION", "SKU must be 3-64 chars of [A-Za-z0-9._-].");
    }
    const product = await db.erpProduct.create({
      data: {
        publicId: ulid(),
        tenantId: input.tenantId,
        orgId: input.orgId,
        name: input.name,
        description: input.description ?? "",
        status: "DRAFT",
        variants: {
          create: {
            name: input.variant.name,
            sku: input.variant.sku,
            unitPriceMinor: input.variant.unitPriceMinor,
            currency: input.variant.currency ?? "PHP",
          },
        },
      },
      include: { variants: true },
    });
    return toProductView(product);
  }

  async publishProduct(productId: string, correlationId?: string | null): Promise<ProductView> {
    const product = await db.$transaction(async (tx) => {
      const updated = await tx.erpProduct.update({
        where: { id: productId },
        data: { status: "PUBLISHED" },
        include: { variants: true },
      });
      await recordOutboxEvent(tx, {
        def: ERP_EVENTS.productPublished,
        tenantId: updated.tenantId,
        aggregateId: updated.id,
        correlationId: correlationId ?? null,
        payload: { productPublicId: updated.publicId, name: updated.name },
      });
      return updated;
    });
    return toProductView(product);
  }

  async listPublishedProducts(orgId?: string): Promise<ProductView[]> {
    const products = await db.erpProduct.findMany({
      where: { status: "PUBLISHED", ...(orgId ? { orgId } : {}) },
      include: { variants: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return products.map(toProductView);
  }

  async getVariantForCheckout(variantId: string) {
    const variant = await db.erpVariant.findUnique({
      where: { id: variantId },
      include: { product: true },
    });
    if (!variant) return null;
    return {
      variantId: variant.id,
      sku: variant.sku,
      unitPriceMinor: variant.unitPriceMinor,
      currency: variant.currency,
      productStatus: variant.product.status,
      orgId: variant.product.orgId,
    };
  }
}

function toProductView(p: {
  id: string;
  publicId: string;
  orgId: string;
  name: string;
  description: string;
  status: string;
  variants: Array<{
    id: string;
    name: string;
    sku: string;
    unitPriceMinor: number;
    currency: string;
  }>;
}): ProductView {
  return {
    id: p.id,
    publicId: p.publicId,
    orgId: p.orgId,
    name: p.name,
    description: p.description,
    status: p.status,
    variants: p.variants.map((v) => ({
      id: v.id,
      publicId: v.id, // variants use their row id as the public reference in dev
      name: v.name,
      sku: v.sku,
      unitPriceMinor: v.unitPriceMinor,
      currency: v.currency,
    })),
  };
}
