/**
 * The collaboration control, in the top bar.
 *
 * Small on purpose: connecting is two fields and a button, and once you are
 * connected the only thing that matters is who else is here.
 */

import { useEffect, useState } from 'react';
import { collab, type CollabState } from '../collab-bridge';

const DEFAULT_URL = 'ws://localhost:8787';

export function CollabBar() {
  const [state, setState] = useState<CollabState>({ status: 'offline', peers: [], room: '', url: '' });
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [room, setRoom] = useState('');
  const [name, setName] = useState('');

  // `subscribe` returns Set.delete, whose boolean return value React would
  // treat as an invalid cleanup function.
  useEffect(() => {
    const unsubscribe = collab.subscribe(setState);
    return () => { unsubscribe(); };
  }, []);

  const connected = state.status === 'connected';

  return (
    <div className="collab">
      <button
        className={`panel-tab${connected ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={connected ? `${state.peers.length + 1} people in “${state.room}”` : 'Work on this film with somebody else'}
      >
        <span className={`collab-dot ${state.status}`} aria-hidden />
        {connected ? `${state.peers.length + 1} here` : 'Collaborate'}
      </button>

      {connected && state.peers.length > 0 && (
        <div className="peer-chips">
          {state.peers.slice(0, 5).map((p) => (
            <span key={p.id} className="peer-chip" style={{ borderColor: p.colour }} title={
              `${p.name}${p.selectedNodeId ? ` — editing something` : ''}`
            }>
              {p.name.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="collab-popover">
          <h3>Work together</h3>
          {connected ? (
            <>
              <p className="hint">
                In <strong>{state.room}</strong> with {state.peers.length}{' '}
                {state.peers.length === 1 ? 'other person' : 'other people'}.
              </p>
              <ul className="peer-list">
                <li><span className="peer-chip" style={{ borderColor: '#fff' }}>YOU</span> You</li>
                {state.peers.map((p) => (
                  <li key={p.id}>
                    <span className="peer-chip" style={{ borderColor: p.colour }}>
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    {p.name}
                  </li>
                ))}
              </ul>
              <button className="btn danger" onClick={() => { collab.disconnect(); setOpen(false); }}>
                Leave
              </button>
            </>
          ) : (
            <>
              <p className="hint">
                Everyone in the same room edits the same film. Start the relay with{' '}
                <code>node server/collab.mjs</code>, then share the room name.
              </p>
              <label className="field">
                <span>Server</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_URL} />
              </label>
              <label className="field">
                <span>Room</span>
                <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. five-senses" />
              </label>
              <label className="field">
                <span>Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" />
              </label>
              <button
                className="btn primary"
                disabled={!url.trim() || !room.trim()}
                onClick={() => { collab.connect(url.trim(), room.trim(), name.trim() || undefined); setOpen(false); }}
              >
                Join the room
              </button>
              {state.status === 'error' && <p className="warnings">{state.detail}</p>}
              <p className="hint small-print">
                The first person in a room brings the film; everyone who joins after receives it.
                Edits are shared as you make them. If two people change the <em>same</em> thing at the
                same moment, the later change wins — so divide the work by scene.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
