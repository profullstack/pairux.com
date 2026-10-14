'use client';

import { useLocale, useTranslations } from 'next-intl';
import { TypeAnimation } from 'react-type-animation';

const WORDS = [
  'programming',
  'pitching',
  'presenting',
  'demoing',
  'designing',
  'debugging',
  'teaching',
  'training',
  'reviewing',
  'brainstorming',
] as const;

export function RotatingText() {
  const t = useTranslations('home.rotating');
  const locale = useLocale();
  const sequence = WORDS.flatMap((word) => [t(word), 2000]);
  return (
    <span className="inline-flex items-baseline">
      <TypeAnimation
        // TypeAnimation reads its sequence once on mount; remount on locale change.
        key={locale}
        sequence={sequence}
        wrapper="span"
        speed={50}
        deletionSpeed={40}
        repeat={Infinity}
        className="from-primary-600 via-accent-500 to-primary-600 animate-gradient-x inline-block bg-gradient-to-r bg-[length:200%_auto] bg-clip-text pb-[0.08em] text-transparent"
        cursor={false}
      />
      <span
        aria-hidden="true"
        className="text-primary-600 ml-0.5 inline-block pb-[0.08em]"
        style={{ animation: 'blink 1s step-end infinite' }}
      >
        |
      </span>
    </span>
  );
}
