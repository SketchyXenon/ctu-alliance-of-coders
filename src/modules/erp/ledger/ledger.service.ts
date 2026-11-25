// ERP Ledger module (gl_) — double-entry journal.
//
// Blueprint: "Every journal posts balanced lines (total debits equal total
// credits), checked in code before commit and by a nightly job." Lines are
// append-only: corrections are new reversing rows, never updates.

import { ulid } from "../shared/ulid";
import { recordOutboxEvent } from "../shared/outbox";
import { ERP_EVENTS } from "../shared/events";
import { ErpError } from "../shared/errors";
import { assertAmountMinor } from "../shared/money";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type Tx = Prisma.TransactionClient;

export interface JournalLineInput {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
}

export interface JournalInput {
  tenantId: string;
  orgId: string;
  memo: string;
  correlationId?: string | null;
  lines: JournalLineInput[];
}

export interface LedgerApi {
  /** Post a balanced journal entry INSIDE the caller's transaction.
   *  Throws UNBALANCED_JOURNAL when debits != credits (never commits). */
  postJournal(tx: Tx, input: JournalInput): Promise<{ journalId: string; publicId: string }>;
  /** Sum debits/credits across the ledger (nightly balance check + reports). */
  getTrialBalance(): Promise<{ debitMinor: number; creditMinor: number; balanced: boolean }>;
  /** Look up an account by its code (chart of accounts). */
  findAccountByCode(tx: Tx, code: string): Promise<{ id: string; code: string; name: string; type: string } | null>;
}

export class LedgerService implements LedgerApi {
  async postJournal(tx: Tx, input: JournalInput): Promise<{ journalId: string; publicId: string }> {
    if (!input.lines || input.lines.length < 2) {
      throw new ErpError("UNBALANCED_JOURNAL", "A journal needs at least two lines (debit + credit).");
    }
    let debitTotal = 0;
    let creditTotal = 0;
    for (const line of input.lines) {
      assertAmountMinor(line.debitMinor, "debit");
      assertAmountMinor(line.creditMinor, "credit");
      if (line.debitMinor > 0 && line.creditMinor > 0) {
        throw new ErpError("UNBALANCED_JOURNAL", "A line cannot be both debit and credit.");
      }
      if (line.debitMinor === 0 && line.creditMinor === 0) {
        throw new ErpError("UNBALANCED_JOURNAL", "A line must carry a debit or a credit.");
      }
      debitTotal += line.debitMinor;
      creditTotal += line.creditMinor;
    }
    if (debitTotal !== creditTotal) {
      throw new ErpError(
        "UNBALANCED_JOURNAL",
        `Journal does not balance: debits ${debitTotal} != credits ${creditTotal} centavos.`
      );
    }

    // Resolve account codes -> ids (chart of accounts is gl_-owned).
    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await tx.erpGlAccount.findMany({ where: { code: { in: codes } } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    for (const code of codes) {
      if (!byCode.has(code)) {
        throw new ErpError("NOT_FOUND", `Unknown ledger account: ${code}`);
      }
    }

    const publicId = ulid();
    const entry = await tx.erpJournalEntry.create({
      data: {
        publicId,
        tenantId: input.tenantId,
        orgId: input.orgId,
        memo: input.memo,
        lines: {
          create: input.lines.map((line) => ({
            accountId: byCode.get(line.accountCode)!.id,
            orgId: input.orgId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
          })),
        },
      },
    });

    await recordOutboxEvent(tx, {
      def: ERP_EVENTS.journalPosted,
      tenantId: input.tenantId,
      aggregateId: entry.id,
      correlationId: input.correlationId ?? null,
      payload: { journalPublicId: publicId, memo: input.memo, debitMinor: debitTotal },
    });

    return { journalId: entry.id, publicId };
  }

  async getTrialBalance(): Promise<{ debitMinor: number; creditMinor: number; balanced: boolean }> {
    const lines = await db.erpJournalLine.aggregate({
      _sum: { debitMinor: true, creditMinor: true },
    });
    const debitMinor = lines._sum.debitMinor ?? 0;
    const creditMinor = lines._sum.creditMinor ?? 0;
    return { debitMinor, creditMinor, balanced: debitMinor === creditMinor };
  }

  async findAccountByCode(tx: Tx, code: string) {
    return tx.erpGlAccount.findUnique({
      where: { code },
      select: { id: true, code: true, name: true, type: true },
    });
  }
}
