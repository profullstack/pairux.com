import type { ApiResponse } from './api';

interface EndHostSessionOptions {
  stopScreenShare: () => Promise<void>;
  endSession: () => Promise<ApiResponse<unknown>>;
  stopHosting: () => void;
  goBack: () => void;
}

/** Ends the server session before tearing down the local host connection. */
export async function endHostSession({
  stopScreenShare,
  endSession,
  stopHosting,
  goBack,
}: EndHostSessionOptions): Promise<void> {
  await stopScreenShare();

  const result = await endSession();
  if (result.error) {
    throw new Error(result.error);
  }

  stopHosting();
  goBack();
}
