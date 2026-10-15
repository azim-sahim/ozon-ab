alter table test_periods add column if not exists user_id text;
update test_periods p set user_id = t.user_id from tests t where p.test_id = t.id and p.user_id is null;
