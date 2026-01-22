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
    <TypeAnimation
      sequence={sequence}
      wrapper="span"
      speed={50}
      deletionSpeed={40}
      repeat={Infinity}
      className="bg-gradient-to-r from-primary-600 via-accent-500 to-primary-600 bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient-x"
      cursor={true}
    />
  );
}
