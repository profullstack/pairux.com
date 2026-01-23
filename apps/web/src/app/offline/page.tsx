'use client';

import { WifiOff } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 px-4 text-white">
      <WifiOff className="mb-6 h-16 w-16 text-gray-400" />
      <h1 className="mb-4 text-2xl font-bold">You&apos;re offline</h1>
      <p className="mb-8 max-w-md text-center text-gray-400">
        PairUX requires an internet connection for real-time screen sharing and collaboration.
        Please check your connection and try again.
      </p>
      <button
        onClick={() => {
          window.location.reload();
        }}
        className="rounded-lg bg-blue-600 px-6 py-3 font-medium transition-colors hover:bg-blue-700"
      >
        Try Again
      </button>
    </div>
  );
}
