CREATE TABLE IF NOT EXISTS fm_consents (
 tenant text NOT NULL, owner text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY (tenant, owner, id),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'id',id,'provider','fixture','mode','fixture')));
CREATE TABLE IF NOT EXISTS fm_accounts (
 tenant text NOT NULL, owner text NOT NULL, id text NOT NULL, consent text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY (tenant, owner, id),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'accountId',id,'consentId',consent,'provider','fixture','mode','fixture')),
 FOREIGN KEY (tenant, owner, consent) REFERENCES fm_consents(tenant, owner, id));
CREATE TABLE IF NOT EXISTS fm_transactions (
 tenant text NOT NULL, owner text NOT NULL, account text NOT NULL, id text NOT NULL,
 provider_id text NOT NULL, occurred_at text, search_text text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY (tenant, owner, account, id), UNIQUE (tenant, owner, account, provider_id),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'accountId',account,'id',id,'provenance',jsonb_build_object('providerTransactionId',provider_id,'provider','fixture','mode','fixture'))),
 FOREIGN KEY (tenant, owner, account) REFERENCES fm_accounts(tenant, owner, id));
CREATE INDEX IF NOT EXISTS fm_transactions_date ON fm_transactions(tenant, owner, account, occurred_at, id);
CREATE INDEX IF NOT EXISTS fm_transactions_search ON fm_transactions(tenant, owner, account, search_text);
CREATE TABLE IF NOT EXISTS fm_evidence (
 tenant text NOT NULL, owner text NOT NULL, account text NOT NULL, id text NOT NULL,
 transaction_id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (tenant, owner, account, id),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'accountId',account,'id',id,'transactionId',transaction_id)),
 FOREIGN KEY (tenant, owner, account, transaction_id) REFERENCES fm_transactions(tenant, owner, account, id));
CREATE TABLE IF NOT EXISTS fm_summaries (
 tenant text NOT NULL, owner text NOT NULL, account text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY (tenant, owner, account),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'accountId',account)),
 FOREIGN KEY (tenant, owner, account) REFERENCES fm_accounts(tenant, owner, id));
CREATE TABLE IF NOT EXISTS fm_principals (
 operator_id text PRIMARY KEY, tenant text NOT NULL, owner text NOT NULL);
CREATE TABLE IF NOT EXISTS fm_context (
 tenant text NOT NULL, owner text NOT NULL, id text NOT NULL, revision integer NOT NULL,
 expires_at timestamptz NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (tenant, owner, id));
CREATE TABLE IF NOT EXISTS fm_seed (id text PRIMARY KEY);
