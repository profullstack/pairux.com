import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { NextRequest } from 'next/server';

// Type for profile with settings (not yet in generated Supabase types)
interface ProfileWithSettings {
  settings?: Record<string, unknown> | null;
}

// GET /api/settings - Get user settings
export async function GET() {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Unauthorized', 401);
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Failed to fetch settings:', error);
      return errorResponse('Failed to fetch settings', 500);
    }

    // profile.settings may be null/undefined, default to empty object
    const settings =
      ((profile as ProfileWithSettings | null)?.settings as Record<string, unknown> | null) ?? {};
    return successResponse({ settings });
  } catch (error) {
    return handleApiError(error);
  }
}

// PUT /api/settings - Update user settings
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Unauthorized', 401);
    }

    const body = (await request.json()) as { settings?: unknown };
    const { settings } = body;

    if (typeof settings !== 'object' || settings === null) {
      return errorResponse('Invalid settings format', 400);
    }

    // Use type assertion to bypass Supabase types until settings column is regenerated
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
    const { data: profile, error } = await (supabase as any)
      .from('profiles')
      .update({ settings })
      .eq('id', user.id)
      .select('settings')
      .single();
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

    if (error) {
      console.error('Failed to update settings:', error);
      return errorResponse('Failed to update settings', 500);
    }

    // profile.settings may be null/undefined, default to empty object
    const updatedSettings = (profile as ProfileWithSettings | null)?.settings ?? {};
    return successResponse({ settings: updatedSettings });
  } catch (error) {
    return handleApiError(error);
  }
}
