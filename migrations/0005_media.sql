create table if not exists media (
  id text primary key,
  user_id text not null,
  mime text not null,
  filename text not null,
  data_b64 text not null,
  created_at timestamptz not null default now()
);
create index if not exists media_user_id_idx on media (user_id);
