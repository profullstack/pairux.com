import { SignupForm } from '@/components/auth';
import { Gift, CreditCard, Coins, Sparkles, Check } from 'lucide-react';

export const metadata = {
  title: 'Sign Up - PairUX',
  description: 'Create a PairUX account to start sharing your screen',
};

export default function SignupPage() {
  return (
    <div className="space-y-6">
      {/* Early Adopter Banner */}
      <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
            <Sparkles className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">Early Adopter Bonus</h3>
            <p className="mt-1 text-sm text-amber-700">
              Sign up now and get <span className="font-bold">20% extra credits</span> on any
              deposit!
            </p>
          </div>
        </div>
      </div>

      {/* Waitlist Deposit Card */}
      <div className="border-primary-200 from-primary-50 rounded-xl border-2 bg-gradient-to-br to-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Gift className="text-primary-600 h-5 w-5" />
          <h2 className="text-lg font-bold text-gray-900">Join the Waitlist</h2>
          <span className="bg-primary-100 text-primary-700 rounded-full px-2 py-0.5 text-xs font-medium">
            Recommended
          </span>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          Reserve your spot with a $100 credit deposit and get priority access plus exclusive perks.
        </p>

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500" />
            <span>
              $100 deposit = <span className="font-semibold">$120 in credits</span> (20% bonus)
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500" />
            <span>Priority access when we launch</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500" />
            <span>Locked-in early adopter pricing forever</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500" />
            <span>Exclusive Discord/Slack channel access</span>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <h4 className="text-sm font-medium text-gray-700">Payment Methods</h4>

          {/* Stripe */}
          <button
            disabled
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">Pay with Card</p>
                <p className="text-xs text-gray-500">Visa, Mastercard, Amex via Stripe</p>
              </div>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              Coming Soon
            </span>
          </button>

          {/* CoinPayPortal */}
          <button
            disabled
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <Coins className="h-5 w-5 text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">Pay with Crypto</p>
                <p className="text-xs text-gray-500">BTC, ETH, USDC via CoinPayPortal</p>
              </div>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              Coming Soon
            </span>
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">
          Deposits are fully refundable before launch if you change your mind.
        </p>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-gray-50 px-4 text-gray-500">or sign up for free</span>
        </div>
      </div>

      {/* Regular Signup */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-gray-900">Create a free account</h2>
          <p className="mt-1 text-sm text-gray-600">
            Get started with 2 participants + 5 viewers free forever
          </p>
        </div>
        <SignupForm />
      </div>

      {/* Credit System Info */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h4 className="font-medium text-gray-900">How Credits Work</h4>
        <p className="mt-1 text-sm text-gray-600">
          PairUX uses a credit-based system. Credits are used for SFU relay servers when you need
          more than 5 viewers. <span className="font-medium">$0.08 per viewer-hour at 720p</span>.
          Free tier P2P connections never expire.
        </p>
      </div>
    </div>
  );
}
