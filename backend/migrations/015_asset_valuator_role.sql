-- Add the dedicated valuation specialist role used by the protected AI analysis route.
BEGIN;
INSERT INTO roles (code, description)
VALUES ('asset_valuator', 'Authorized specialist for preliminary asset valuation analysis')
ON CONFLICT (code) DO NOTHING;
COMMIT;
