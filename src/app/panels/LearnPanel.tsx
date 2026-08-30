/**
 * Tutorials and the knowledge base.
 *
 * In the app rather than on a website, because the moment someone needs help is
 * the moment they are looking at the thing they don't understand. Each tutorial
 * step can act on the project — loading a template, switching panels, moving the
 * playhead — so the reader is never asked to find something for themselves.
 */

import { useState } from 'react';
import { TEMPLATES } from '../starter-project';
import { store } from '../store';

interface Step {
  title: string;
  body: string;
  /** Optional one-click action that does the step for you. */
  action?: { label: string; run: () => void };
}

interface Tutorial {
  id: string;
  title: string;
  minutes: number;
  summary: string;
  steps: Step[];
}

const TUTORIALS: Tutorial[] = [
  {
    id: 'first-film',
    title: 'Make your first film in five minutes',
    minutes: 5,
    summary: 'From an empty page to an exported video, without touching anything 3D.',
    steps: [
      {
        title: 'Start from a script',
        body:
          'The fastest way in is to write what people say and let the studio do the rest. ' +
          'Open the Script panel — there is an example already in it.',
        action: { label: 'Open the Script panel', run: () => store.set({ panel: 'script' }) },
      },
      {
        title: 'Write a line',
        body:
          'Every line of dialogue looks like this:\n\n    BUZZY: Hello, everybody!\n\n' +
          'A name, a colon, and what they say. That is the whole format. ' +
          'Add feeling in brackets: BUZZY (excited): Hello!',
      },
      {
        title: 'Add a pause for the children',
        body:
          'Two question marks start an audience beat:\n\n    ?? Can you wave back? | 3s | hand-icon\n\n' +
          'The film holds there, a prompt appears on screen, and the character looks straight down the lens.',
      },
      {
        title: 'Press Build the film',
        body:
          'The studio casts the characters, places them, works out the camera, animates the performance, ' +
          'syncs the mouths to the words and writes the captions. It takes a second or two.',
      },
      {
        title: 'Watch it',
        body: 'Press Play under the picture. Click any shot in the timeline to jump to it.',
        action: { label: 'Play from the start', run: () => store.set({ time: 0, playing: true }) },
      },
      {
        title: 'Export',
        body:
          'Open the Export panel, choose YouTube 1080p and press Export video. ' +
          'The file is made in your browser and lands in your downloads.',
        action: { label: 'Open the Export panel', run: () => store.set({ panel: 'export' }) },
      },
    ],
  },
  {
    id: 'staging',
    title: 'Place things and frame a shot',
    minutes: 6,
    summary: 'Drag characters onto the stage, then decide what the camera looks at.',
    steps: [
      {
        title: 'Drag something in',
        body:
          'Open Library → Characters and drag any character onto the picture. ' +
          'It lands where you drop it. Props work the same way.',
        action: { label: 'Open the Library', run: () => store.set({ panel: 'library' }) },
      },
      {
        title: 'Move it',
        body:
          'Click it to select it, then use Position in the panel on the right. ' +
          'X is left and right, Y is up and down, Z is towards and away from the camera.',
      },
      {
        title: 'Look around the set',
        body:
          'Press Look around under the picture and drag to fly the camera. This does not change ' +
          'the shot — it is only so you can see where everything is.',
      },
      {
        title: 'Choose the framing',
        body:
          'Every shot has a Framing and something it Points at. Pick "Close-up" and point it at ' +
          'a character: the camera works out where to stand. You never have to place a camera by hand.',
      },
      {
        title: 'Add a camera move',
        body:
          'Push in for something important. Handheld for energy. Pull out to reveal where you are. ' +
          'Move amount controls how far it goes.',
      },
    ],
  },
  {
    id: 'performance',
    title: 'Make a character act',
    minutes: 7,
    summary: 'Actions, expressions and lip-sync, and how they layer.',
    steps: [
      {
        title: 'Actions are the verbs',
        body:
          'Select a character, open Library → Actions, set a length and click one. ' +
          'It is added at the playhead. Actions layer: a character can walk, wave and breathe at once.',
      },
      {
        title: 'Expressions are the face',
        body:
          'With a character selected, the Face buttons in the right-hand panel set an expression ' +
          'at the playhead and fade the previous one out. Set one at the start of a line and another at the end.',
      },
      {
        title: 'Mouths follow the words',
        body:
          'Lip-sync is generated from the dialogue when you build from a script. If you record real ' +
          'voices later, the mouth shapes are rebuilt from the audio and become frame-accurate.',
      },
      {
        title: 'Everything is editable',
        body:
          'Every action becomes ordinary keyframes on the timeline. Drag one to change the timing, ' +
          'double-click to delete it, click a track name to mute it.',
      },
      {
        title: 'Less is more',
        body:
          'One clear gesture per line reads far better than three. If a character is doing something ' +
          'on every word, the audience stops seeing any of it.',
      },
    ],
  },
  {
    id: 'sound',
    title: 'Voices, music and sound',
    minutes: 5,
    summary: 'Where audio comes from and how to replace it.',
    steps: [
      {
        title: 'Three kinds of audio',
        body:
          'Voices, Music and Sound FX each get their own tracks. Music ducks automatically under ' +
          'dialogue, so you do not have to ride the levels by hand.',
      },
      {
        title: 'Cues come from the script',
        body:
          'Write @sfx: bell or @music: gentle-morning on its own line. The cue is placed where it appears ' +
          'in the script, and music beds run until the next music cue.',
      },
      {
        title: 'Recording real voices',
        body:
          'Record each line as a separate file and name it after the line. The studio takes the timing ' +
          'from the audio and rebuilds the cut around the performance. See the knowledge base entry ' +
          '"Replacing the voice track".',
      },
    ],
  },
];

