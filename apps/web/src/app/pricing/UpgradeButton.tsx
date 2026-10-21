import Link from 'next/link';
import { upgradePath } from '@/lib/plans';

interface UpgradeButtonProps {
  plan: 'plus' | 'pro' | 'team';
  label: string;
  className: string;
}

/**
 * Sends the buyer to /upgrade/<plan>, which starts the CoinPay checkout (every
 * coin plus PayPal) and sends signed-out buyers through login first. The
 * CoinPay webhook grants the plan once payment confirms.
 */
export function UpgradeButton({ plan, label, className }: UpgradeButtonProps) {
  return (
    <Link href={upgradePath(plan)} className={className} data-testid={`upgrade-${plan}`}>
      {label}
    </Link>
  );
}
