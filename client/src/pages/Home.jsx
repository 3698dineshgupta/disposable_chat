import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
    const [roomId, setRoomId] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const createRoom = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/rooms/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (data.roomId) {
                navigate(`/chat/${data.roomId}`, { state: { password, userIsCreator: true } });
            }
        } catch (err) {
            console.error('Failed to create room:', err);
            alert(`Failed to connect to server: ${err.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    const joinRoom = (e) => {
        e.preventDefault();
        if (roomId.trim()) {
            navigate(`/chat/${roomId.trim()}`);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-slate-800 p-8 shadow-xl border border-slate-700">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">Disposable Chat</h1>
                    <p className="text-slate-400">Secure, temporary, end-to-end encrypted messaging.</p>
                </div>

                <div className="space-y-4 mb-6">
                    <input
                        type="password"
                        placeholder="Room Password (optional)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                        onClick={createRoom}
                        disabled={loading}
                        className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-white font-medium hover:bg-indigo-700 transition flex items-center justify-center disabled:opacity-50"
                    >
                        {loading ? 'Generating...' : 'Create New Room'}
                    </button>
                </div>

                <div className="my-6 flex items-center text-slate-500">
                    <div className="flex-grow border-t border-slate-700"></div>
                    <span className="px-3 text-sm">or join existing</span>
                    <div className="flex-grow border-t border-slate-700"></div>
                </div>

                <form onSubmit={joinRoom} className="space-y-4">
                    <div>
                        <input
                            type="text"
                            placeholder="Paste Room ID or Link"
                            value={roomId}
                            onChange={(e) => {
                                let val = e.target.value;
                                if (val.includes('/chat/')) {
                                    val = val.split('/chat/')[1];
                                }
                                setRoomId(val);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full rounded-lg bg-slate-700 px-4 py-3 text-white font-medium hover:bg-slate-600 transition"
                    >
                        Join Room
                    </button>
                </form>
            </div>
        </div>
    );
}
