-- Create table for storing history logs
create table if not exists public.history_logs (
    id uuid default gen_random_uuid() primary key,
    action text not null,
    details text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create table for storing history settings (e.g. retention period)
create table if not exists public.history_settings (
    key text primary key,
    value text not null
);

-- Insert default retention setting (default to 7 days)
insert into public.history_settings (key, value)
values ('retention_days', '7')
on conflict (key) do nothing;

-- Enable Row Level Security (RLS) if you want to restrict access
-- For now, we assume the service role or admin client handles auth, 
-- but it is good practice to enable RLS.

alter table public.history_logs enable row level security;
alter table public.history_settings enable row level security;

-- Policy to allow anon/authenticated read/write (Modify according to your security posture)
-- In this project's context, it seems open or handled by client logic
create policy "Allow all access to history_logs" on public.history_logs for all using (true) with check (true);
create policy "Allow all access to history_settings" on public.history_settings for all using (true) with check (true);
