ALTER TABLE app_accounts ADD COLUMN fractional_spend_nano BIGINT NOT NULL DEFAULT 0
 CHECK(fractional_spend_nano >= 0 AND fractional_spend_nano < 10000);
ALTER TABLE app_accounts ADD COLUMN legacy_pro BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE app_usage ADD COLUMN reserved_credits BIGINT;
ALTER TABLE app_usage ADD COLUMN reserved_paid_credits BIGINT;
ALTER TABLE app_usage ADD COLUMN actual_nano BIGINT CHECK(actual_nano >= 0);
ALTER TABLE app_usage ADD COLUMN rate_version TEXT;
ALTER TABLE app_usage ADD COLUMN metering_mode TEXT NOT NULL DEFAULT 'credits'
 CHECK(metering_mode IN ('credits','tokens','legacy'));
ALTER TABLE app_usage ADD COLUMN reporting_status TEXT NOT NULL DEFAULT 'not_ready'
 CHECK(reporting_status IN ('not_ready','review','pending','reported','exempt'));
UPDATE app_usage SET reserved_credits=credits,reserved_paid_credits=paid_credits;
CREATE INDEX app_usage_reporting ON app_usage(account_id,created_at) WHERE reporting_status='pending';

-- Reject accidental use of the old credit settlement path on token reservations.
-- Its account/agent writes are in the same transaction, so this also rolls them
-- back. Token mode is chosen at reservation creation and cannot change later.
CREATE FUNCTION protect_token_settlement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.metering_mode!=OLD.metering_mode THEN
   RAISE EXCEPTION 'Reservation metering mode cannot change.' USING ERRCODE='22023';
 END IF;
 IF OLD.metering_mode='tokens' AND
   (NEW.status IS DISTINCT FROM OLD.status OR NEW.credits IS DISTINCT FROM OLD.credits OR
    NEW.paid_credits IS DISTINCT FROM OLD.paid_credits OR NEW.actual_nano IS DISTINCT FROM OLD.actual_nano)
   AND current_setting('classifier.token_settlement',TRUE) IS DISTINCT FROM OLD.id THEN
   RAISE EXCEPTION 'Token reservations require token settlement.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER app_protect_token_settlement BEFORE UPDATE ON app_usage
 FOR EACH ROW EXECUTE FUNCTION protect_token_settlement();

-- One credit is 10,000 nanoUSD. The wallet charges ceil(cumulative nanoUSD),
-- keeping its sub-credit remainder so splitting a batch cannot increase its cost.
-- The caller must reserve a known bound before inference. This function never
-- invents that bound, debits beyond it, or treats an unknown measurement as zero.
CREATE FUNCTION settle_token_reservation(
 p_request_id TEXT, p_actual_nano BIGINT, p_rate_version TEXT,
 p_input_tokens BIGINT DEFAULT NULL, p_output_tokens BIGINT DEFAULT NULL,
 p_refund BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
 status TEXT, charged_credits BIGINT, refunded_credits BIGINT,
 actual_nano TEXT, rate_version TEXT
) LANGUAGE plpgsql AS $$
DECLARE
 v_account_id TEXT;
 v_account app_accounts%ROWTYPE;
 v_usage app_usage%ROWTYPE;
 v_reserved BIGINT;
 v_reserved_paid BIGINT;
 v_charge BIGINT;
 v_paid_charge BIGINT;
 v_remainder BIGINT;
 v_total NUMERIC;
 v_previous_guard TEXT;
