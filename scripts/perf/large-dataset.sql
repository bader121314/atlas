-- Synthetic data for query timing (docs/16): 50 organizations, 300 people,
-- one project with 20,000 tasks and 149 small ones, with assignees, labels,
-- comments, history, outbox events and notifications. Run against an empty,
-- migrated database that is not used for anything else:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/perf/large-dataset.sql
BEGIN;
-- 50 orgs; org 1 is "big": 60 users, 1 project with 20k tasks.
INSERT INTO users (email_normalized, display_name, email_verified_at)
SELECT 'u'||g||'@perf.test','User '||g, now() FROM generate_series(1,300) g;
INSERT INTO organizations (slug,name,created_by_user_id)
SELECT 'org-'||g,'Org '||g,(SELECT id FROM users WHERE email_normalized='u1@perf.test') FROM generate_series(1,50) g;
-- memberships: org1 gets users 1..60; others get 6 users each
INSERT INTO organization_memberships (organization_id,user_id,role)
SELECT o.id,u.id,CASE WHEN u.email_normalized='u1@perf.test' THEN 'owner' ELSE 'member' END
FROM organizations o JOIN users u ON (o.slug='org-1' AND split_part(substr(u.email_normalized,2),'@',1)::int<=60)
 OR (o.slug<>'org-1' AND split_part(substr(u.email_normalized,2),'@',1)::int IN (1, 60+ (split_part(o.slug,'-',2)::int)%240, 61+(split_part(o.slug,'-',2)::int)%239));
INSERT INTO projects (organization_id,key,name,created_by_user_id)
SELECT o.id,'P'||g,'Project '||g,(SELECT id FROM users WHERE email_normalized='u1@perf.test')
FROM organizations o, generate_series(1,3) g;
INSERT INTO workflow_states (organization_id,project_id,key,label,category,position)
SELECT p.organization_id,p.id,s.k,s.l,s.c,s.pos FROM projects p,
 (VALUES ('todo','To do','todo',1),('doing','In progress','in_progress',2),('done','Done','done',3)) s(k,l,c,pos);
INSERT INTO labels (organization_id,name) SELECT o.id,'Label '||g FROM organizations o, generate_series(1,8) g;
-- tasks: big project org-1/P1 20000, others 200
INSERT INTO tasks (organization_id,project_id,number,title,description,state_id,priority,assignee_user_id,due_at,created_by_user_id,completed_at)
SELECT p.organization_id,p.id,n,'Task '||n||' '||md5(n::text),repeat('words about the work ',5),
 (SELECT id FROM workflow_states w WHERE w.project_id=p.id ORDER BY position OFFSET (n%3) LIMIT 1),
 (ARRAY['none','low','medium','high','urgent'])[1+n%5],
 m.user_id, now()+ (n%60||' days')::interval, (SELECT id FROM users WHERE email_normalized='u1@perf.test'),
 CASE WHEN n%3=2 THEN now()-(n%90||' days')::interval END
FROM projects p JOIN organizations o ON o.id=p.organization_id
CROSS JOIN LATERAL generate_series(1, CASE WHEN o.slug='org-1' AND p.key='P1' THEN 20000 ELSE 200 END) n
CROSS JOIN LATERAL (SELECT user_id FROM organization_memberships om WHERE om.organization_id=p.organization_id ORDER BY user_id OFFSET (n % (SELECT count(*) FROM organization_memberships x WHERE x.organization_id=p.organization_id)) LIMIT 1) m;
UPDATE projects p SET next_task_number=(SELECT max(number)+1 FROM tasks t WHERE t.project_id=p.id);
INSERT INTO task_assignees (organization_id,project_id,task_id,user_id)
SELECT organization_id,project_id,id,assignee_user_id FROM tasks ON CONFLICT DO NOTHING;
INSERT INTO task_labels (organization_id,task_id,label_id)
SELECT t.organization_id,t.id,(SELECT id FROM labels l WHERE l.organization_id=t.organization_id ORDER BY name OFFSET (t.number%8) LIMIT 1) FROM tasks t WHERE t.number%2=0;
INSERT INTO task_comments (organization_id,task_id,author_user_id,body)
SELECT t.organization_id,t.id,t.created_by_user_id,'A comment on '||t.title FROM tasks t, generate_series(1,2);
INSERT INTO activity_events (organization_id,project_id,task_id,actor_user_id,action)
SELECT t.organization_id,t.project_id,t.id,t.created_by_user_id,'task.created' FROM tasks t, generate_series(1,3);
INSERT INTO outbox_events (organization_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,project_id,published_at,notified_at,webhooks_at,automations_at)
SELECT t.organization_id,'task',t.id,1,'task.updated','{}',t.project_id,now(),now(),now(),now() FROM tasks t, generate_series(1,3);
INSERT INTO notifications (organization_id,recipient_user_id,kind,project_id,task_id,actor_user_id,source_event_id,read_at,email_status,push_status)
SELECT t.organization_id,t.assignee_user_id,'task.assigned',t.project_id,t.id,t.created_by_user_id,gen_random_uuid(),
 CASE WHEN t.number%4<>0 THEN now() END,'sent','sent' FROM tasks t;


-- Estimates on a third of the tasks and a second assignee on every seventh.
UPDATE tasks SET estimate_minutes = 30 + number % 90 WHERE number % 3 = 0;
INSERT INTO task_assignees (organization_id, project_id, task_id, user_id)
SELECT t.organization_id, t.project_id, t.id,
  (SELECT user_id FROM organization_memberships m
   WHERE m.organization_id = t.organization_id AND m.user_id <> t.assignee_user_id
   ORDER BY user_id LIMIT 1)
FROM tasks t WHERE t.number % 7 = 0
ON CONFLICT DO NOTHING;
COMMIT;
ANALYZE;
