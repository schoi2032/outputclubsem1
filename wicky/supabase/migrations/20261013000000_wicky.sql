create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null unique,
  name text not null check (length(name) between 1 and 80),
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'teacher', 'moderator', 'admin')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  name text check (length(name) <= 80),
  kind text not null check (kind in ('self', 'dm', 'group')),
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id uuid not null references public.chats on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'manager', 'member')),
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table public.stickers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles on delete set null,
  name text not null check (length(name) between 1 and 40),
  path text not null,
  is_gif boolean not null default false,
  is_official boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  created_at timestamptz not null default now()
);

create table public.messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.chats on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'sticker', 'image', 'ai')),
  body text not null default '' check (length(body) <= 4000),
  body_original text,
  sticker_id uuid references public.stickers on delete set null,
  image_path text,
  is_ai boolean not null default false,
  ai_tag text check (ai_tag in ('bot', 'likely_ai', 'self_tagged')),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now(),
  check (kind <> 'text' or length(trim(body)) > 0),
  check (kind <> 'sticker' or sticker_id is not null),
  check (kind <> 'image' or image_path is not null),
  check (user_id is not null or is_ai)
);

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles on delete cascade,
  target_type text not null check (target_type in ('message', 'user')),
  message_id bigint references public.messages on delete set null,
  user_id uuid references public.profiles on delete set null,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references public.profiles on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.moderation_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('text', 'image', 'sticker')),
  user_id uuid references public.profiles on delete set null,
  input text not null,
  verdict text not null check (verdict in ('allow', 'block', 'error')),
  categories jsonb not null default '[]'::jsonb,
  reason text,
  model text,
  human_override boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.wiki_pages (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(title) between 1 and 120),
  body text not null default '' check (length(body) <= 50000),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now()
);

create index messages_chat_idx on public.messages (chat_id, id desc);
create index messages_user_idx on public.messages (chat_id, user_id, id desc);
create index chat_members_user_idx on public.chat_members (user_id);
create index reports_status_idx on public.reports (status, created_at desc);
create index stickers_status_idx on public.stickers (status);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) not like '%@chadwickschool.org' then
    raise exception 'Only chadwickschool.org accounts can sign up';
  end if;
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    lower(new.email),
    left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), 80),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_members where chat_id = c and user_id = auth.uid());
$$;

create function public.is_mod() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('moderator', 'admin'));
$$;

create function public.member_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  joining_role text;
  member_count int;
  has_teacher boolean;
begin
  select role into joining_role from profiles where id = new.user_id;
  select count(*) into member_count from chat_members where chat_id = new.chat_id;
  select exists (
    select 1 from chat_members m join profiles p on p.id = m.user_id
    where m.chat_id = new.chat_id and p.role = 'teacher'
  ) into has_teacher;

  if member_count >= 3 and not has_teacher and coalesce(joining_role, '') <> 'teacher' then
    raise exception 'chat_full: chats can only have 3 people unless a teacher is in it'
      using errcode = 'P0001';
  end if;

  if joining_role = 'teacher' then
    if has_teacher then
      new.member_role := 'manager';
    else
      update chat_members set member_role = 'manager'
        where chat_id = new.chat_id and member_role = 'owner';
      new.member_role := 'owner';
    end if;
  end if;

  return new;
end;
$$;

create trigger before_member_join
  before insert on public.chat_members
  for each row execute function public.member_rules();

create function public.promote_new_teacher() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'teacher' and old.role <> 'teacher' then
    update chat_members m set member_role = 'manager'
      where m.member_role = 'owner'
        and m.user_id <> new.id
        and m.chat_id in (select chat_id from chat_members where user_id = new.id)
        and not exists (
          select 1 from chat_members t join profiles p on p.id = t.user_id
          where t.chat_id = m.chat_id and p.role = 'teacher' and t.user_id <> new.id
        );
    update chat_members m set member_role = 'owner'
      where m.user_id = new.id
        and not exists (
          select 1 from chat_members t join profiles p on p.id = t.user_id
          where t.chat_id = m.chat_id and p.role = 'teacher' and t.user_id <> new.id
        );
  end if;
  return new;
end;
$$;

create trigger on_role_change
  after update of role on public.profiles
  for each row execute function public.promote_new_teacher();

create function public.spam_key(m public.messages) returns text
language sql immutable as $$
  select m.kind || ':' || coalesce(m.sticker_id::text, lower(regexp_replace(trim(m.body), '\s+', ' ', 'g')));
$$;

create function public.block_spam() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  repeats int;
begin
  if new.user_id is null or new.kind = 'image' then
    return new;
  end if;
  select count(*) into repeats from (
    select m from messages m
    where m.chat_id = new.chat_id
    order by m.id desc
    limit 2
  ) last_two
  where (last_two.m).user_id = new.user_id
    and public.spam_key(last_two.m) = public.spam_key(new);
  if repeats >= 2 then
    raise exception 'spam: you already sent that twice in a row'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger before_message_insert
  before insert on public.messages
  for each row execute function public.block_spam();

