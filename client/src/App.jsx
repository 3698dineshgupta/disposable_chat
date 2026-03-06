import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SocketProvider } from './contexts/SocketContext';
import Home from './pages/Home';
import Chat from './pages/Chat';

export default function App() {
  return (
    <BrowserRouter>
      <SocketProvider>
        <div className="h-full w-full bg-slate-900 text-slate-100 min-h-screen">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/chat/:roomId" element={<Chat />} />
          </Routes>
        </div>
      </SocketProvider>
    </BrowserRouter>
  );
}
