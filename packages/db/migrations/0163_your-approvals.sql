ALTER TABLE "notifications" ADD COLUMN "approval_kind" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "handled_at" timestamp with time zone;
--> statement-breakpoint
UPDATE notifications n
SET approval_kind = 'contract'
FROM contract_approvals a
WHERE n.event_type = 'approval.requested'
  AND n.entity_type = 'contract'
  AND n.entity_id = a.contract_id
  AND n.payload->>'approvalId' = a.id
  AND n.user_id = a.approver_id
  AND a.status = 'pending';
--> statement-breakpoint
UPDATE notifications n
SET approval_kind = 'api_key',
    payload = n.payload || jsonb_build_object('requesterName', u.display_name, 'toolsets', r.toolsets, 'scope', r.scope)
FROM api_key_requests r
JOIN users u ON u.id = r.requester_id
WHERE n.event_type = 'api_key.requested'
  AND n.entity_type = 'api_key_request'
  AND n.entity_id = r.id
  AND r.status = 'pending';
