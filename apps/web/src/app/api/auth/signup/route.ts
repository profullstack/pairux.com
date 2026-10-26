import { createClient } from '@/lib/supabase/server';
import { signupSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { NextResponse } from 'next/server';
import { validateProfile, saveSignupProfile } from '@profullstack/profile';
import { profileStore } from '@/lib/profile';

function optional(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : '';
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const { email, password, firstName, lastName } = signupSchema.parse(body);

    // The shared @profullstack/profile fields: first/last name required,
    // company domain, job title and LinkedIn optional. Validated before the
    // user exists, stored on public.profiles right after.
    const fields = {
      email,
      first_name: firstName,
      last_name: lastName,
      company_domain: optional(body, 'company_domain'),
      job_title: optional(body, 'job_title'),
      linkedin_url: optional(body, 'linkedin_url'),
    };
    const check = validateProfile(fields);
    if (!check.ok) {
      const first = Object.values(check.errors)[0] ?? 'Some fields need fixing.';
      return NextResponse.json({ error: first, fieldErrors: check.errors }, { status: 400 });
    }
    const p = check.profile;

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          display_name: `${firstName} ${lastName}`,
          company_domain: p.company_domain ?? null,
          job_title: p.job_title ?? null,
          linkedin_url: p.linkedin_url ?? null,
        },
        // Skip email confirmation for now - remove this line once SMTP is working
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com'}/auth/callback`,
      },
    });

    if (error) {
      console.error('Supabase signup error:', {
        message: error.message,
        status: error.status,
        code: error.code,
        name: error.name,
      });
      return errorResponse(error.message, 400);
    }

    if (!data.user) {
      return errorResponse('Failed to create user', 500);
    }

    // An address that is already registered comes back as a stand-in user with
    // no identities; never write a profile for it. A failed save never fails
    // the signup: the fields are also in user metadata and on Settings.
    if ((data.user.identities?.length ?? 0) > 0) {
      try {
        await saveSignupProfile(profileStore(), data.user.id, fields, {
          email: data.user.email ?? null,
        });
      } catch (e) {
        console.error('[signup] profile save failed', e);
      }
    }

    // Check if user needs email confirmation or is already confirmed
    const needsConfirmation = !data.user.confirmed_at && !data.session;

    return successResponse(
      {
        user: {
          id: data.user.id,
          email: data.user.email,
        },
        message: needsConfirmation
          ? 'Check your email to confirm your account'
          : 'Account created successfully',
        needsConfirmation,
      },
      201
    );
  } catch (error) {
    console.error('Signup route error:', error);
    return handleApiError(error);
  }
}
