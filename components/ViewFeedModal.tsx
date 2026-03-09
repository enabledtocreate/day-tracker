'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { parseIcalToDateTitles } from '@/lib/icalParseClient';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';

type Props = {
  subscriptionId: number;
  open: boolean;
  onClose: () => void;
};

type Phase = 'streaming' | 'stream_done' | 'dates';

export function ViewFeedModal({ subscriptionId, open, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('streaming');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rawRef = useRef('');

  useEffect(() => {
    if (!open || subscriptionId <= 0) return;
    setPhase('streaming');
    setContent('Connecting…');
    setError(null);
    rawRef.current = '';

    const streamUrl = api.icalSubscriptions.getStreamUrl(subscriptionId);

    const tryStream = () =>
      fetch(streamUrl, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const reader = res.body?.getReader();
          if (!reader) throw new Error('Stream not supported');
          const streamReader = reader;
          const decoder = new TextDecoder();
          let text = '';
          function read(): Promise<void> {
            return streamReader.read().then(({ value, done }) => {
              if (value) {
                text += decoder.decode(value, { stream: !done });
                rawRef.current = text;
                setContent(text);
              }
              if (!done) return read();
              return Promise.resolve();
            });
          }
          return read().then(() => {
            setPhase('stream_done');
            if (!text) throw new Error('Stream returned empty');
          });
        });

    const tryPreview = () =>
      api.icalSubscriptions.preview(subscriptionId, true).then((data) => {
        if ('error' in data) throw new Error(data.error);
        const text = data.raw ?? data.content ?? '';
        rawRef.current = text;
        setContent(text || '(empty feed)');
        setPhase('stream_done');
      });

    tryStream()
      .catch(() => tryPreview())
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [open, subscriptionId]);

  const handleOk = () => {
    const raw = rawRef.current || content;
    const events = parseIcalToDateTitles(raw);
    if (events.length === 0) {
      setContent('No events found in feed.');
    } else {
      setContent(events.map((ev) => `${ev.date}  ${ev.title}`).join('\n'));
    }
    setPhase('dates');
  };

  const actions =
    phase === 'stream_done' ? (
      <>
        <Button onClick={handleOk}>Show dates and titles</Button>
        <Button onClick={onClose} aria-label="Close">×</Button>
      </>
    ) : phase === 'dates' ? (
      <Button onClick={onClose} aria-label="Close">×</Button>
    ) : (
      <Button onClick={onClose} aria-label="Close">×</Button>
    );

  const body = error ? (
    <pre className="admin-logs-content" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
      Error: {error}
    </pre>
  ) : (
    <pre className="admin-logs-content" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '60vh', overflow: 'auto' }}>
      {content}
    </pre>
  );

  return (
    <Modal open={open} onClose={onClose} title="Feed" actions={actions} aria-label="View feed">
      {body}
    </Modal>
  );
}