BEGIN
 SELECT u.account_id INTO v_account_id FROM app_usage u WHERE u.id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.' USING ERRCODE='P0002'; END IF;
 -- Every settlement/refund takes locks in the same order. The account lock also
 -- serializes fractional accounting across different requests and credentials.
 SELECT a.* INTO STRICT v_account FROM app_accounts a WHERE a.id=v_account_id FOR UPDATE;
 SELECT u.* INTO STRICT v_usage FROM app_usage u WHERE u.id=p_request_id FOR UPDATE;
 v_reserved := COALESCE(v_usage.reserved_credits,v_usage.credits);
 v_reserved_paid := COALESCE(v_usage.reserved_paid_credits,v_usage.paid_credits);

 IF v_usage.metering_mode!='tokens' THEN
   RAISE EXCEPTION 'Reservation does not use token metering.' USING ERRCODE='22023';
 END IF;
 IF v_account.legacy_pro AND NOT p_refund THEN
   RAISE EXCEPTION 'Legacy Pro usage must use the unmetered flow.' USING ERRCODE='22023';
 END IF;
 IF v_usage.status IN ('completed','refunded') THEN
   RETURN QUERY SELECT v_usage.status,
     CASE WHEN v_usage.status='completed' THEN v_usage.credits ELSE 0::BIGINT END,
     CASE WHEN v_usage.status='completed' THEN v_reserved-v_usage.credits ELSE v_reserved END,
     v_usage.actual_nano::TEXT,v_usage.rate_version;
   RETURN;
 END IF;
 IF v_usage.status!='pending' THEN
   RAISE EXCEPTION 'Reservation is not pending.' USING ERRCODE='22023';
 END IF;
 IF v_reserved<0 OR v_reserved_paid<0 OR v_reserved_paid>v_reserved THEN
   RAISE EXCEPTION 'Invalid reservation accounting.' USING ERRCODE='22023';
 END IF;
 IF p_input_tokens<0 OR p_output_tokens<0 THEN
   RAISE EXCEPTION 'Token counts cannot be negative.' USING ERRCODE='22023';
 END IF;

 IF p_refund THEN
   v_charge := 0;
   v_paid_charge := 0;
   v_remainder := v_account.fractional_spend_nano;
 ELSIF p_actual_nano IS NULL THEN
   UPDATE app_usage u SET reporting_status='review',
     reserved_credits=v_reserved,reserved_paid_credits=v_reserved_paid,
     input_tokens=COALESCE(p_input_tokens,u.input_tokens),
     output_tokens=COALESCE(p_output_tokens,u.output_tokens)
   WHERE u.id=p_request_id;
   RETURN QUERY SELECT 'review'::TEXT,0::BIGINT,0::BIGINT,NULL::TEXT,v_usage.rate_version;
   RETURN;
 ELSE
   IF p_actual_nano<0 OR p_actual_nano::NUMERIC>v_reserved::NUMERIC*10000 THEN
     RAISE EXCEPTION 'Actual token cost exceeds the reservation or is negative.' USING ERRCODE='22003';
   END IF;
   IF p_rate_version IS NULL OR p_rate_version!~'^[A-Za-z0-9_.-]{1,80}$' THEN
     RAISE EXCEPTION 'A valid token rate version is required.' USING ERRCODE='22023';
   END IF;
   v_total := v_account.fractional_spend_nano::NUMERIC+p_actual_nano::NUMERIC;
   v_charge := CEIL(v_total/10000)::BIGINT-
     CASE WHEN v_account.fractional_spend_nano>0 THEN 1 ELSE 0 END;
   v_remainder := MOD(v_total,10000)::BIGINT;
   v_paid_charge := GREATEST(0,v_charge-(v_reserved-v_reserved_paid));
 END IF;

 UPDATE app_accounts a SET balance=a.balance+v_reserved-v_charge,
   paid_balance=a.paid_balance+v_reserved_paid-v_paid_charge,
   fractional_spend_nano=v_remainder
 WHERE a.id=v_account_id;
 UPDATE app_agents a SET used=a.used-v_reserved+v_charge,
   last_used=CASE WHEN p_refund THEN a.last_used ELSE to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
   status=CASE WHEN NOT p_refund AND a.status='pending' THEN 'connected' ELSE a.status END
 WHERE a.id=v_usage.agent_id;
 v_previous_guard := current_setting('classifier.token_settlement',TRUE);
 PERFORM set_config('classifier.token_settlement',p_request_id,TRUE);
 UPDATE app_usage u SET status=CASE WHEN p_refund THEN 'refunded' ELSE 'completed' END,
   reserved_credits=v_reserved,reserved_paid_credits=v_reserved_paid,
   credits=v_charge,paid_credits=v_paid_charge,
   actual_nano=CASE WHEN p_refund THEN NULL ELSE p_actual_nano END,
   rate_version=CASE WHEN p_refund THEN NULL ELSE p_rate_version END,
   input_tokens=COALESCE(p_input_tokens,u.input_tokens),
   output_tokens=COALESCE(p_output_tokens,u.output_tokens),
   reporting_status=CASE WHEN p_refund THEN 'exempt' ELSE 'pending' END
 WHERE u.id=p_request_id;
 PERFORM set_config('classifier.token_settlement',COALESCE(v_previous_guard,''),TRUE);
 RETURN QUERY SELECT CASE WHEN p_refund THEN 'refunded'::TEXT ELSE 'completed'::TEXT END,
   v_charge,v_reserved-v_charge,
   CASE WHEN p_refund THEN NULL::TEXT ELSE p_actual_nano::TEXT END,
   CASE WHEN p_refund THEN NULL::TEXT ELSE p_rate_version END;
END;
$$;

CREATE FUNCTION refund_token_reservation(p_request_id TEXT)
RETURNS TABLE(status TEXT,charged_credits BIGINT,refunded_credits BIGINT,actual_nano TEXT,rate_version TEXT)
LANGUAGE sql AS $$
 SELECT * FROM settle_token_reservation(p_request_id,NULL,NULL,NULL,NULL,TRUE);
$$;
