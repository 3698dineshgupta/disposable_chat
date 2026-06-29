'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Send } from 'lucide-react';
import { formatDuration } from '@/lib/utils';

interface Props {
  onSend: (blob: Blob, duration: number) => void;
  onCancel: () => void;
}

export default function VoiceRecorder({ onSend, onCancel }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [bars, setBars] = useState<number[]>(Array(20).fill(4));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      stopTimer();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const stopTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      /* Visualisation */
      const updateBars = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const barValues = Array.from({ length: 20 }, (_, i) => {
          const val = data[Math.floor(i * data.length / 20)] / 255;
          return Math.max(4, Math.round(val * 32));
        });
        setBars(barValues);
        animFrameRef.current = requestAnimationFrame(updateBars);
      };
      updateBars();

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);

      intervalRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch {
      onCancel();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    stopTimer();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsRecording(false);
  };

  const handleSend = () => {
    if (audioBlob) onSend(audioBlob, duration);
  };

  const handleCancel = () => {
    if (isRecording) stopRecording();
    onCancel();
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-chat-input rounded-full border border-chat-border">
      {/* Cancel */}
      <button onClick={handleCancel} className="p-2 rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition flex-shrink-0">
        <Trash2 className="w-5 h-5" />
      </button>

      {/* Waveform */}
      <div className="flex-1 flex items-center gap-0.5 h-8">
        {bars.map((h, i) => (
          <div
            key={i}
            className="waveform-bar flex-1"
            style={{
              height: `${h}px`,
              animationDelay: `${i * 0.04}s`,
              opacity: isRecording ? 1 : 0.5,
            }}
          />
        ))}
      </div>

      {/* Duration */}
      <span className="text-sm font-mono text-brand-500 flex-shrink-0">{formatDuration(duration)}</span>

      {/* Record/Stop + Send */}
      {isRecording ? (
        <button
          onClick={stopRecording}
          className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center animate-pulse flex-shrink-0"
        >
          <Square className="w-4 h-4 text-white fill-white" />
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!audioBlob}
          className="w-10 h-10 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0 disabled:opacity-50"
        >
          <Send className="w-4 h-4 text-white" />
        </button>
      )}
    </div>
  );
}
