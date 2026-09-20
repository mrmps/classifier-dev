-- Faster-inference interest carries one concrete, bounded latency target.
ALTER TABLE subscriber ADD COLUMN desired_latency_ms integer;
ALTER TABLE subscriber ADD CONSTRAINT subscriber_faster_latency_check CHECK (
  (desired_latency_ms IS NULL AND NOT ('faster' = ANY(wants)))
  OR (desired_latency_ms IS NOT NULL AND desired_latency_ms BETWEEN 1 AND 60000 AND 'faster' = ANY(wants))
);