create function public.bump_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update chats set last_message_at = new.created_at where id = new.chat_id;
  if new.user_id is not null then
    update chat_members set last_read_at = new.created_at
      where chat_id = new.chat_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger after_message_insert
  after insert on public.messages
  for each row execute function public.bump_chat();

create function public.create_chat(me uuid, user_ids uuid[], chat_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  others uuid[];
  found uuid;
  made uuid;
  person uuid;
begin
  select coalesce(array_agg(distinct u), '{}') into others
    from unnest(user_ids) u
    where u <> me and exists (select 1 from profiles where id = u);

  if cardinality(others) = 0 then
    select c.id into found from chats c
      join chat_members m on m.chat_id = c.id and m.user_id = me
      where c.kind = 'self' limit 1;
  elsif cardinality(others) = 1 and nullif(trim(chat_name), '') is null then
    select c.id into found from chats c
      where c.kind = 'dm'
        and exists (select 1 from chat_members m where m.chat_id = c.id and m.user_id = me)
        and exists (select 1 from chat_members m where m.chat_id = c.id and m.user_id = others[1])
      limit 1;
  end if;
  if found is not null then
    return found;
  end if;

  insert into chats (name, kind, created_by)
    values (
      nullif(trim(chat_name), ''),
      case when cardinality(others) = 0 then 'self'
           when cardinality(others) = 1 and nullif(trim(chat_name), '') is null then 'dm'
           else 'group' end,
      me
    )
    returning id into made;

  insert into chat_members (chat_id, user_id, member_role) values (made, me, 'owner');

  for person in
    select p.id from profiles p where p.id = any(others)
    order by (p.role = 'teacher') desc
  loop
    insert into chat_members (chat_id, user_id) values (made, person);
  end loop;

  return made;
end;
$$;

create function public.home_feed() returns table (
  chat_id uuid,
  name text,
  kind text,
  my_role text,
  last_message_at timestamptz,
  unread_count bigint,
  last_message jsonb,
  member_ids uuid[]
)
language sql stable security definer set search_path = public as $$
  select
    c.id,
    c.name,
    c.kind,
    me.member_role,
    c.last_message_at,
    (select count(*) from messages m
      where m.chat_id = c.id and m.created_at > me.last_read_at
        and m.status = 'visible' and m.user_id is distinct from auth.uid()),
    (select jsonb_build_object('id', m.id, 'user_id', m.user_id, 'kind', m.kind, 'body', m.body, 'is_ai', m.is_ai, 'created_at', m.created_at)
      from messages m where m.chat_id = c.id and m.status = 'visible'
      order by m.id desc limit 1),
    (select array_agg(x.user_id) from chat_members x where x.chat_id = c.id)
  from chats c
  join chat_members me on me.chat_id = c.id and me.user_id = auth.uid()
  order by c.last_message_at desc;
$$;

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.stickers enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_log enable row level security;
alter table public.wiki_pages enable row level security;

create policy "signed in users see profiles" on public.profiles
  for select to authenticated using (true);
create policy "members see chats" on public.chats
  for select to authenticated using (public.is_member(id));
create policy "members see members" on public.chat_members
  for select to authenticated using (public.is_member(chat_id));
create policy "members read messages" on public.messages
  for select to authenticated using (public.is_member(chat_id) and (status = 'visible' or public.is_mod()));
create policy "everyone sees approved stickers" on public.stickers
  for select to authenticated using (status = 'approved' or owner_id = auth.uid() or public.is_mod());
create policy "see your own reports" on public.reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_mod());
create policy "mods see moderation log" on public.moderation_log
  for select to authenticated using (public.is_mod());
create policy "everyone reads the wiki" on public.wiki_pages
  for select to authenticated using (true);

revoke insert, update, delete on all tables in schema public from anon, authenticated;
revoke execute on function public.create_chat(uuid, uuid[], text) from anon, authenticated, public;
grant execute on function public.create_chat(uuid, uuid[], text) to service_role;
revoke execute on function public.home_feed() from anon, public;
grant execute on function public.home_feed() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('stickers', 'stickers', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('images', 'images', false, 4194304, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

insert into public.wiki_pages (slug, title, body) values
  ('wicky', 'Who is WICKY', 'WICKY is the Chadwick mascot and the face of this chat app. Output Club made the app in 2026.'),
  ('chat-rules', 'Chat rules', 'Be kind. No swearing, no spam, no sharing other peoples private info. Chats can have 3 people max unless a teacher is in it. Report anything weird with the report button.');

alter publication supabase_realtime add table public.messages, public.chats, public.chat_members;
