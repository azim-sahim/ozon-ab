alter table metrics_daily add column if not exists incomplete boolean not null default false;
