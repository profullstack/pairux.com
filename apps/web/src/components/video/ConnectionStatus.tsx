'use client';

import { Monitor, Loader2, AlertCircle, WifiOff, RefreshCw } from 'lucide-react';
import type { ConnectionState } from '@pairux/shared-types';

interface ConnectionStatusProps {
  connectionState: ConnectionState;
  error: string | null;
  onReconnect?: (() => void) | undefined;
}

export function ConnectionStatus({ connectionState, error, onReconnect }: ConnectionStatusProps) {
  // Only show overlay for non-connected states
  if (connectionState === 'connected') {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80">
      <div className="text-center">
        {connectionState === 'idle' && <IdleState />}

        {connectionState === 'connecting' && <ConnectingState />}

        {connectionState === 'reconnecting' && <ReconnectingState error={error} />}

        {connectionState === 'failed' && <FailedState error={error} onReconnect={onReconnect} />}

        {connectionState === 'disconnected' && <DisconnectedState onReconnect={onReconnect} />}
      </div>
    </div>
  );
}

function IdleState() {
  return (
    <>
      <div className="rounded-full bg-gray-800 p-6">
        <Monitor className="h-16 w-16 text-gray-600" />
      </div>
      <h2 className="mt-6 text-xl font-semibold text-white">Waiting for screen share</h2>
      <p className="mt-2 max-w-md text-sm text-gray-400">
        The host hasn&apos;t started sharing their screen yet. You&apos;ll see their screen here
        once they begin.
      </p>
    </>
  );
}

function ConnectingState() {
  return (
    <>
      <div className="rounded-full bg-gray-800 p-6">
        <Loader2 className="h-16 w-16 animate-spin text-blue-400" />
      </div>
      <h2 className="mt-6 text-xl font-semibold text-white">Connecting...</h2>
      <p className="mt-2 max-w-md text-sm text-gray-400">
        Establishing a secure connection to the host. This usually takes a few seconds.
      </p>
    </>
  );
}

function ReconnectingState({ error }: { error: string | null }) {
  return (
    <>
      <div className="rounded-full bg-yellow-900/50 p-6">
        <RefreshCw className="h-16 w-16 animate-spin text-yellow-400" />
      </div>
      <h2 className="mt-6 text-xl font-semibold text-white">Reconnecting...</h2>
      <p className="mt-2 max-w-md text-sm text-gray-400">
        {error ?? 'Connection interrupted. Attempting to reconnect...'}
      </p>
    </>
  );
}

function FailedState({
  error,
  onReconnect,
}: {
  error: string | null;
  onReconnect?: (() => void) | undefined;
}) {
  return (
    <>
      <div className="rounded-full bg-red-900/50 p-6">
        <AlertCircle className="h-16 w-16 text-red-400" />
      </div>
      <h2 className="mt-6 text-xl font-semibold text-white">Connection Failed</h2>
      <p className="mt-2 max-w-md text-sm text-gray-400">
        {error ?? 'Unable to establish a connection. Please check your network and try again.'}
      </p>
      {onReconnect && (
        <button
          type="button"
          onClick={onReconnect}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </button>
      )}
    </>
  );
}

function DisconnectedState({ onReconnect }: { onReconnect?: (() => void) | undefined }) {
  return (
    <>
      <div className="rounded-full bg-gray-800 p-6">
        <WifiOff className="h-16 w-16 text-gray-500" />
      </div>
      <h2 className="mt-6 text-xl font-semibold text-white">Host Disconnected</h2>
      <p className="mt-2 max-w-md text-sm text-gray-400">
        The host has stopped sharing or disconnected. Waiting for them to reconnect...
      </p>
      {onReconnect && (
        <button
          type="button"
          onClick={onReconnect}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600"
        >
          <RefreshCw className="h-4 w-4" />
          Reconnect
        </button>
      )}
    </>
  );
}
