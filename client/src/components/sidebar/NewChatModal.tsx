'use client';

import { useState } from 'react';
import { Search, X, Users } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi, conversationsApi } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { useChatStore } from '@/store/chat';
import Avatar from '@/components/ui/Avatar';
import type { User } from '@/types';
import toast from 'react-hot-toast';

interface Props { onClose: () => void; }

export default function NewChatModal({ onClose }: Props) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const { setActiveConversation, setNewGroupModal } = useUIStore();
  const { addConversation } = useChatStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['user-search', search],
    queryFn: () => usersApi.search(search).then((r) => r.data.users as User[]),
    enabled: search.length >= 2,
    staleTime: 10_000,
  });

  const startChat = async (otherUser: User) => {
    setLoading(otherUser.id);
    try {
      const res = await conversationsApi.getOrCreate(otherUser.id);
      // Merge otherUser fields into the conversation so display name / keys are available immediately
      const ou = res.data.otherUser ?? otherUser;
      const fullConv = {
        ...res.data.conversation,
        other_user_id:              ou.id,
        other_username:             ou.username,
        other_display_name:         ou.display_name,
        other_avatar_url:           ou.avatar_url ?? null,
        other_is_online:            ou.is_online ?? false,
        other_last_seen:            ou.last_seen ?? null,
        other_about:                ou.about ?? null,
        other_public_key:           ou.public_key ?? null,
        other_signing_public_key:   ou.signing_public_key ?? null,
      };
      addConversation(fullConv);
      setActiveConversation(fullConv.id);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to start chat');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">New chat</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or username…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm placeholder-gray-400 focus:outline-none transition"
            />
          </div>
        </div>

        {/* New Group shortcut */}
        <button
          onClick={() => { onClose(); setNewGroupModal(true); }}
          className="flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition border-b border-gray-100 dark:border-gray-800"
        >
          <div className="w-11 h-11 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <span className="font-medium text-brand-500">New group chat</span>
        </button>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto">
          {search.length < 2 && (
            <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-8">
              Type at least 2 characters to search
            </p>
          )}
          {isLoading && search.length >= 2 && (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {data?.map((user) => (
            <button
              key={user.id}
              onClick={() => startChat(user)}
              disabled={loading === user.id}
              className="flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition text-left"
            >
              <Avatar src={user.avatar_url} name={user.display_name} size="md" isOnline={user.is_online} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{user.display_name}</p>
                <p className="text-xs text-gray-400 truncate">@{user.username}</p>
              </div>
              {loading === user.id && (
                <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              )}
            </button>
          ))}
          {data?.length === 0 && search.length >= 2 && !isLoading && (
            <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-8">No users found</p>
          )}
        </div>
      </div>
    </div>
  );
}
