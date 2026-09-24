/**
 * AgentStrip — shows the AI agents in the session (joined via the PairUX CLI).
 * Hosts can remove one with a long press.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import type { SessionParticipant } from '@pairux/shared-types';

interface AgentStripProps {
  agents: SessionParticipant[];
  canRemove: boolean;
  onRemove?: (participantId: string) => void;
}

export function AgentStrip({ agents, canRemove, onRemove }: AgentStripProps) {
  if (agents.length === 0) return null;

  function confirmRemove(agent: SessionParticipant) {
    if (!canRemove || !onRemove) return;
    Alert.alert('Remove agent', `Remove ${agent.display_name} from this session?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          onRemove(agent.id);
        },
      },
    ]);
  }

  return (
    <View className="border-b border-gray-800 bg-gray-900 px-4 py-2" testID="agent-strip">
      <Text className="mb-1 text-xs font-medium uppercase tracking-wide text-violet-300">
        Agents ({agents.length})
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {agents.map((agent) => (
            <TouchableOpacity
              key={agent.id}
              onLongPress={() => {
                confirmRemove(agent);
              }}
              disabled={!canRemove}
              accessibilityLabel={`Agent ${agent.display_name}${canRemove ? ', long press to remove' : ''}`}
              className="flex-row items-center gap-1.5 rounded-full bg-violet-900/60 px-3 py-1"
            >
              <Text className="text-xs">🤖</Text>
              <Text className="text-xs font-medium text-violet-100">{agent.display_name}</Text>
              {agent.agent_client ? (
                <Text className="text-xs text-violet-300">· {agent.agent_client}</Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
