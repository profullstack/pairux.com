/**
 * Login screen — email/password authentication.
 *
 * Matches the web LoginForm design and calls the same API endpoint.
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
import { Link } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError('');
    setLoading(true);

    try {
      const result = await login(email.trim(), password);
      if (result.error) {
        setError(result.error);
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
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
        <View className="mb-8 items-center">
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
            source={require('../../assets/icon.png')}
            className="mb-4 h-16 w-16"
            resizeMode="contain"
          />
          <Text className="text-2xl font-bold text-gray-900">Welcome back</Text>
          <Text className="mt-1 text-gray-500">Sign in to your PairUX account</Text>
        </View>

        {/* Error */}
        {error ? (
          <View className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <Text className="text-sm text-red-600">{error}</Text>
          </View>
        ) : null}

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
        <View className="mb-2">
          <Text className="mb-1 text-sm font-medium text-gray-700">Password</Text>
          <View className="relative">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor="#9ca3af"
              secureTextEntry={!showPassword}
              autoComplete="password"
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
        </View>

        {/* Forgot password */}
        <View className="mb-6 items-end">
          <Text className="text-sm text-primary-600">Forgot password?</Text>
        </View>

        {/* Submit */}
        <TouchableOpacity
          onPress={() => {
            void handleLogin();
          }}
          disabled={loading || !email || !password}
          className={`mb-6 items-center rounded-lg px-4 py-3 ${
            loading || !email || !password ? 'bg-primary-400' : 'bg-primary-600'
          }`}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text className="text-base font-semibold text-white">Sign in</Text>
          )}
        </TouchableOpacity>

        {/* Sign up link */}
        <View className="flex-row items-center justify-center">
          <Text className="text-sm text-gray-600">Don&apos;t have an account? </Text>
          <Link href="/(auth)/signup">
            <Text className="text-sm font-medium text-primary-600">Sign up</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
