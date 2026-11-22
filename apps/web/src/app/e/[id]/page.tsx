import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { CalendarDays, CalendarPlus, Radio } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { LocalTime } from '@/components/live-events/LocalTime';
import { buildGoogleCalendarUrl, buildOutlookUrl } from '@/lib/calendar';
import { SITE_URL } from '@/lib/embed';
import { describeRecurrence, ruleFromRow } from '@/lib/recurrence';
import {
  channelCalendarUrl,
  channelWatchUrl,
  eventUrl,
  googleSubscribeUrl,
  toCalendarEvent,
  viewerOccurrence,
  webcalUrl,
} from '@/lib/live-events/public';
import { publicEvent } from '@/lib/live-events/read';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const row = await publicEvent(id);
  const occ = row ? viewerOccurrence(row, new Date()) : null;
  if (!row || !occ) return { title: 'Event not found · PairUX', robots: { index: false } };
  const when = occ.startsAt.toUTCString().replace(':00 GMT', ' UTC');
  const summary = row.description?.trim().slice(0, 200) ?? '';
  const description = summary === '' ? `${row.channel_name} live on PairUX, ${when}` : summary;
  return {
    title: `${row.title} · ${row.channel_name} · PairUX`,
    description,
    alternates: {
      canonical: eventUrl(SITE_URL, row.id),
      types: { 'text/calendar': channelCalendarUrl(SITE_URL, row.channel_handle) },
    },
    openGraph: {
      title: row.title,
      description,
      url: eventUrl(SITE_URL, row.id),
      type: 'website',
      ...(row.channel_avatar_url ? { images: [row.channel_avatar_url] } : {}),
    },
  };
}

const button =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';

export default async function EventPage({ params }: PageProps) {
  const { id } = await params;
  const row = await publicEvent(id);
  const now = new Date();
  const occ = row ? viewerOccurrence(row, now) : null;
  if (!row || !occ) notFound();

  const [te, locale] = await Promise.all([getTranslations('events'), getLocale()]);
  const cal = toCalendarEvent(row, occ, SITE_URL);
  const rule = ruleFromRow(row);
  const repeats = rule.freq
    ? describeRecurrence({ ...rule, count: occ.remaining ?? 0 }, occ.startsAt)
    : null;
  const watch = channelWatchUrl(SITE_URL, row.channel_handle);
  const feed = channelCalendarUrl(SITE_URL, row.channel_handle);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <section className="py-12">
          <div className="mx-auto max-w-2xl px-4 sm:px-6">
            <Link
              href={`/@${row.channel_handle}`}
              className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:underline"
            >
              {row.channel_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.channel_avatar_url}
                  alt=""
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : null}
              {row.channel_name}
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">{row.title}</h1>

            <p className="mt-4 flex flex-wrap items-center gap-2 text-gray-700">
              {occ.liveNow ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-red-600">
                  <Radio className="h-4 w-4" /> {te('liveNow')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-indigo-500" />
                  <LocalTime iso={occ.startsAt.toISOString()} locale={locale} />
                </span>
              )}
              <span className="text-gray-500">· {row.duration_minutes} min</span>
            </p>
            {repeats ? <p className="mt-1 text-sm text-gray-500">{repeats}</p> : null}

            {row.description ? (
              <p className="mt-6 whitespace-pre-line text-gray-700">{row.description}</p>
            ) : null}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={watch}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <Radio className="h-4 w-4" />
                {te('watch', { channel: row.channel_name })}
              </a>
            </div>

            <h2 className="mt-10 flex items-center gap-2 text-sm font-semibold tracking-wide text-gray-500 uppercase">
              <CalendarPlus className="h-4 w-4" />
              {te('addToCalendar')}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <a
                href={buildGoogleCalendarUrl(cal)}
                target="_blank"
                rel="noopener noreferrer"
                className={button}
              >
                Google
              </a>
              <a
                href={buildOutlookUrl(cal)}
                target="_blank"
                rel="noopener noreferrer"
                className={button}
              >
                Outlook
              </a>
              <a href={`/e/${row.id}/event.ics`} className={button}>
                {te('downloadIcs')}
              </a>
            </div>

            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <a href={webcalUrl(feed)} className="font-medium text-indigo-600 hover:underline">
                {te('subscribe')}
              </a>
              <span className="text-gray-300">·</span>
              <a
                href={googleSubscribeUrl(feed)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-indigo-600 hover:underline"
              >
                {te('subscribeGoogle')}
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
