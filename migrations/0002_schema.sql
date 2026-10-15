create table if not exists shops (
  id text primary key,
  user_id text not null,
  name text not null,
  client_id_enc text,
  api_key_enc text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists shops_user_id_idx on shops (user_id);

create table if not exists tests (
  id text primary key,
  user_id text not null,
  shop_id text not null references shops (id) on delete cascade,
  name text not null,
  product_id text,
  offer_id text,
  sku text,
  product_name text,
  product_image text,
  snapshot jsonb,
  status text not null default 'draft',
  mode text not null default 'rotate',
  rotation text not null default 'interval',
  interval_hours numeric not null default 1,
  current_variant_id text,
  next_switch_at timestamptz,
  control_variant_id text,
  winner_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tests_user_id_idx on tests (user_id);
create index if not exists tests_next_switch_idx on tests (status, next_switch_at);

create table if not exists variants (
  id text primary key,
  test_id text not null references tests (id) on delete cascade,
  user_id text not null,
  label text not null,
  is_control boolean not null default false,
  title text not null default '',
  description text not null default '',
  images jsonb not null default '[]',
  price text,
  sort_order integer not null default 0
);

create table if not exists test_periods (
  id text primary key,
  test_id text not null references tests (id) on delete cascade,
  user_id text,
  variant_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz
);
create index if not exists test_periods_test_idx on test_periods (test_id);

create table if not exists metrics_daily (
  id text primary key,
  test_id text not null references tests (id) on delete cascade,
  variant_id text not null,
  day date not null,
  hits_view integer not null default 0,
  session_view integer not null default 0,
  hits_tocart integer not null default 0,
  ordered_units integer not null default 0,
  revenue numeric not null default 0,
  incomplete boolean not null default false,
  fetched_at timestamptz not null default now(),
  unique (test_id, variant_id, day)
);

create table if not exists change_logs (
  id text primary key,
  user_id text not null,
  shop_id text,
  test_id text,
  product_id text,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists change_logs_user_idx on change_logs (user_id, created_at desc);

create table if not exists scheduler_state (
  id text primary key,
  last_run_at timestamptz,
  last_switched integer not null default 0,
  last_checked integer not null default 0,
  detail text
);
