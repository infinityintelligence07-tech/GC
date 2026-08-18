-- Add scope to student_tags to support cancellation-only tags
ALTER TABLE public.student_tags 
ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'student';

-- Add tags array to cancellation_cases for cancellation-scoped tags
ALTER TABLE public.cancellation_cases 
ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;