'use client';

import { Phone, PhoneIncoming, PhoneMissed, Video } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { callsApi } from '@/lib/api';
import Avatar from '@/components/ui/Avatar';
import type { Call } from '@/types';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useAuthStore } from '@/store/auth';
import { formatDuration } from '@/lib/utils';

export default function CallHistory() {
  const { user } = useAuthStore();
  const { data, isLoading } = useQuery({
    queryKey: ['calls'],
    queryFn: () => callsApi.getHistory().then((r) => r.data.calls as Call[]),
  });

  const getCallIcon = (call: Call) => {
    const isIncoming = call.callee_id === user?.id;
    if (call.status === 'missed') return <PhoneMissed className="w-4 h-4 text-red-500" />;
    if (call.type === 'video') return <Video className="w-4 h-4 text-brand-500" />;
    if (isIncoming) return <PhoneIncoming className="w-4 h-4 text-brand-500" />;
    return <Phone className="w-4 h-4 text-brand-500" />;
  };

  if (isLoading) return (
    <div className="flex justify-center py-12">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!data?.length) return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-brand-500/10 flex items-center justify-center mb-4">
        <Phone className="w-8 h-8 text-brand-500" />
      </div>
      <p className="text-gray-500 dark:text-gray-400 text-sm">No call history</p>
    </div>
  );

  return (
    <div className="overflow-y-auto h-full">
      {data.map((call) => {
        const isMine = call.caller_id === user?.id;
        const peerName = isMine ? call.callee_name : call.caller_name;
        const peerAvatar = isMine ? call.callee_avatar : call.caller_avatar;
        const time = formatDistanceToNow(parseISO(call.started_at), { addSuffix: true });

        return (
          <div key={call.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
            <Avatar src={peerAvatar} name={peerName ?? '?'} size="md" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{peerName}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {getCallIcon(call)}
                <span className="text-xs text-gray-400 capitalize">{call.status}</span>
                {call.duration > 0 && (
                  <span className="text-xs text-gray-400">· {formatDuration(call.duration)}</span>
                )}
              </div>
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0">{time}</span>
          </div>
        );
      })}
    </div>
  );
}
