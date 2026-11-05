import { fileURLToPath } from 'node:url';

export function createScenario(baseUrl) {
  const source = name => ({
    root: fileURLToPath(new URL('.', import.meta.url)),
    files: ['index.html', 'styles.css', 'tasks.js', name],
  });
  return {
    title: 'Hide completed tasks',
    goal: 'Hide the completed task.',
    before: { url: new URL('/before/', baseUrl).href, label: 'Before', source: source('before.js') },
    after: { url: new URL('/after/', baseUrl).href, label: 'After', source: source('after.js') },
    async run({ page, reel, side }) {
      await reel.step({
        caption: 'Three tasks. One already done.',
        target: '.task-card',
      });
      await reel.step({
        caption: 'Click “Hide completed”.',
        target: '.filter',
        action: () => page.locator('#hide-completed').check(),
      });
      await reel.observe({
        target: '#tasks li',
        read: 'count',
        equals: side === 'before' ? 3 : 2,
        caption: side === 'before'
          ? 'Checked. Still three tasks.'
          : 'Done task hidden. Two left.',
        outcome: side === 'before' ? 'problem' : 'fixed',
        anchor: '.task-card',
      });
    },
  };
}
