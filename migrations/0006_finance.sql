alter table shops add column if not exists tax_regime text not null default 'usn6';
alter table shops add column if not exists tax_rate numeric not null default 6;
alter table shops add column if not exists extra_monthly numeric not null default 0;

create table if not exists sku_costs (
  id text primary key,
  user_id text not null,
  shop_id text not null references shops (id) on delete cascade,
  sku text not null,
  offer_id text,
  name text,
  cost numeric not null default 0,
  packing numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (shop_id, sku)
);
create index if not exists sku_costs_shop_idx on sku_costs (shop_id);

create table if not exists finance_daily (
  id text primary key,
  user_id text not null,
  shop_id text not null references shops (id) on delete cascade,
  sku text not null default '',
  name text,
  day date not null,
  units integer not null default 0,
  revenue numeric not null default 0,
  commission numeric not null default 0,
  logistics numeric not null default 0,
  returns numeric not null default 0,
  storage numeric not null default 0,
  penalties numeric not null default 0,
  ads_hold numeric not null default 0,
  other_hold numeric not null default 0,
  payout numeric not null default 0,
  unique (shop_id, sku, day)
);
create index if not exists finance_daily_shop_day_idx on finance_daily (shop_id, day);
