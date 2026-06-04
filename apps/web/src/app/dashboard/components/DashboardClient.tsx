'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Monitor, Users, Calendar } from 'lucide-react';
import { RecentSessions } from './RecentSessions';
import { UpcomingMeetings } from './UpcomingMeetings';
import { ScheduleMeetingModal } from './ScheduleMeetingModal';

export function DashboardClient() {
  const [showSchedule, setShowSchedule] = useState(false);
  const [meetingsKey, setMeetingsKey] = useState(0);

  function handleCreated() {
    setShowSchedule(false);
    setMeetingsKey((k) => k + 1);
  }

  return (
    <>
      {showSchedule && (
        <ScheduleMeetingModal
          onClose={() => {
            setShowSchedule(false);
          }}
          onCreated={handleCreated}
        />
      )}

      {/* Welcome Banner */}
      <div className="from-primary-600 to-primary-700 mb-8 rounded-xl bg-gradient-to-r p-6 text-white shadow-lg">
        <h1 className="text-3xl font-bold">Welcome to PairUX</h1>
        <p className="text-primary-100 mt-2">
          Share your screen, collaborate in real-time, and get remote assistance.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/host"
            className="text-primary-600 hover:bg-primary-50 rounded-lg bg-white px-6 py-2 font-semibold transition-colors"
          >
            Start Sharing
          </Link>
          <Link
            href="/join"
            className="border-primary-300 hover:bg-primary-500 rounded-lg border px-6 py-2 font-semibold text-white transition-colors"
          >
            Join Session
          </Link>
          <button
            onClick={() => {
              setShowSchedule(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-white/40 bg-white/10 px-6 py-2 font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <Calendar className="h-4 w-4" />
            Schedule Meeting
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Quick Actions */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Link
                href="/host"
                className="hover:border-primary-300 hover:bg-primary-50 flex items-center gap-3 rounded-lg border border-gray-200 p-4 text-left transition-colors"
              >
                <Monitor className="text-primary-600 h-8 w-8" />
                <div>
                  <p className="font-semibold text-gray-900">Start Session</p>
                  <p className="text-sm text-gray-500">Share your screen</p>
                </div>
              </Link>
              <Link
                href="/join"
                className="hover:border-accent-300 hover:bg-accent-50 flex items-center gap-3 rounded-lg border border-gray-200 p-4 text-left transition-colors"
              >
                <Users className="text-accent-600 h-8 w-8" />
                <div>
                  <p className="font-semibold text-gray-900">Join Session</p>
                  <p className="text-sm text-gray-500">Enter a join code</p>
                </div>
              </Link>
              <button
                onClick={() => {
                  setShowSchedule(true);
                }}
                className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              >
                <Calendar className="h-8 w-8 text-indigo-600" />
                <div>
                  <p className="font-semibold text-gray-900">Schedule Meeting</p>
                  <p className="text-sm text-gray-500">Invite your team</p>
                </div>
              </button>
            </div>
          </div>

          {/* Upcoming Meetings */}
          <UpcomingMeetings
            key={meetingsKey}
            onSchedule={() => {
              setShowSchedule(true);
            }}
          />

          {/* Recent Sessions */}
          <RecentSessions />
        </div>

        {/* Right Column — rendered by parent (server component) */}
      </div>
    </>
  );
}
