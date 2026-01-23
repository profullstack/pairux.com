import { Monitor } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const sizes = {
  sm: {
    container: 'h-8 w-8',
    icon: 'h-4 w-4',
    text: 'text-lg',
  },
  md: {
    container: 'h-9 w-9',
    icon: 'h-5 w-5',
    text: 'text-xl',
  },
  lg: {
    container: 'h-10 w-10',
    icon: 'h-6 w-6',
    text: 'text-2xl',
  },
};

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const sizeConfig = sizes[size];

  return (
    <Link href="/" className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'bg-primary-600 flex items-center justify-center rounded-lg',
          sizeConfig.container
        )}
      >
        <Monitor className={cn('text-white', sizeConfig.icon)} />
      </div>
      {showText && <span className={cn('font-bold text-gray-900', sizeConfig.text)}>PairUX</span>}
    </Link>
  );
}
