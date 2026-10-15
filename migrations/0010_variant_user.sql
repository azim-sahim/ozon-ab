alter table variants add column if not exists user_id text;
update variants v set user_id = t.user_id from tests t where v.test_id = t.id and v.user_id is null;
