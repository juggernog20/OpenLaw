-- Business Owner replaces the demo-only Business sponsor Field.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fields WHERE slug = 'business_sponsor' AND field_type = 'user') THEN
    UPDATE contracts c
      SET business_owner_id = u.id
      FROM users u
      WHERE c.business_owner_id IS NULL
        AND c.custom_fields ->> 'business_sponsor' = u.id;
    UPDATE matters m
      SET business_owner_id = u.id
      FROM users u
      WHERE m.business_owner_id IS NULL
        AND m.custom_fields ->> 'business_sponsor' = u.id;

    UPDATE contracts SET
      custom_fields = custom_fields - 'business_sponsor',
      ai_unverified = ai_unverified - 'business_sponsor',
      analysis_human_fields = analysis_human_fields - 'business_sponsor'
      WHERE custom_fields ? 'business_sponsor' OR ai_unverified ? 'business_sponsor'
        OR analysis_human_fields ? 'business_sponsor';
    UPDATE matters SET custom_fields = custom_fields - 'business_sponsor',
      ai_unverified = ai_unverified - 'business_sponsor'
      WHERE custom_fields ? 'business_sponsor' OR ai_unverified ? 'business_sponsor';
    UPDATE entities SET custom_fields = custom_fields - 'business_sponsor'
      WHERE custom_fields ? 'business_sponsor';
    UPDATE requests SET custom_fields = custom_fields - 'business_sponsor'
      WHERE custom_fields ? 'business_sponsor';
    UPDATE matter_templates SET default_custom_fields = default_custom_fields - 'business_sponsor'
      WHERE default_custom_fields ? 'business_sponsor';
    UPDATE conversion_drafts SET suggestions = suggestions - 'business_sponsor',
      conflicts = conflicts - 'business_sponsor'
      WHERE suggestions ? 'business_sponsor' OR conflicts ? 'business_sponsor';

    DELETE FROM contract_type_fields WHERE field_id IN (SELECT id FROM fields WHERE slug = 'business_sponsor');
    DELETE FROM matter_type_fields WHERE field_id IN (SELECT id FROM fields WHERE slug = 'business_sponsor');
    DELETE FROM entity_type_fields WHERE field_id IN (SELECT id FROM fields WHERE slug = 'business_sponsor');
    DELETE FROM request_type_fields WHERE field_id IN (SELECT id FROM fields WHERE slug = 'business_sponsor');
    DELETE FROM fields WHERE slug = 'business_sponsor';
  END IF;
END $$;
