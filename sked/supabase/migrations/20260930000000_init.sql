create table public.google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

create table public.cli_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;
alter table public.cli_tokens enable row level security;
