import { fileURLToPath } from 'node:url';

export function createScenario(baseUrl) {
  const source = name => ({
    root: fileURLToPath(new URL('.', import.meta.url)),
    files: ['index.html', 'styles.css', 'order.js', name],
  });
  return {
    title: 'Floating-point total at checkout',
    goal: 'Charge the customer the right amount.',
    before: { url: new URL('/before/', baseUrl).href, label: 'Before', source: source('before.js') },
    after: { url: new URL('/after/', baseUrl).href, label: 'After', source: source('after.js') },
    async run({ reel, side }) {
      await reel.step({
        caption: 'Two items. Ten cents and twenty cents.',
        target: '.order-card',
      });
      await reel.step({
        caption: 'Click “Place order”.',
        target: '#place-order',
        action: (button) => button.click(),
      });
      await reel.observe({
        target: '.confirmation-text',
        read: 'text',
        equals: side === 'before' ? 'Order placed. Charged $0.30000000000000004.' : 'Order placed. Charged $0.30.',
        caption: side === 'before'
          ? 'Charged $0.30000000000000004.'
          : 'Charged $0.30.',
        outcome: side === 'before' ? 'problem' : 'fixed',
      });
    },
  };
}
