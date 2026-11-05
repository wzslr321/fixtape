import { order, renderOrder, placeOrder } from '/order.js';

renderOrder(order);
document.querySelector('#place-order').addEventListener('click', () => {
  const total = order.items.reduce((sum, item) => sum + item.price, 0);
  placeOrder(`$${total}`);
});
