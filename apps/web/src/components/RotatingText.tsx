'use client';

import { useState, useEffect } from 'react';

const words = [
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
];

export function RotatingText() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % words.length);
        setIsAnimating(false);
      }, 500); // Half of total animation duration
    }, 3000); // Change word every 3 seconds

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <span className="relative inline-block">
      <span
        className={`inline-block transition-all duration-500 ease-out ${
          isAnimating
            ? 'translate-y-8 opacity-0 blur-sm'
            : 'translate-y-0 opacity-100 blur-0'
        }`}
      >
        {words[currentIndex]}
      </span>
      <span
        className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-primary-500 via-accent-500 to-primary-500 bg-[length:200%_100%] animate-gradient-x"
        style={{ width: '100%' }}
      />
    </span>
  );
}
