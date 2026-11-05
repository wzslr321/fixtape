import { order, renderOrder, placeOrder } from '/order.js';

renderOrder(order);
document.querySelector('#place-order').addEventListener('click', () => {
  const cents = order.items.reduce((sum, item) => sum + Math.round(item.price * 100), 0);
  placeOrder(`$${(cents / 100).toFixed(2)}`);
});
