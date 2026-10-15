alter table shops add column if not exists perf_client_id_enc text;
alter table shops add column if not exists perf_client_secret_enc text;
alter table metrics_daily add column if not exists ads_views integer not null default 0;
alter table metrics_daily add column if not exists ads_clicks integer not null default 0;
alter table metrics_daily add column if not exists ads_carts integer not null default 0;
alter table metrics_daily add column if not exists ads_orders integer not null default 0;
alter table metrics_daily add column if not exists ads_spend numeric not null default 0;
alter table metrics_daily add column if not exists ads_revenue numeric not null default 0;