const KB: { q: string; a: string }[] = [
  {
    q: 'Do I need to know anything about 3D?',
    a: 'No. There are no meshes, materials or rigs to build. Characters, props and sets are already made; ' +
       'you place them, and the camera framing is chosen from named shot sizes rather than by positioning a camera.',
  },
  {
    q: 'What can my computer run this on?',
    a: 'Any current Chrome, Edge, Safari or Firefox on Windows, macOS, Linux or ChromeOS. ' +
       'Exporting video needs Chrome, Edge or Safari 16.4+. On a slower machine set the preview to ' +
       '"Fast" — it only affects what you see while editing, never the export.',
  },
  {
    q: 'Where are my files kept?',
    a: 'In the browser tab while you work, and on your own computer when you save. Nothing is uploaded. ' +
       'Use Export → Project file to save your work, and keep that file: it is the whole film.',
  },
  {
    q: 'Why does my film look different after I export it?',
    a: 'It should not. The preview and the export run the same renderer; the only differences are ' +
       'resolution and the preview quality setting. If something moves differently, it is almost always ' +
       'a keyframe sitting between two frames — the export snaps to frame boundaries.',
  },
  {
    q: 'How long should a video for young children be?',
    a: 'Five to eight minutes holds most three- to six-year-olds, if something changes every ten or ' +
       'fifteen seconds. Interaction beats reset attention, which is why they matter more than any effect.',
  },
  {
    q: 'How do the audience beats work?',
    a: 'A beat pauses the story, shows a prompt, and points the character\'s eyes at the lens. ' +
       'Leave three seconds for a simple answer and five or six for singing. If you are showing the video ' +
       'to a group, pause on the prompt and give them as long as they need.',
  },
  {
    q: 'Can I use my own characters?',
    a: 'The library is generated from code in src/engine/assets/characters.ts. Adding a character means ' +
       'writing a builder function — the existing ones are the worked examples. Every character in the ' +
       'library was made that way.',
  },
  {
    q: 'What is a seed?',
    a: 'Sets are generated, not hand-built. The seed is the number that decides where everything lands. ' +
       'The same seed always gives the same garden, so your film looks the same every time it renders — ' +
       'and "Shuffle the set" simply picks a new one.',
  },
  {
    q: 'Why is my export taking so long?',
    a: 'Rendering is per-frame work: eight minutes at 30fps is over fourteen thousand frames. ' +
       'A 720p draft is roughly twice as fast as 1080p and is fine for checking timing. ' +
       'Export the final version once you are happy.',
  },
  {
    q: 'Can I make a green-screen version?',
    a: 'Yes — choose the "Green screen" export preset. The set is replaced with flat chroma green and the ' +
       'lighting goes flat, which is what a keyer needs. The characters and their animation are unchanged.',
  },
];

export function LearnPanel() {
  const [openTutorial, setOpenTutorial] = useState<string | null>('first-film');
  const [openQuestion, setOpenQuestion] = useState<number | null>(null);

  return (
    <div className="panel learn">
      <div className="panel-head"><h2>Learn</h2></div>

      <section className="group">
        <h3>Start from a template</h3>
        <div className="card-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="card"
              onClick={() => {
                store.loadProject(t.build(), `Opened “${t.name}”.`);
                store.set({ panel: 'library' });
              }}
            >
              <span className="card-title">{t.name}</span>
              <span className="card-desc">{t.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="group">
        <h3>Tutorials</h3>
        {TUTORIALS.map((tut) => (
          <article key={tut.id} className={openTutorial === tut.id ? 'tutorial open' : 'tutorial'}>
            <button className="tutorial-head" onClick={() => setOpenTutorial(openTutorial === tut.id ? null : tut.id)}>
              <span className="tutorial-title">{tut.title}</span>
              <span className="tutorial-meta">{tut.minutes} min</span>
            </button>
            {openTutorial === tut.id && (
              <div className="tutorial-body">
                <p className="hint">{tut.summary}</p>
                <ol>
                  {tut.steps.map((step, i) => (
                    <li key={i}>
                      <strong>{step.title}</strong>
                      <p>{step.body}</p>
                      {step.action && (
                        <button className="btn small" onClick={step.action.run}>{step.action.label}</button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="group">
        <h3>Questions</h3>
        {KB.map((item, i) => (
          <article key={i} className={openQuestion === i ? 'faq open' : 'faq'}>
            <button className="faq-head" onClick={() => setOpenQuestion(openQuestion === i ? null : i)}>
              {item.q}
            </button>
            {openQuestion === i && <p className="faq-body">{item.a}</p>}
          </article>
        ))}
      </section>

      <section className="group">
        <h3>Keyboard</h3>
        <table className="keys">
          <tbody>
            {[
              ['Space', 'Play or pause'],
              ['← →', 'One frame back or forward'],
              ['Shift + ← →', 'One second'],
              ['Home / End', 'Start or end of the film'],
              ['Ctrl/⌘ + Z', 'Undo'],
              ['Ctrl/⌘ + Shift + Z', 'Redo'],
              ['Delete', 'Remove the selected thing'],
              ['1 – 4', 'Library, Script, Export, Learn'],
            ].map(([k, v]) => (
              <tr key={k}><th>{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
