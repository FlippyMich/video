/**
 * Scenes and the things in them.
 *
 * The one place that answers "what have I actually got?" — every scene, every
 * character and prop inside it, and which shot is on screen right now.
 */

import { ENVIRONMENTS } from '../../engine/assets/environments';
import { store, uid } from '../store';
import { useEditor } from '../useEditor';

const KIND_MARK: Record<string, string> = {
  character: '☺',
  prop: '▣',
  fx: '✧',
  light: '☀',
  camera: '⬚',
  text: 'T',
};

export function SceneList() {
  const { scenes, sequence, selectedSceneId, selectedNodeId, time } = useEditor((s) => ({
    scenes: s.project.scenes,
    sequence: s.project.sequence,
    selectedSceneId: s.selectedSceneId,
    selectedNodeId: s.selectedNodeId,
    time: s.time,
  }));

  const spanOf = (sceneId: string) => {
    const shots = sequence.filter((x) => x.sceneId === sceneId);
    if (!shots.length) return null;
    const start = Math.min(...shots.map((x) => x.start));
    const end = Math.max(...shots.map((x) => x.start + x.duration));
    return { start, end, count: shots.length };
  };

  return (
    <div className="panel scene-list">
      <div className="panel-head">
        <h2>Film</h2>
        <button
          className="btn ghost small"
          title="Add another scene at the end"
          onClick={() => {
            const id = uid('scene');
            store.edit((p) => {
              const last = p.sequence[p.sequence.length - 1];
              const start = last ? last.start + last.duration : 0;
              p.scenes.push({
                id,
                name: `Scene ${p.scenes.length + 1}`,
                environment: { theme: 'garden', seed: Math.floor(Math.random() * 9999), density: 0.6, timeOfDay: 'noon', weather: 'clear' },
                lighting: 'sunny',
                nodes: [],
              });
              p.sequence.push({
                id: uid('shot'), sceneId: id, start, duration: 5,
                framing: 'wide', move: 'static',
                transitionIn: { type: 'crossfade', duration: 0.4 },
                note: 'New scene',
              });
            }, { rebuild: true });
            store.goToScene(id);
          }}
        >
          Add scene
        </button>
      </div>

      <div className="scene-tree">
        {scenes.map((scene, i) => {
          const span = spanOf(scene.id);
          const live = span && time >= span.start && time < span.end;
          const env = ENVIRONMENTS.find((e) => e.theme === scene.environment.theme);
          return (
            <div key={scene.id} className={`scene${scene.id === selectedSceneId ? ' on' : ''}${live ? ' live' : ''}`}>
              <button className="scene-head" onClick={() => store.goToScene(scene.id)}>
                <span className="scene-index">{i + 1}</span>
                <span className="scene-name">{scene.name}</span>
                <span className="scene-meta">
                  {env?.name ?? scene.environment.theme}
                  {span ? ` · ${(span.end - span.start).toFixed(1)}s · ${span.count} shots` : ' · not used'}
                </span>
              </button>
              {scene.id === selectedSceneId && (
                <ul className="node-list">
                  {scene.nodes.map((node) => (
                    <li key={node.id}>
                      <button
                        className={node.id === selectedNodeId ? 'node on' : 'node'}
                        onClick={() => store.set({ selectedNodeId: node.id })}
                      >
                        <span className="node-mark" aria-hidden>{KIND_MARK[node.kind] ?? '•'}</span>
                        <span className="node-name">{node.name}</span>
                        {node.tracks?.length ? (
                          <span className="node-meta">{node.tracks.length} tracks</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                  {!scene.nodes.length && <li className="empty small">Nothing here yet — drag something in from the Library.</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
