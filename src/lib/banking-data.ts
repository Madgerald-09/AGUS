import type { LedgerEntry } from "./domain";
/** Future consent-based account-history integration; unrelated to Paystack payout balance. */
export interface BankingDataSource {
  getAuthorizedHistory(input: {
    operatorId: string;
    consentId: string;
    from: string;
    to: string;
  }): Promise<LedgerEntry[]>;
  revokeConsent(consentId: string): Promise<void>;
}
