'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Monitor,
  Plus,
  Play,
  Square,
  Trash2,
  Loader2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import {
  type Device,
  type DeviceStatus,
  deviceNameFromUrl,
  describeDeviceError,
  getDeviceStatus,
  loadDevices,
  normalizeDeviceUrl,
  saveDevices,
  startDeviceSession,
  stopDeviceSession,
} from '@/lib/devices';

interface DeviceCardState {
  status: DeviceStatus | null;
  busy: boolean;
  error: string | null;
  joinUrl: string | null;
}

const IDLE: DeviceCardState = { status: null, busy: false, error: null, joinUrl: null };

export default function DevicesPage() {
  const t = useTranslations('devices');
  const [devices, setDevices] = useState<Device[]>([]);
  const [cards, setCards] = useState<Record<string, DeviceCardState>>({});
  const [input, setInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    setDevices(loadDevices());
  }, []);

  const patch = useCallback((id: string, next: Partial<DeviceCardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...IDLE, ...prev[id], ...next } }));
  }, []);

  const refresh = useCallback(
    async (device: Device) => {
      patch(device.id, { busy: true, error: null });
      try {
        const status = await getDeviceStatus(device.url);
        patch(device.id, { status, busy: false });
      } catch (error) {
        patch(device.id, {
          busy: false,
          error: error instanceof Error ? error.message : describeDeviceError(error),
        });
      }
    },
    [patch]
  );

  // Check each device once on load so the page opens with real state.
  useEffect(() => {
    for (const device of devices) void refresh(device);
  }, [devices, refresh]);

  const addDevice = (event: React.FormEvent) => {
    event.preventDefault();
    const url = normalizeDeviceUrl(input);
    if (!url) {
      setAddError(t('errors.invalidAddress'));
      return;
    }

    if (devices.some((d) => d.url === url)) {
      setAddError(t('errors.duplicate'));
      return;
    }

    const device: Device = { id: crypto.randomUUID(), name: deviceNameFromUrl(url), url };
    const next = [...devices, device];
    setDevices(next);
    saveDevices(next);
    setInput('');
    setAddError(null);
  };

  const removeDevice = (id: string) => {
    const next = devices.filter((d) => d.id !== id);
    setDevices(next);
    saveDevices(next);
  };

  const start = async (device: Device) => {
    patch(device.id, { busy: true, error: null, joinUrl: null });
    try {
      const session = await startDeviceSession(device.url);
      patch(device.id, {
        busy: false,
        joinUrl: session.url,
        status: { sharing: true, sessionId: session.sessionId, joinCode: session.joinCode },
      });
    } catch (error) {
      patch(device.id, {
        busy: false,
        error: error instanceof Error ? error.message : describeDeviceError(error),
      });
    }
  };

  const stop = async (device: Device) => {
    patch(device.id, { busy: true, error: null });
    try {
      await stopDeviceSession(device.url);
      patch(device.id, {
        busy: false,
        joinUrl: null,
        status: { sharing: false, sessionId: null, joinCode: null },
      });
    } catch (error) {
      patch(device.id, {
        busy: false,
        error: error instanceof Error ? error.message : describeDeviceError(error),
      });
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-2 text-sm text-gray-600">
        {t.rich('intro', { code: (chunks) => <code>{chunks}</code> })}
      </p>

      <form onSubmit={addDevice} className="mt-6 flex gap-2">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
          placeholder="my-laptop.tailnet-1234.ts.net"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base"
          aria-label={t('addressLabel')}
        />
        <button
          type="submit"
          className="flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          {t('add')}
        </button>
      </form>

      {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}

      {devices.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <Monitor className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-3 text-sm text-gray-600">
            {t.rich('empty', { code: (chunks) => <code>{chunks}</code> })}
          </p>
          <Link
            href="/docs#remote-start"
            className="mt-3 inline-block text-sm text-blue-700 underline"
          >
            {t('howToSetUp')}
          </Link>
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {devices.map((device) => {
          const card = cards[device.id] ?? IDLE;
          const sharing = card.status?.sharing ?? false;

          return (
            <li key={device.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${sharing ? 'bg-green-500' : 'bg-gray-300'}`}
                      aria-hidden
                    />
                    <span className="truncate font-medium">{device.name}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">{device.url}</p>
                </div>

                <button
                  onClick={() => {
                    removeDevice(device.id);
                  }}
                  className="shrink-0 rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label={t('remove', { name: device.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {card.error && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{card.error}</span>
                </div>
              )}

              {card.joinUrl && (
                <a
                  href={card.joinUrl}
                  className="mt-3 flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm font-medium text-green-800"
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  {t('joinSession', { name: device.name })}
                </a>
              )}

              <div className="mt-3 flex gap-2">
                {sharing ? (
                  <button
                    onClick={() => void stop(device)}
                    disabled={card.busy}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {card.busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                    {t('stopSharing')}
                  </button>
                ) : (
                  <button
                    onClick={() => void start(device)}
                    disabled={card.busy}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    {card.busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {t('startSharing')}
                  </button>
                )}

                <button
                  onClick={() => void refresh(device)}
                  disabled={card.busy}
                  className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {t('check')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
