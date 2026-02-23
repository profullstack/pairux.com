'use client';

import { TypeAnimation } from 'react-type-animation';

const sequence = [
  'programming',
  2000,
  'pitching',
  2000,
  'presenting',
  2000,
  'demoing',
  2000,
  'designing',
  2000,
  'debugging',
  2000,
  'teaching',
  2000,
  'training',
  2000,
  'reviewing',
  2000,
  'brainstorming',
  2000,
];

export function RotatingText() {
  return (
    <span className="inline-flex items-baseline">
      <TypeAnimation
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
