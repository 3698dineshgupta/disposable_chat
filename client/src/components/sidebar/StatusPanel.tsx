'use client';

import { Plus, Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { statusApi } from '@/lib/api';
import Avatar from '@/components/ui/Avatar';
import type { Status } from '@/types';
import { useAuthStore } from '@/store/auth';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useState } from 'react';

export default function StatusPanel() {
  const { user } = useAuthStore();
  const [viewingStatus, setViewingStatus] = useState<Status | null>(null);

  const { data } = useQuery({
    queryKey: ['statuses'],
    queryFn: () => statusApi.list().then((r) => r.data.statuses as Status[]),
  });

  const myStatuses = data?.filter((s) => s.user_id === user?.id) ?? [];
  const othersStatuses = data?.filter((s) => s.user_id !== user?.id) ?? [];

  /* Group other statuses by user */
  const grouped = othersStatuses.reduce<Record<string, Status[]>>((acc, s) => {
    if (!acc[s.user_id]) acc[s.user_id] = [];
    acc[s.user_id].push(s);
    return acc;
  }, {});

  return (
    <div className="overflow-y-auto h-full">
      {/* My status */}
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">My Status</p>
        <button className="flex items-center gap-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl p-2 transition">
          <div className="relative">
            <Avatar src={user?.avatar_url} name={user?.display_name ?? ''} size="md" hasStatus={myStatuses.length > 0} />
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-brand-500 border-2 border-white dark:border-gray-900 flex items-center justify-center">
              <Plus className="w-3 h-3 text-white" />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Add to my status</p>
            <p className="text-xs text-gray-400">
              {myStatuses.length > 0 ? `${myStatuses.length} update${myStatuses.length > 1 ? 's' : ''}` : 'Share photos, text and more'}
            </p>
          </div>
        </button>
      </div>

      {Object.keys(grouped).length > 0 && (
        <div className="px-4 pt-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Recent updates</p>
          {Object.entries(grouped).map(([userId, statuses]) => {
            const latest = statuses[0];
            const allViewed = statuses.every((s) => s.viewed);
            return (
              <button
                key={userId}
                onClick={() => setViewingStatus(latest)}
                className="flex items-center gap-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl p-2 transition"
              >
                <Avatar
                  src={latest.avatar_url}
                  name={latest.display_name}
                  size="md"
                  hasStatus={!allViewed}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{latest.display_name}</p>
                  <p className="text-xs text-gray-400">{formatDistanceToNow(parseISO(latest.created_at), { addSuffix: true })}</p>
                </div>
                {!allViewed && (
                  <div className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Status viewer overlay */}
      {viewingStatus && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setViewingStatus(null)}
        >
          <button
            className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10"
            onClick={() => setViewingStatus(null)}
          >✕</button>
          <div className="max-w-sm w-full mx-4">
            {viewingStatus.type === 'text' && (
              <div
                className="rounded-2xl p-8 text-white text-xl font-semibold text-center min-h-48 flex items-center justify-center"
                style={{ backgroundColor: viewingStatus.background_color }}
              >
                {viewingStatus.content}
              </div>
            )}
            {viewingStatus.type === 'image' && viewingStatus.media_url && (
              <img src={viewingStatus.media_url} alt="Status" className="rounded-2xl w-full" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
