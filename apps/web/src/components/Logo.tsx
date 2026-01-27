import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  /** Use 'light' variant on dark backgrounds (white text). Default uses dark text for light backgrounds. */
  variant?: 'default' | 'light';
  /** Set to false to render without a Link wrapper (e.g. when already inside a Link). */
  asLink?: boolean;
  className?: string;
}

const sizes = {
  sm: { height: 28 },
  md: { height: 36 },
  lg: { height: 44 },
};

export function Logo({ size = 'md', variant = 'default', asLink = true, className }: LogoProps) {
  const sizeConfig = sizes[size];
  // Logo aspect ratio is approximately 2.83:1 (512.75 / 181.44)
  const width = Math.round(sizeConfig.height * 2.83);
  const src = variant === 'light' ? '/logo.light.svg' : '/logo.svg';

  const image = (
    <Image
      src={src}
      alt="PairUX"
      width={width}
      height={sizeConfig.height}
      className="h-auto"
      style={{ height: sizeConfig.height }}
      priority
    />
  );

  if (!asLink) {
    return <span className={cn('flex items-center', className)}>{image}</span>;
  }

  return (
    <Link href="/" className={cn('flex items-center', className)}>
      {image}
    </Link>
  );
}
