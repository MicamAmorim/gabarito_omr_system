-- Blueprint for Supabase. Apply through a reviewed migration when the project is connected.
-- Every exposed table uses RLS and owner checks.
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  external_id text,
  created_at timestamptz not null default now()
);
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  name text not null,
  subject text not null,
  question_count int not null check (question_count between 1 and 60),
  alternatives text[] not null,
  answer_key text[] not null,
  max_score numeric(8,2) not null default 10,
  mode text not null check (mode in ('general','student')),
  created_at timestamptz not null default now(),
  check (cardinality(answer_key)=question_count)
);
create table if not exists public.corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  score numeric(8,2) not null,
  correct int not null default 0,
  wrong int not null default 0,
  blank int not null default 0,
  double_marks int not null default 0,
  review int not null default 0,
  reads jsonb not null default '[]'::jsonb,
  audit_image_path text,
  created_at timestamptz not null default now()
);

alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.exams enable row level security;
alter table public.corrections enable row level security;

grant select, insert, update, delete on public.classes, public.students, public.exams, public.corrections to authenticated;

create policy "classes_owner_select" on public.classes for select to authenticated using ((select auth.uid())=user_id);
create policy "classes_owner_insert" on public.classes for insert to authenticated with check ((select auth.uid())=user_id);
create policy "classes_owner_update" on public.classes for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "classes_owner_delete" on public.classes for delete to authenticated using ((select auth.uid())=user_id);

create policy "students_owner_select" on public.students for select to authenticated using ((select auth.uid())=user_id);
create policy "students_owner_insert" on public.students for insert to authenticated with check ((select auth.uid())=user_id);
create policy "students_owner_update" on public.students for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "students_owner_delete" on public.students for delete to authenticated using ((select auth.uid())=user_id);

create policy "exams_owner_select" on public.exams for select to authenticated using ((select auth.uid())=user_id);
create policy "exams_owner_insert" on public.exams for insert to authenticated with check ((select auth.uid())=user_id);
create policy "exams_owner_update" on public.exams for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "exams_owner_delete" on public.exams for delete to authenticated using ((select auth.uid())=user_id);

create policy "corrections_owner_select" on public.corrections for select to authenticated using ((select auth.uid())=user_id);
create policy "corrections_owner_insert" on public.corrections for insert to authenticated with check ((select auth.uid())=user_id);
create policy "corrections_owner_update" on public.corrections for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "corrections_owner_delete" on public.corrections for delete to authenticated using ((select auth.uid())=user_id);
