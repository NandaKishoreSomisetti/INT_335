-- ============================================================================
-- PARKTRACE Supabase Migration: 001_create_profiles.sql
-- ============================================================================
-- Creates the `public.profiles` table linked to `auth.users(id)` with Row Level
-- Security (RLS) policies and an automatic trigger (`on_auth_user_created`) that
-- mirrors newly registered users into `public.profiles`.
-- ============================================================================

-- 1. Create `public.profiles` table referencing `auth.users(id)`
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'staff', 'admin')),
  campus_affiliation text CHECK (campus_affiliation IN ('student', 'staff') OR campus_affiliation IS NULL),
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for quick email lookups
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies for `public.profiles`
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 4. Automatic `updated_at` timestamp trigger function
CREATE OR REPLACE FUNCTION public.handle_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profiles_updated ON public.profiles;
CREATE TRIGGER on_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profiles_updated_at();

-- 5. Automatic user mirroring trigger from `auth.users` -> `public.profiles`
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  extracted_name text;
  extracted_affiliation text;
  assigned_role text;
BEGIN
  extracted_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'fullName'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(COALESCE(NEW.email, ''), '@', 1)
  );

  extracted_affiliation := CASE
    WHEN LOWER(COALESCE(NEW.raw_user_meta_data->>'campus_affiliation', '')) IN ('student', 'staff')
      THEN LOWER(NEW.raw_user_meta_data->>'campus_affiliation')
    ELSE NULL
  END;

  assigned_role := CASE
    WHEN LOWER(COALESCE(NEW.email, '')) = 'parktrace.1341@gmail.com' THEN 'staff'
    ELSE 'member'
  END;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    campus_affiliation,
    avatar_url,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    LOWER(COALESCE(NEW.email, '')),
    COALESCE(extracted_name, 'Campus Member'),
    assigned_role,
    extracted_affiliation,
    NEW.raw_user_meta_data->>'avatar_url',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = CASE
      WHEN public.profiles.full_name IS NULL OR public.profiles.full_name = ''
        THEN EXCLUDED.full_name
      ELSE public.profiles.full_name
    END,
    updated_at = timezone('utc'::text, now());

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

