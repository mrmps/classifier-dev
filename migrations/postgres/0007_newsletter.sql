-- Subscriber consent and history stay independent from workspace membership.
CREATE TABLE subscriber (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL CONSTRAINT subscriber_email_unique UNIQUE,
  source text NOT NULL DEFAULT 'site',
  wants text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);
