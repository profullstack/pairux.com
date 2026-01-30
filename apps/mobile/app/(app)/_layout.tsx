/**
 * App group layout — bottom tab navigator for authenticated screens.
 */
import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Dashboard: '~',
    Host: '+',
    Join: '>',
    Settings: '*',
  };
  return (
    <View className="items-center">
      <Text className={`text-lg font-bold ${focused ? 'text-primary-600' : 'text-gray-400'}`}>
        {icons[name] ?? '?'}
      </Text>
    </View>
  );
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#ffffff' },
        headerTitleStyle: { fontWeight: '600', color: '#111827' },
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e5e7eb',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => <TabIcon name="Dashboard" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="host"
        options={{
          title: 'Host',
          tabBarIcon: ({ focused }) => <TabIcon name="Host" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="join"
        options={{
          title: 'Join',
          tabBarIcon: ({ focused }) => <TabIcon name="Join" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon name="Settings" focused={focused} />,
        }}
      />
      {/* Hide session route from tab bar */}
      <Tabs.Screen
        name="session/[id]"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
