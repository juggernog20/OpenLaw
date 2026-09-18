INSERT INTO fields (id, slug, built_in_key, display_name, module_scope, field_type, options, field_tag, description) VALUES
('ca50f741-ea7f-450b-bc1c-6e8642c245a6', '__intake_contract_entityId', 'entityId', 'Our entity', 'contract', 'entity', NULL, 'business', 'Choose the organization that will sign the contract.'),
('0ed41d0c-3ec8-49e7-b5f4-38b9a0e0f99f', '__intake_contract_counterparties', 'counterparties', 'Counterparties', 'contract', 'long_text', NULL, 'business', 'Enter each counterparty’s legal name on a separate line. The first is the primary counterparty.'),
('126f8542-1e52-4d28-b297-f49a9f5f31e6', '__intake_contract_effectiveDate', 'effectiveDate', 'Effective date', 'contract', 'date', NULL, 'business', NULL),
('65e6a0bf-4dee-4465-b222-1ab5157e67bd', '__intake_contract_expiryDate', 'expiryDate', 'Expiry date', 'contract', 'date', NULL, 'business', NULL),
('139913af-a847-494b-a14d-98ceef2c5ed6', '__intake_contract_termType', 'termType', 'Term type', 'contract', 'single_select', '["Fixed term", "Auto-renewing", "Evergreen"]'::jsonb, 'business', NULL),
('433778c0-d32d-4c36-a085-d520148ee11e', '__intake_contract_renewalPeriodMonths', 'renewalPeriodMonths', 'Renewal period (months)', 'contract', 'number', NULL, 'business', 'For an auto-renewing contract, enter the number of months in each renewal.'),
('a62e2407-b883-476a-9326-4df0d1422857', '__intake_contract_noticePeriodDays', 'noticePeriodDays', 'Notice period (days)', 'contract', 'number', NULL, 'business', 'Enter the number of days of notice required to prevent renewal or end the contract.'),
('e80e78a9-fcc7-4a8e-9f6f-95ebab55bc15', '__intake_contract_valueAmount', 'valueAmount', 'Value amount', 'contract', 'number', NULL, 'business', 'Enter the amount in full currency units, for example 1500.50.'),
('0aee09fa-f810-4e11-a90f-0aa85e1ce6f3', '__intake_contract_valueCurrency', 'valueCurrency', 'Value currency', 'contract', 'currency', NULL, 'business', NULL),
('c769d215-fc7d-48e6-a4f0-ffe0d4eca865', '__intake_contract_valueCadence', 'valueCadence', 'Value frequency', 'contract', 'single_select', '["One-time", "Monthly", "Annually"]'::jsonb, 'business', NULL);
