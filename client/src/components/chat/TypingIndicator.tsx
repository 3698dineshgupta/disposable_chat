'use client';

export default function TypingIndicator() {
  return (
    <div className="flex justify-start mt-2 mb-1">
      <div className="bg-chat-theirs rounded-2xl rounded-bl-md px-4 py-2.5 shadow-sm flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-gray-400 typing-dot"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
