import { z } from 'zod';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { authenticatePartner } from '@/lib/partners';
import {
  PartnerSessionError,
  endPartnerSession,
  partnerSessionStatus,
} from '@/lib/partner-sessions';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const idSchema = z.guid('Invalid session ID');

/** GET /api/v1/partner/sessions/:id: status and live roster of the partner's own session. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const partner = authenticatePartner(request);
    if (!partner) return errorResponse('Unknown or missing partner key', 401);
    const sessionId = idSchema.parse((await params).sessionId);
    return successResponse(await partnerSessionStatus(serviceClient(), partner, sessionId));
  } catch (error) {
    if (error instanceof PartnerSessionError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}

/** DELETE /api/v1/partner/sessions/:id: end the partner's session for everyone. */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const partner = authenticatePartner(request);
    if (!partner) return errorResponse('Unknown or missing partner key', 401);
    const sessionId = idSchema.parse((await params).sessionId);
    return successResponse(await endPartnerSession(serviceClient(), partner, sessionId));
  } catch (error) {
    if (error instanceof PartnerSessionError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
