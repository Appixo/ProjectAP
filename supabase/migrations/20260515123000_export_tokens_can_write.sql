-- Allow individual export tokens to also write training sessions via
-- POST /api/sessions. Default is false so existing tokens stay read-only.
--
-- Apply: paste into Supabase Studio -> SQL Editor -> Run.

alter table public.export_tokens
  add column if not exists can_write boolean not null default false;
