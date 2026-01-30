/**
 * Auth group layout — stack navigator for login/signup (no tabs).
 */
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#ffffff' },
      }}
    />
  );
}
