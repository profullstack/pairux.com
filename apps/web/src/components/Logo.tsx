import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: { height: 24 },
  md: { height: 32 },
  lg: { height: 40 },
};

export function Logo({ size = 'md', className }: LogoProps) {
  const sizeConfig = sizes[size];
  // Logo aspect ratio is approximately 2.83:1 (512.75 / 181.44)
  const width = Math.round(sizeConfig.height * 2.83);

  return (
    <Link href="/" className={cn('flex items-center', className)}>
      <Image
        src="/logo.svg"
        alt="PairUX"
        width={width}
        height={sizeConfig.height}
        className="h-auto"
        style={{ height: sizeConfig.height }}
        priority
      />
    </Link>
  );
}
