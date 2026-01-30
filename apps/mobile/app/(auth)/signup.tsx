/**
 * Sign up screen — registration form with validation.
 *
 * Matches the web SignupForm design and calls the same API endpoint.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';

export default function SignupScreen() {
  const { signup } = useAuth();
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSignup() {
    setError('');

    // Client-side validation
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      setError('All fields are required');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError('Password must contain at least one uppercase letter');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError('Password must contain at least one number');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const result = await signup({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });

      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
          source={require('../../assets/icon.png')}
          className="mb-6 h-16 w-16"
          resizeMode="contain"
        />
        <Text className="mb-2 text-xl font-bold text-gray-900">Check your email</Text>
        <Text className="mb-6 text-center text-gray-500">
          We&apos;ve sent a confirmation email to {email}. Please verify your email address to
          continue.
        </Text>
        <TouchableOpacity
          onPress={() => {
            router.replace('/(auth)/login');
          }}
          className="items-center rounded-lg bg-primary-600 px-6 py-3"
        >
          <Text className="font-semibold text-white">Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
        className="px-6"
      >
        {/* Logo */}
        <View className="mb-6 items-center">
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
            source={require('../../assets/icon.png')}
            className="mb-4 h-16 w-16"
            resizeMode="contain"
          />
          <Text className="text-2xl font-bold text-gray-900">Create your account</Text>
          <Text className="mt-1 text-gray-500">Start sharing your screen with PairUX</Text>
        </View>

        {/* Error */}
        {error ? (
          <View className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <Text className="text-sm text-red-600">{error}</Text>
          </View>
        ) : null}

        {/* Name row */}
        <View className="mb-4 flex-row gap-3">
          <View className="flex-1">
            <Text className="mb-1 text-sm font-medium text-gray-700">First name</Text>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="John"
              placeholderTextColor="#9ca3af"
              autoComplete="given-name"
              className="rounded-lg border border-gray-300 px-4 py-3 text-gray-900"
            />
          </View>
          <View className="flex-1">
            <Text className="mb-1 text-sm font-medium text-gray-700">Last name</Text>
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Doe"
              placeholderTextColor="#9ca3af"
              autoComplete="family-name"
              className="rounded-lg border border-gray-300 px-4 py-3 text-gray-900"
            />
          </View>
        </View>

        {/* Email */}
        <View className="mb-4">
          <Text className="mb-1 text-sm font-medium text-gray-700">Email address</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#9ca3af"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            className="rounded-lg border border-gray-300 px-4 py-3 text-gray-900"
          />
        </View>

        {/* Password */}
        <View className="mb-4">
          <Text className="mb-1 text-sm font-medium text-gray-700">Password</Text>
          <View className="relative">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Min. 8 characters"
              placeholderTextColor="#9ca3af"
              secureTextEntry={!showPassword}
              className="rounded-lg border border-gray-300 px-4 py-3 pr-12 text-gray-900"
            />
            <TouchableOpacity
              onPress={() => {
                setShowPassword(!showPassword);
              }}
              className="absolute right-3 top-3"
            >
              <Text className="text-sm text-gray-400">{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          <Text className="mt-1 text-xs text-gray-400">
            Must include uppercase letter and number
          </Text>
        </View>

        {/* Confirm Password */}
        <View className="mb-6">
          <Text className="mb-1 text-sm font-medium text-gray-700">Confirm password</Text>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm your password"
            placeholderTextColor="#9ca3af"
            secureTextEntry={!showPassword}
            className="rounded-lg border border-gray-300 px-4 py-3 text-gray-900"
          />
        </View>

        {/* Submit */}
        <TouchableOpacity
          onPress={() => {
            void handleSignup();
          }}
          disabled={loading}
          className={`mb-6 items-center rounded-lg px-4 py-3 ${
            loading ? 'bg-primary-400' : 'bg-primary-600'
          }`}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text className="text-base font-semibold text-white">Create account</Text>
          )}
        </TouchableOpacity>

        {/* Login link */}
        <View className="mb-8 flex-row items-center justify-center">
          <Text className="text-sm text-gray-600">Already have an account? </Text>
          <Link href="/(auth)/login">
            <Text className="text-sm font-medium text-primary-600">Sign in</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
