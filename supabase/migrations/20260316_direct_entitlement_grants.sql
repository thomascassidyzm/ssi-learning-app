-- Allow direct entitlement grants (without a code) by making entitlement_code_id nullable
ALTER TABLE user_entitlements ALTER COLUMN entitlement_code_id DROP NOT NULL;
