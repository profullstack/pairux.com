/**
 * Settings screen — account info and logout.
 */
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/config';

export default function SettingsScreen() {
  const { user, logout } = useAuth();

  function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => void logout(),
      },
    ]);
  }

  return (
    <View className="flex-1 bg-gray-50">
      {/* Account section */}
      <View className="mt-4 bg-white">
        <Text className="px-4 pb-2 pt-4 text-xs font-semibold text-gray-400">ACCOUNT</Text>

        <View className="border-t border-gray-100 px-4 py-4">
          <Text className="text-sm text-gray-500">Email</Text>
          <Text className="mt-0.5 font-medium text-gray-900">{user?.email ?? 'Unknown'}</Text>
        </View>

        <View className="border-t border-gray-100 px-4 py-4">
          <Text className="text-sm text-gray-500">User ID</Text>
          <Text className="mt-0.5 font-mono text-xs text-gray-600">{user?.id ?? 'Unknown'}</Text>
        </View>
      </View>

      {/* App info section */}
      <View className="mt-6 bg-white">
        <Text className="px-4 pb-2 pt-4 text-xs font-semibold text-gray-400">APP INFO</Text>

        <View className="border-t border-gray-100 px-4 py-4">
          <Text className="text-sm text-gray-500">Version</Text>
          <Text className="mt-0.5 font-medium text-gray-900">0.1.0</Text>
        </View>

        <View className="border-t border-gray-100 px-4 py-4">
          <Text className="text-sm text-gray-500">API Server</Text>
          <Text className="mt-0.5 font-mono text-xs text-gray-600">{API_BASE_URL}</Text>
        </View>
      </View>

      {/* Sign out */}
      <View className="mt-6 bg-white">
        <TouchableOpacity onPress={handleLogout} className="border-t border-gray-100 px-4 py-4">
          <Text className="text-center font-medium text-red-600">Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
