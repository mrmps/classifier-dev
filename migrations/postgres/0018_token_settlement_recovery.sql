CREATE TABLE app_usage_settlements (
 request_id TEXT PRIMARY KEY REFERENCES app_usage(id) ON DELETE CASCADE,
 refund BOOLEAN NOT NULL,
 charge_nano BIGINT CHECK(charge_nano >= 0),
 rate_version TEXT,
 input_tokens BIGINT CHECK(input_tokens >= 0),
 output_tokens BIGINT CHECK(output_tokens >= 0),
 escalations BIGINT NOT NULL CHECK(escalations >= 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((charge_nano IS NULL) = (rate_version IS NULL))
);
CREATE INDEX app_usage_settlements_created ON app_usage_settlements(created_at);
